import mysql from 'mysql2/promise';

/**
 * Read-only handle on the legacy database.
 *
 * `dateStrings: true` is load-bearing: legacy DATE columns are calendar dates (a night, a stay),
 * not instants. Letting the driver turn them into JS Date objects would apply the process
 * timezone and could shift a booking's check-in by a day — the classic migration off-by-one.
 * Every date stays a 'YYYY-MM-DD' string end to end, matching how Postgres `date` is handled
 * everywhere else in this codebase.
 *
 * `decimalNumbers: false` keeps DECIMAL as strings so money never round-trips through a float
 * before the parity harness has compared it.
 */
export interface LegacyDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
  /** The database name from the connection URL — needed to query information_schema. */
  database: string;
}

export async function connectLegacy(url: string): Promise<LegacyDb> {
  const parsed = new URL(url);
  const database = parsed.pathname.replace(/^\//, '');
  if (!database) throw new Error('LEGACY_MYSQL_URL must include a database name');

  const pool = mysql.createPool({
    uri: url,
    dateStrings: true,
    decimalNumbers: false,
    connectionLimit: 4,
    // The ETL only ever reads from MySQL. Anything that tries to write is a bug, and this makes
    // it fail against the server rather than quietly mutating the system we are migrating off.
    flags: ['-MULTI_STATEMENTS'],
  });

  return {
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await pool.query(sql, params);
      return rows as T[];
    },
    async close() {
      await pool.end();
    },
    database,
  };
}

/** Columns actually present in the live legacy database, by table. */
export async function describeSchema(
  db: LegacyDb,
): Promise<Map<string, Map<string, { type: string; nullable: boolean }>>> {
  const rows = await db.query<{
    TABLE_NAME: string;
    COLUMN_NAME: string;
    COLUMN_TYPE: string;
    IS_NULLABLE: string;
  }>(
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [db.database],
  );

  const out = new Map<string, Map<string, { type: string; nullable: boolean }>>();
  for (const r of rows) {
    let cols = out.get(r.TABLE_NAME);
    if (!cols) {
      cols = new Map();
      out.set(r.TABLE_NAME, cols);
    }
    cols.set(r.COLUMN_NAME, { type: r.COLUMN_TYPE, nullable: r.IS_NULLABLE === 'YES' });
  }
  return out;
}

/** Row counts for the tables the ETL cares about — sizes the migration and spots empty tables. */
export async function tableCounts(db: LegacyDb, tables: string[]): Promise<Map<string, number>> {
  const present = await db.query<{ TABLE_NAME: string }>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`,
    [db.database],
  );
  const existing = new Set(present.map((r) => r.TABLE_NAME));

  const out = new Map<string, number>();
  for (const t of tables) {
    if (!existing.has(t)) continue;
    // Identifier cannot be parameterised; `t` comes from our own contract, never from input.
    const [row] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\``);
    out.set(t, Number(row?.n ?? 0));
  }
  return out;
}
