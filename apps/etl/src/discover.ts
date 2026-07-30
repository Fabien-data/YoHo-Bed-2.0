import { LEGACY_CONTRACT, CONTRACT_TABLES, type TableContract } from './contract';
import { describeSchema, tableCounts, type LegacyDb } from './mysql';

/**
 * Schema discovery — the first thing to run against the real legacy database, before any row moves.
 *
 * The ETL is written against a *reconstructed* schema (see contract.ts). This compares that
 * assumption to what actually exists and reports every difference, so the unknowns become a short
 * list of concrete questions instead of a migration that fails halfway through at 2am.
 *
 * It is strictly read-only and safe to run against production.
 */

export interface ColumnFinding {
  column: string;
  purpose: string;
  status: 'ok' | 'missing' | 'missing-optional';
  type?: string;
}

export interface TableFinding {
  table: string;
  mapsTo: string;
  status: 'ok' | 'degraded' | 'missing';
  rows?: number;
  columns: ColumnFinding[];
  /** Columns present in the database that the contract does not mention — possible lost data. */
  undeclared: string[];
  notes?: string;
  unverified?: boolean;
}

export interface DiscoveryReport {
  database: string;
  generatedAt: string;
  tables: TableFinding[];
  /** True when nothing required is missing — i.e. migration may proceed. */
  canProceed: boolean;
  summary: { ok: number; degraded: number; missing: number; totalRows: number };
}

/** I/O wrapper: read the real schema, then build the report from it. */
export async function discover(db: LegacyDb, now: string): Promise<DiscoveryReport> {
  const schema = await describeSchema(db);
  const counts = await tableCounts(db, CONTRACT_TABLES);
  return buildReport(schema, counts, db.database, now);
}

export type SchemaMap = Map<string, Map<string, { type: string; nullable: boolean }>>;

/**
 * The whole decision, as a pure function of "what the database has" — so the gate that decides
 * whether a cutover may proceed is unit-tested here, rather than first exercised against
 * production on the day the credentials land.
 */
export function buildReport(
  schema: SchemaMap,
  counts: Map<string, number>,
  database: string,
  now: string,
): DiscoveryReport {
  const tables: TableFinding[] = LEGACY_CONTRACT.map((contract) =>
    inspectTable(contract, schema.get(contract.table), counts.get(contract.table)),
  );

  const summary = {
    ok: tables.filter((t) => t.status === 'ok').length,
    degraded: tables.filter((t) => t.status === 'degraded').length,
    missing: tables.filter((t) => t.status === 'missing').length,
    totalRows: tables.reduce((n, t) => n + (t.rows ?? 0), 0),
  };

  return {
    database,
    generatedAt: now,
    tables,
    canProceed: summary.missing === 0 && !tables.some(hasMissingRequiredColumn),
    summary,
  };
}

function hasMissingRequiredColumn(t: TableFinding): boolean {
  return t.columns.some((c) => c.status === 'missing');
}

function inspectTable(
  contract: TableContract,
  actual: Map<string, { type: string; nullable: boolean }> | undefined,
  rows: number | undefined,
): TableFinding {
  if (!actual) {
    return {
      table: contract.table,
      mapsTo: contract.mapsTo,
      status: 'missing',
      columns: contract.columns.map((c) => ({
        column: c.name,
        purpose: c.purpose,
        status: c.optional ? 'missing-optional' : 'missing',
      })),
      undeclared: [],
      notes: contract.notes,
      unverified: contract.unverified,
    };
  }

  const columns: ColumnFinding[] = contract.columns.map((c) => {
    const found = actual.get(c.name);
    if (found) return { column: c.name, purpose: c.purpose, status: 'ok', type: found.type };
    return {
      column: c.name,
      purpose: c.purpose,
      status: c.optional ? 'missing-optional' : 'missing',
    };
  });

  const declared = new Set(contract.columns.map((c) => c.name));
  const undeclared = [...actual.keys()].filter((c) => !declared.has(c));

  const status = columns.some((c) => c.status === 'missing')
    ? 'degraded'
    : columns.some((c) => c.status === 'missing-optional')
      ? 'degraded'
      : 'ok';

  return {
    table: contract.table,
    mapsTo: contract.mapsTo,
    status,
    rows,
    columns,
    undeclared,
    notes: contract.notes,
    unverified: contract.unverified,
  };
}

/** Human-readable report — what a person reads before approving a cutover. */
export function formatReport(report: DiscoveryReport): string {
  const L: string[] = [];
  const icon = { ok: '✓', degraded: '!', missing: '✗' } as const;

  L.push(`Legacy schema discovery — ${report.database}`);
  L.push(`Generated ${report.generatedAt}`);
  L.push('');
  L.push(
    `${report.summary.ok} table(s) as expected · ${report.summary.degraded} degraded · ` +
      `${report.summary.missing} missing · ${report.summary.totalRows.toLocaleString('en-US')} rows in scope`,
  );
  L.push('');

  for (const t of report.tables) {
    L.push(
      `${icon[t.status]} ${t.table}${t.rows !== undefined ? ` (${t.rows.toLocaleString('en-US')} rows)` : ''}` +
        `${t.unverified ? '  [not in the reconstructed dump]' : ''}`,
    );
    L.push(`    → ${t.mapsTo}`);

    for (const c of t.columns) {
      if (c.status === 'ok') continue;
      const tag = c.status === 'missing' ? 'MISSING (required)' : 'missing (optional)';
      L.push(`    ${tag}: ${c.column} — ${c.purpose}`);
    }
    if (t.undeclared.length) {
      L.push(`    undeclared columns (review — may carry data we are dropping):`);
      L.push(`      ${t.undeclared.join(', ')}`);
    }
    if (t.notes) L.push(`    note: ${t.notes}`);
    L.push('');
  }

  L.push(
    report.canProceed
      ? 'RESULT: every required table and column is present — migration may proceed.'
      : 'RESULT: required tables/columns are missing — resolve these before migrating.',
  );
  return L.join('\n');
}
