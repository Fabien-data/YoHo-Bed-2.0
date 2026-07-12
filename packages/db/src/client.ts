import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  sql: Sql;
  /** Close the underlying connection pool. */
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over a postgres.js pool.
 *
 * In production the app connects as the restricted `yoho_app` role (see rls.sql) so that
 * row-level security actually applies — RLS is bypassed by superusers and table owners.
 */
export function createDb(url: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(url, { max: opts?.max ?? 10, prepare: false });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end() };
}
