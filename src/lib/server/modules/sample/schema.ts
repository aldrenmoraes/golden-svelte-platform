import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { z } from 'zod';

/**
 * Reference table for the module blueprint. Every domain module owns its table here and
 * re-exports it from `src/lib/server/db/schema.ts` so Drizzle Kit picks it up for migrations.
 */
export const sampleItem = pgTable(
	'sample_item',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		description: text('description'),
		archived: boolean('archived').notNull().default(false),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('sample_item_name_unique').on(table.name),
		index('sample_item_archived_idx').on(table.archived)
	]
);

export type SampleItem = typeof sampleItem.$inferSelect;
export type NewSampleItem = typeof sampleItem.$inferInsert;

/** Input contracts. Every mutating route validates its payload before reaching the service. */
export const createSampleItemInput = z.object({
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().max(2000).optional()
});

export const updateSampleItemInput = z
	.object({
		name: z.string().trim().min(1).max(120).optional(),
		description: z.string().trim().max(2000).nullable().optional()
	})
	.refine((value) => Object.keys(value).length > 0, {
		message: 'At least one field must be provided'
	});

export type CreateSampleItemInput = z.infer<typeof createSampleItemInput>;
export type UpdateSampleItemInput = z.infer<typeof updateSampleItemInput>;
