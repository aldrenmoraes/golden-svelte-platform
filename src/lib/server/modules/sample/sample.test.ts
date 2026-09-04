import { beforeEach, describe, expect, test } from 'bun:test';
import { isHttpError, type RequestEvent } from '@sveltejs/kit';
import type { SampleRepository } from './repository';
import type { NewSampleItem, SampleItem } from './schema';
import { createSampleService } from './service';

/** In-memory stand-in for the Drizzle repository: the service is unit-tested without a database. */
function createFakeRepository(seed: SampleItem[] = []): SampleRepository & { items: SampleItem[] } {
	const items = [...seed];
	const byName = (name: string) =>
		items.find((item) => item.name.toLowerCase() === name.toLowerCase());

	return {
		items,
		async list({ includeArchived = false } = {}) {
			return items
				.filter((item) => includeArchived || !item.archived)
				.sort((left, right) => left.name.localeCompare(right.name));
		},
		async findById(id) {
			return items.find((item) => item.id === id);
		},
		async findByName(name) {
			return byName(name);
		},
		async create(values: NewSampleItem) {
			const created: SampleItem = {
				id: values.id ?? `item-${items.length + 1}`,
				name: values.name,
				description: values.description ?? null,
				archived: values.archived ?? false,
				createdAt: new Date(),
				updatedAt: new Date()
			};
			items.push(created);
			return created;
		},
		async update(id, values) {
			const existing = items.find((item) => item.id === id);
			if (!existing) return undefined;
			Object.assign(existing, values, { updatedAt: new Date() });
			return existing;
		},
		async setArchived(id, archived) {
			const existing = items.find((item) => item.id === id);
			if (!existing || existing.archived === archived) return undefined;
			existing.archived = archived;
			existing.updatedAt = new Date();
			return existing;
		}
	};
}

function itemFixture(overrides: Partial<SampleItem> = {}): SampleItem {
	return {
		id: 'item-1',
		name: 'Alpha',
		description: null,
		archived: false,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides
	};
}

function eventFor(role?: string): RequestEvent {
	return {
		request: new Request('https://app.example.com/api/sample', { method: 'POST' }),
		url: new URL('https://app.example.com/api/sample'),
		locals: role ? { user: { id: 'user-1', role }, session: { id: 'session-1' } } : {}
	} as unknown as RequestEvent;
}

async function statusOf(run: () => Promise<unknown>): Promise<number> {
	try {
		await run();
	} catch (thrown) {
		if (isHttpError(thrown)) return thrown.status;
		throw thrown;
	}
	throw new Error('expected the service to throw');
}

let repository: ReturnType<typeof createFakeRepository>;
let service: ReturnType<typeof createSampleService>;

beforeEach(() => {
	repository = createFakeRepository([itemFixture(), itemFixture({ id: 'item-2', name: 'Beta' })]);
	service = createSampleService(repository);
});

describe('sample module authorization', () => {
	test('rejects an anonymous caller with 401', async () => {
		expect(await statusOf(() => service.list(eventFor()))).toBe(401);
	});

	test('rejects a viewer that tries to create with 403', async () => {
		expect(await statusOf(() => service.create(eventFor('viewer'), { name: 'Gamma' }))).toBe(403);
	});

	test('rejects an operator that tries to archive with 403', async () => {
		expect(await statusOf(() => service.archive(eventFor('operator'), 'item-1'))).toBe(403);
	});

	test('allows a viewer to read', async () => {
		const items = await service.list(eventFor('viewer'));
		expect(items.map((item) => item.name)).toEqual(['Alpha', 'Beta']);
	});
});

describe('sample module business rules', () => {
	test('creates an item for a permitted role', async () => {
		const created = await service.create(eventFor('operator'), {
			name: '  Gamma  ',
			description: 'third item'
		});
		expect(created.name).toBe('Gamma');
		expect(repository.items).toHaveLength(3);
	});

	test('rejects invalid input with 400', async () => {
		expect(await statusOf(() => service.create(eventFor('admin'), { name: '' }))).toBe(400);
		expect(await statusOf(() => service.create(eventFor('admin'), {}))).toBe(400);
		expect(await statusOf(() => service.update(eventFor('admin'), 'item-1', {}))).toBe(400);
	});

	test('rejects a duplicate name regardless of casing with 409', async () => {
		expect(await statusOf(() => service.create(eventFor('admin'), { name: 'alpha' }))).toBe(409);
	});

	test('reports a missing item as 404', async () => {
		expect(await statusOf(() => service.archive(eventFor('admin'), 'missing'))).toBe(404);
		expect(
			await statusOf(() => service.update(eventFor('admin'), 'missing', { name: 'Delta' }))
		).toBe(404);
	});

	test('archives an item once and refuses the second attempt with 409', async () => {
		const archived = await service.archive(eventFor('admin'), 'item-1');
		expect(archived.archived).toBe(true);
		expect(await statusOf(() => service.archive(eventFor('admin'), 'item-1'))).toBe(409);
	});

	test('hides archived items from the default listing', async () => {
		await service.archive(eventFor('admin'), 'item-1');
		expect((await service.list(eventFor('viewer'))).map((item) => item.name)).toEqual(['Beta']);
		expect(
			(await service.list(eventFor('viewer'), { includeArchived: true })).map((item) => item.name)
		).toEqual(['Alpha', 'Beta']);
	});

	test('refuses to update an archived item with 409', async () => {
		await service.archive(eventFor('admin'), 'item-1');
		expect(
			await statusOf(() => service.update(eventFor('admin'), 'item-1', { name: 'Renamed' }))
		).toBe(409);
	});
});
