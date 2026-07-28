import { and, desc, eq, sql } from 'drizzle-orm';
import { exchangeRates } from './schema';
import type { Database } from './client';

/**
 * Query helpers for the global `exchange_rates` table (Phase 2 of multi-currency).
 *
 * The table is append-only and NOT tenant-scoped (market reference data). Callers use the raw
 * unscoped Drizzle handle (`DatabaseService.db` in the API, `db` in the worker) — never withTenant.
 * All rates are quoted against LKR: a row means "1 `base` = `rate` LKR". LKR→LKR is implicitly 1
 * and never stored.
 */

export interface ExchangeRateInput {
  /** Currency being converted FROM, e.g. 'USD'. Never 'LKR'. */
  base: string;
  /** 1 unit of `base` = this many LKR. */
  rate: number;
  /** 'auto' (fetched job), 'manual' (staff override), or a provider slug. */
  source?: string;
  /** When the rate was effective; defaults to now(). Pass for backfills. */
  fetchedAt?: Date;
}

/** Insert one or more rate observations (quote fixed to LKR). No-op on an empty array. */
export async function insertExchangeRates(db: Database, rows: ExchangeRateInput[]): Promise<void> {
  if (!rows.length) return;
  await db.insert(exchangeRates).values(
    rows.map((r) => ({
      base: r.base,
      quote: 'LKR',
      rate: r.rate.toFixed(8),
      source: r.source ?? 'auto',
      ...(r.fetchedAt ? { fetchedAt: r.fetchedAt } : {}),
    })),
  );
}

export interface CurrentRate {
  base: string;
  /** 1 `base` = `rate` LKR. */
  rate: number;
  source: string;
  fetchedAt: Date;
}

/**
 * The newest rate per `base` currency (one row each), quoted against LKR. Uses DISTINCT ON so a
 * single index-ordered scan returns the current rate for every currency we track.
 */
export async function latestRates(db: Database): Promise<CurrentRate[]> {
  const res = await db.execute(sql`
    SELECT DISTINCT ON (base)
      base, rate, source, fetched_at AS "fetchedAt"
    FROM exchange_rates
    WHERE quote = 'LKR'
    ORDER BY base, fetched_at DESC
  `);
  return (
    res as unknown as Array<{ base: string; rate: string; source: string; fetchedAt: Date }>
  ).map((r) => ({ base: r.base, rate: Number(r.rate), source: r.source, fetchedAt: r.fetchedAt }));
}

/**
 * The current LKR-pivot snapshot as a plain map { USD: 302.5, INR: 3.6, ... , LKR: 1 } — the shape
 * `convert()`/`rateToLkr()` in @yohobed/domain consume. LKR is always present as 1.
 */
export async function latestRatesToLkr(db: Database): Promise<Record<string, number>> {
  const rows = await latestRates(db);
  const map: Record<string, number> = { LKR: 1 };
  for (const r of rows) map[r.base] = r.rate;
  return map;
}

/** Rate history, newest first — for the staff FX screen/audit. Optionally filtered to one base. */
export async function listRateHistory(
  db: Database,
  opts: { base?: string; limit?: number } = {},
): Promise<CurrentRate[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await db
    .select({
      base: exchangeRates.base,
      rate: exchangeRates.rate,
      source: exchangeRates.source,
      fetchedAt: exchangeRates.fetchedAt,
    })
    .from(exchangeRates)
    .where(
      opts.base
        ? and(eq(exchangeRates.quote, 'LKR'), eq(exchangeRates.base, opts.base))
        : eq(exchangeRates.quote, 'LKR'),
    )
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(limit);
  return rows.map((r) => ({
    base: r.base,
    rate: Number(r.rate),
    source: r.source,
    fetchedAt: r.fetchedAt,
  }));
}
