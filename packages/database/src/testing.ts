import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import { createDb, MIGRATIONS_DIR, runMigrations, type Db, type DbHandle } from './client';
import * as schema from './schema';

/**
 * Test database factory.
 * - If TEST_DATABASE_URL is set, each call creates its own temporary database on that server (so test files can
 *   run in parallel) and drops it on close.
 * - Otherwise an in-process PGlite (WASM PostgreSQL) instance is used, so tests need no Docker.
 */
export async function createTestDb(): Promise<DbHandle & { driver: 'postgres' | 'pglite' }> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (adminUrl) {
    const name = `tw_test_${randomBytes(6).toString('hex')}`;
    const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    await runMigrations(url.toString());
    const handle = createDb(url.toString());
    return {
      ...handle,
      driver: 'postgres',
      close: async () => {
        await handle.close();
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await admin.end();
      },
    };
  }
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Db, close: () => client.close(), driver: 'pglite' };
}
