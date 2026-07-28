import { pgTable, uuid, text, numeric, timestamp, index } from 'drizzle-orm/pg-core';

/**
 * Exchange rates — global market reference data (Phase 1 of multi-currency, 2026-07-24).
 *
 * Append-only log: a worker job fetches daily rates and staff can insert manual overrides; the
 * current rate for a pair is the newest row by `fetchedAt`. Keeping history (rather than an
 * upsert) gives us an audit trail and lets us reprice/reconcile against the rate that applied on
 * any past date.
 *
 * Rates are always quoted against LKR — `base` in {USD, INR, GBP, EUR}, `quote` always 'LKR',
 * `rate` = "1 `base` = `rate` LKR". LKR→LKR is implicitly 1 and never stored. Any other pair is
 * derived by dividing two LKR-quoted rates (see `convert` in @yohobed/domain).
 *
 * Deliberately NOT tenant-scoped/RLS: FX rates are platform-global, resolved before any tenant
 * context and shared by every tenant's display conversions. Manual overrides are made by platform
 * staff, not property owners.
 */
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Currency being converted FROM, e.g. 'USD'. */
    base: text('base').notNull(),
    /** Currency being converted TO. Always 'LKR' in the current model. */
    quote: text('quote').notNull().default('LKR'),
    /** 1 unit of `base` = this many `quote`. numeric(18,8) for rate precision. */
    rate: numeric('rate', { precision: 18, scale: 8 }).notNull(),
    /** Provenance of this rate: 'auto' (fetched), 'manual' (staff override), or a provider slug. */
    source: text('source').notNull().default('auto'),
    /** When the rate was observed/effective (drives "latest" selection). */
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // "latest rate for a pair" lookups scan by (base, quote) ordered by fetchedAt desc.
    pairFetchedIdx: index('exchange_rates_pair_fetched_idx').on(t.base, t.quote, t.fetchedAt),
  }),
);
