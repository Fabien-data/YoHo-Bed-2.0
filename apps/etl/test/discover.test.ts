import { describe, it, expect } from 'vitest';
import { buildReport, formatReport, type SchemaMap } from '../src/discover';
import { LEGACY_CONTRACT } from '../src/contract';

/**
 * Discovery decides whether a cutover may begin, so its verdict is pinned here rather than first
 * exercised against production on the day legacy credentials arrive.
 *
 * The schema on disk is a reconstruction (see contract.ts), so the interesting cases are all about
 * being *wrong* about the legacy database: a table that isn't there, a column that was renamed,
 * columns carrying data the contract never claimed.
 */

const NOW = '2026-07-28T00:00:00.000Z';

function col(type = 'int unsigned') {
  return { type, nullable: false };
}

/** A schema in which every contracted table and column exists — the happy path. */
function completeSchema(): SchemaMap {
  const m: SchemaMap = new Map();
  for (const t of LEGACY_CONTRACT) {
    m.set(t.table, new Map(t.columns.map((c) => [c.name, col()])));
  }
  return m;
}

function counts(schema: SchemaMap, n = 10): Map<string, number> {
  return new Map([...schema.keys()].map((t) => [t, n]));
}

describe('schema discovery', () => {
  it('clears the migration to proceed when the real schema matches the contract', () => {
    const schema = completeSchema();
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);

    expect(report.canProceed).toBe(true);
    expect(report.summary.missing).toBe(0);
    expect(report.summary.degraded).toBe(0);
    expect(report.summary.ok).toBe(LEGACY_CONTRACT.length);
    expect(report.summary.totalRows).toBe(LEGACY_CONTRACT.length * 10);
  });

  it('blocks the migration when a required table is absent entirely', () => {
    const schema = completeSchema();
    schema.delete('dailyrates'); // no per-night snapshot => settlement cannot be rebuilt
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);

    expect(report.canProceed).toBe(false);
    expect(report.summary.missing).toBe(1);
    const finding = report.tables.find((t) => t.table === 'dailyrates')!;
    expect(finding.status).toBe('missing');
    expect(finding.rows).toBeUndefined();
  });

  it('blocks the migration when a required column is absent', () => {
    const schema = completeSchema();
    // occupancy_rateplan.id IS the pricing key — legacy BUG #2 was keying off the wrong column,
    // so losing this mapping is exactly the failure the rebuild exists to prevent.
    schema.get('occupancy_rateplan')!.delete('id');
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);

    expect(report.canProceed).toBe(false);
    const finding = report.tables.find((t) => t.table === 'occupancy_rateplan')!;
    expect(finding.status).toBe('degraded');
    expect(finding.columns.find((c) => c.column === 'id')!.status).toBe('missing');
  });

  it('degrades but still proceeds when only an optional column is absent', () => {
    const schema = completeSchema();
    schema.get('customers')!.delete('mobile'); // nice to have, not load-bearing
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);

    expect(report.canProceed).toBe(true);
    const finding = report.tables.find((t) => t.table === 'customers')!;
    expect(finding.status).toBe('degraded');
    expect(finding.columns.find((c) => c.column === 'mobile')!.status).toBe('missing-optional');
  });

  it('reports columns the contract never declared, so migrating them is a decision not an oversight', () => {
    const schema = completeSchema();
    schema.get('bookings')!.set('loyalty_points_awarded', col('int'));
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);

    const finding = report.tables.find((t) => t.table === 'bookings')!;
    expect(finding.undeclared).toContain('loyalty_points_awarded');
    // Undeclared columns are informational — they do not block a cutover.
    expect(report.canProceed).toBe(true);
  });

  it('records the actual column type, so a surprise type is visible in the report', () => {
    const schema = completeSchema();
    schema.get('bookings')!.set('amount', col('varchar(32)')); // money as text would be a red flag
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);

    const finding = report.tables.find((t) => t.table === 'bookings')!;
    expect(finding.columns.find((c) => c.column === 'amount')!.type).toBe('varchar(32)');
  });

  it('carries the "not in the reconstructed dump" warning through to the report', () => {
    // selling_price is the TopDown source and is absent from backend-portal/database.sql, so its
    // real shape is unknown until this report runs.
    const schema = completeSchema();
    const report = buildReport(schema, counts(schema), 'armyoftheload', NOW);
    const finding = report.tables.find((t) => t.table === 'selling_price')!;
    expect(finding.unverified).toBe(true);
  });

  describe('formatted output', () => {
    it('states the verdict and names what is missing', () => {
      const schema = completeSchema();
      schema.delete('selling_price');
      const text = formatReport(buildReport(schema, counts(schema), 'armyoftheload', NOW));

      expect(text).toContain('armyoftheload');
      expect(text).toContain('selling_price');
      expect(text).toContain('RESULT: required tables/columns are missing');
    });

    it('says so plainly when everything is present', () => {
      const schema = completeSchema();
      const text = formatReport(buildReport(schema, counts(schema), 'armyoftheload', NOW));
      expect(text).toContain('migration may proceed');
    });
  });
});
