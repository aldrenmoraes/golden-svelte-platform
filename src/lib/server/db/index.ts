import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

export type Database = PostgresJsDatabase<typeof schema>;

let instance: Database | undefined;

/**
 * Opens the connection pool on first use. Importing this module must stay side-effect free:
 * the SvelteKit post-build analysis loads every server chunk, so a connection created (or a
 * configuration error thrown) at import time makes the app impossible to build without a
 * database URL. Misconfiguration still fails fast, on the first query instead of at import.
 */
export function getDb(): Database {
	if (!instance) {
		if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
		instance = drizzle(postgres(env.DATABASE_URL), { schema });
	}
	return instance;
}

/** The lazily connected database handle. */
export const db: Database = new Proxy({} as Database, {
	get(_target, property) {
		const database = getDb();
		const value = Reflect.get(database, property) as unknown;
		return typeof value === 'function' ? value.bind(database) : value;
	},
	has: (_target, property) => Reflect.has(getDb(), property)
});
