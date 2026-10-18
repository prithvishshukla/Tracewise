import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<any, typeof schema>;

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

export interface DbHandle {
  db: Db;
  close: () => Promise<void>;
}

export function createDb(connectionString: string): DbHandle {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (err) => {
    // Idle client errors must not crash the process; they are surfaced on the next query.
    console.error('[db] idle client error:', err.message);
  });
  const db = drizzle(pool, { schema });
  return { db: db as unknown as Db, close: () => pool.end() };
}

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await pool.end();
  }
}

export async function resetDatabase(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
  await runMigrations(connectionString);
}
