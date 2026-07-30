/**
 * ETL configuration. Both databases are addressed by URL so the same binary runs against a local
 * restore of a production dump, a staging copy, or the real thing.
 *
 * The Postgres side deliberately connects as the OWNER (`DATABASE_URL`, the migration role), not
 * as `yoho_app`: the ETL writes rows for many tenants in one pass, so it must not be fenced by
 * RLS. That is the one place in the platform where bypassing RLS is correct, and it is why the
 * ETL is a separate app rather than an endpoint.
 */

export interface EtlConfig {
  /** Legacy MySQL, e.g. mysql://user:pass@host:3306/armyoftheload */
  mysqlUrl: string;
  /** Target Postgres as the owner role. */
  postgresUrl: string;
  /** Migrate only these legacy property ids (a pilot cutover); empty = all. */
  onlyProperties: number[];
  /** Report and validate, but write nothing. */
  dryRun: boolean;
  /** Rows per batch for the large tables (calendars, booking days). */
  batchSize: number;
  /** Cents of tolerance when comparing a recomputed total to the legacy one. Default 0 — exact. */
  parityToleranceCents: number;
}

function intList(v: string | undefined): number[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EtlConfig {
  const mysqlUrl = env.LEGACY_MYSQL_URL;
  const postgresUrl = env.DATABASE_URL;

  const missing: string[] = [];
  if (!mysqlUrl) missing.push('LEGACY_MYSQL_URL');
  if (!postgresUrl) missing.push('DATABASE_URL');
  if (missing.length) {
    throw new Error(
      `Missing required env: ${missing.join(', ')}.\n` +
        '  LEGACY_MYSQL_URL — the legacy MySQL (armyoftheload), read-only credentials are enough\n' +
        '  DATABASE_URL     — target Postgres as the OWNER role (the ETL writes across tenants)',
    );
  }

  return {
    mysqlUrl: mysqlUrl!,
    postgresUrl: postgresUrl!,
    onlyProperties: intList(env.ETL_ONLY_PROPERTIES),
    dryRun: env.ETL_DRY_RUN === '1' || env.ETL_DRY_RUN === 'true',
    batchSize: Number(env.ETL_BATCH_SIZE ?? 1000),
    parityToleranceCents: Number(env.ETL_PARITY_TOLERANCE_CENTS ?? 0),
  };
}
