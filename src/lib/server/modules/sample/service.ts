import { error, type RequestEvent } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { logger } from '$lib/server/observability/logger';
import { requireSampleAccess } from './policy';
import type { ListSampleItemsOptions, SampleRepository } from './repository';
import {
	createSampleItemInput,
	updateSampleItemInput,
	type SampleItem,
	type UpdateSampleItemInput
} from './schema';

export type SampleService = {
	list(event: RequestEvent, options?: ListSampleItemsOptions): Promise<SampleItem[]>;
	create(event: RequestEvent, input: unknown): Promise<SampleItem>;
	update(event: RequestEvent, id: string, input: unknown): Promise<SampleItem>;
	archive(event: RequestEvent, id: string): Promise<SampleItem>;
};

/**
 * Business logic for the module. Each entry point authorizes first, validates its input second,
 * applies domain rules third, and writes structured audit context for every mutation.
 */
export function createSampleService(repository: SampleRepository): SampleService {
	function audit(event: RequestEvent, action: string, fields: Record<string, unknown>) {
		logger.info(
			{
				module: 'sample',
				action,
				method: event.request.method,
				path: event.url.pathname,
				userId: event.locals.user?.id,
				...fields
			},
			'Sample module mutation'
		);
	}

	function parse<T>(schema: ZodType<T>, input: unknown): T {
		const result = schema.safeParse(input);
		if (!result.success) {
			// Log the failing field paths only; the values themselves may carry user data.
			logger.info(
				{
					module: 'sample',
					outcome: 'invalid_input',
					fields: result.error.issues.map((i) => i.path.join('.'))
				},
				'Sample module input rejected'
			);
			error(400, 'invalid_input');
		}
		return result.data;
	}

	return {
		list(event, options) {
			requireSampleAccess(event, 'read');
			return repository.list(options);
		},

		async create(event, input) {
			requireSampleAccess(event, 'create');
			const values = parse(createSampleItemInput, input);

			// Names identify an item to operators, so they stay unique regardless of casing.
			if (await repository.findByName(values.name)) error(409, 'sample_item_name_taken');

			const created = await repository.create(values);
			audit(event, 'create', { itemId: created.id });
			return created;
		},

		async update(event, id, input) {
			requireSampleAccess(event, 'update');
			const values: UpdateSampleItemInput = parse(updateSampleItemInput, input);

			const existing = await repository.findById(id);
			if (!existing) error(404, 'sample_item_not_found');
			if (existing.archived) error(409, 'sample_item_archived');

			if (values.name && values.name.toLowerCase() !== existing.name.toLowerCase()) {
				if (await repository.findByName(values.name)) error(409, 'sample_item_name_taken');
			}

			const updated = await repository.update(id, values);
			if (!updated) error(404, 'sample_item_not_found');
			audit(event, 'update', { itemId: id, fields: Object.keys(values) });
			return updated;
		},

		async archive(event, id) {
			requireSampleAccess(event, 'archive');

			const existing = await repository.findById(id);
			if (!existing) error(404, 'sample_item_not_found');
			if (existing.archived) error(409, 'sample_item_already_archived');

			const archived = await repository.setArchived(id, true);
			if (!archived) error(409, 'sample_item_already_archived');
			audit(event, 'archive', { itemId: id });
			return archived;
		}
	};
}
