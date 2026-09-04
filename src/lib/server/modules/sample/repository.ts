import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import {
	sampleItem,
	type NewSampleItem,
	type SampleItem,
	type UpdateSampleItemInput
} from './schema';

export type ListSampleItemsOptions = { includeArchived?: boolean };

/**
 * The persistence boundary of the module. Services depend on this interface, never on Drizzle,
 * which keeps business rules unit-testable without a database.
 */
export type SampleRepository = {
	list(options?: ListSampleItemsOptions): Promise<SampleItem[]>;
	findById(id: string): Promise<SampleItem | undefined>;
	findByName(name: string): Promise<SampleItem | undefined>;
	create(values: NewSampleItem): Promise<SampleItem>;
	update(id: string, values: UpdateSampleItemInput): Promise<SampleItem | undefined>;
	setArchived(id: string, archived: boolean): Promise<SampleItem | undefined>;
};

/** Builds the Drizzle-backed repository. Pass the handle in so callers control the connection. */
export function createSampleRepository(database: Database): SampleRepository {
	return {
		list({ includeArchived = false }: ListSampleItemsOptions = {}) {
			const query = database.select().from(sampleItem);
			const filtered = includeArchived ? query : query.where(eq(sampleItem.archived, false));
			return filtered.orderBy(asc(sampleItem.name));
		},

		async findById(id) {
			const [found] = await database
				.select()
				.from(sampleItem)
				.where(eq(sampleItem.id, id))
				.limit(1);
			return found;
		},

		async findByName(name) {
			const [found] = await database
				.select()
				.from(sampleItem)
				.where(sql`lower(${sampleItem.name}) = lower(${name})`)
				.limit(1);
			return found;
		},

		async create(values) {
			const [created] = await database.insert(sampleItem).values(values).returning();
			return created;
		},

		async update(id, values) {
			const [updated] = await database
				.update(sampleItem)
				.set({ ...values, updatedAt: new Date() })
				.where(eq(sampleItem.id, id))
				.returning();
			return updated;
		},

		async setArchived(id, archived) {
			const [updated] = await database
				.update(sampleItem)
				.set({ archived, updatedAt: new Date() })
				.where(and(eq(sampleItem.id, id), eq(sampleItem.archived, !archived)))
				.returning();
			return updated;
		}
	};
}
