import { round2, decomposeBooking } from '@yohobed/domain';

/**
 * The cutover gate.
 *
 * A migration that moves rows correctly can still be wrong: what matters is that **the money still
 * computes to the same number**. So every legacy booking is re-derived here from the data the ETL
 * actually migrated, and compared to what the legacy system recorded. The cutover is approved only
 * when the diff set is empty (or explicitly waived, row by row, with a reason).
 *
 * These functions are pure — no database, no I/O — so the gate itself is unit-tested rather than
 * being another thing that might be wrong at 2am.
 */

/** A legacy booking reduced to the numbers that must survive migration. */
export interface LegacyBookingFacts {
  id: number;
  reference: string | null;
  /** Gross charged to the guest, legacy `bookings.amount`. */
  amount: number;
  /** Owner base, legacy `bookings.total_base_price`. */
  totalBasePrice: number;
  /** The parallel base figure, legacy `bookings.total_system_base_price` (often NULL). */
  totalSystemBasePrice: number | null;
  yohoCommission: number;
  otaCommission: number;
  taxes: number;
  rooms: number;
  nights: number;
  /** Per-night rates from `dailyrates`, in date order. */
  dailyRates: number[];
  pricingType: 'TopDown' | 'BottomUp' | null;
}

export type DiffCode =
  | 'gross_vs_daily_rates'
  | 'decomposition_does_not_reconcile'
  | 'base_figures_disagree'
  | 'missing_daily_rates'
  | 'night_count_mismatch'
  | 'negative_component';

export interface ParityDiff {
  code: DiffCode;
  /** What the legacy system says. */
  legacy: number;
  /** What re-deriving it yields. */
  recomputed: number;
  /** Signed difference in currency units, legacy − recomputed. */
  delta: number;
  detail: string;
}

export interface ParityResult {
  bookingId: number;
  reference: string | null;
  ok: boolean;
  diffs: ParityDiff[];
}

const cents = (v: number) => Math.round(v * 100);

function diff(
  code: DiffCode,
  legacy: number,
  recomputed: number,
  detail: string,
  toleranceCents: number,
): ParityDiff | null {
  const delta = round2(legacy - recomputed);
  if (Math.abs(cents(delta)) <= toleranceCents) return null;
  return { code, legacy: round2(legacy), recomputed: round2(recomputed), delta, detail };
}

/**
 * Check one booking. Every rule here is a statement about what must remain true after migration;
 * a violation is a real discrepancy to explain, not a rounding artefact (tolerance defaults to 0).
 */
export function checkBooking(b: LegacyBookingFacts, toleranceCents = 0): ParityResult {
  const diffs: (ParityDiff | null)[] = [];

  // 1. The per-night snapshot must add up to the charged amount. This is the single most important
  //    check: booking_days is the source of truth for settlement in 2.0, so if it cannot reproduce
  //    the legacy gross, every future payout for that booking is wrong.
  if (b.dailyRates.length === 0) {
    diffs.push({
      code: 'missing_daily_rates',
      legacy: b.amount,
      recomputed: 0,
      delta: round2(b.amount),
      detail:
        'no dailyrates rows — the per-night snapshot cannot be rebuilt, so settlement would ' +
        'have nothing to reconcile against',
    });
  } else {
    if (b.dailyRates.length !== b.nights) {
      diffs.push({
        code: 'night_count_mismatch',
        legacy: b.nights,
        recomputed: b.dailyRates.length,
        delta: b.nights - b.dailyRates.length,
        detail: `checkout − checkin is ${b.nights} night(s) but dailyrates has ${b.dailyRates.length} row(s)`,
      });
    }
    const fromNights = round2(b.dailyRates.reduce((s, r) => s + r, 0) * b.rooms);
    diffs.push(
      diff(
        'gross_vs_daily_rates',
        b.amount,
        fromNights,
        `sum(dailyrates.rate) × ${b.rooms} room(s) should equal bookings.amount`,
        toleranceCents,
      ),
    );
  }

  // 2. The settlement identity 2.0 relies on: gross = base + yoho + ota + taxes. `decomposeBooking`
  //    derives OTA as the remainder, so feeding it the legacy numbers and comparing the derived OTA
  //    to the recorded one tests the whole identity in one shot.
  const economics = decomposeBooking(b.amount, b.taxes, b.totalBasePrice, b.yohoCommission);
  diffs.push(
    diff(
      'decomposition_does_not_reconcile',
      b.otaCommission,
      economics.otaCommission,
      'recorded commission_ota vs (amount − taxes − base − yoho); a gap means the legacy row ' +
        'does not satisfy the settlement identity',
      toleranceCents,
    ),
  );

  // 3. The known TopDown/BottomUp inconsistency, surfaced rather than silently resolved. Legacy
  //    carries two base figures and FinanceController sums total_system_base_price while the
  //    extranet shows total_base_price. Where they disagree, a human must decide which is true
  //    before that property cuts over.
  if (b.totalSystemBasePrice !== null) {
    diffs.push(
      diff(
        'base_figures_disagree',
        b.totalBasePrice,
        b.totalSystemBasePrice,
        `total_base_price vs total_system_base_price (pricing_type=${b.pricingType ?? 'unknown'}) — ` +
          'legacy finance reports use the system figure, the extranet shows the other',
        toleranceCents,
      ),
    );
  }

  // 4. No component may be negative. A negative OTA commission means base + yoho exceeded the
  //    commissionable amount — the booking was sold below cost, or the data is corrupt.
  for (const [name, value] of [
    ['propertyBase', economics.propertyBase],
    ['yohoCommission', economics.yohoCommission],
    ['otaCommission', economics.otaCommission],
    ['taxes', economics.taxes],
  ] as const) {
    if (value < 0) {
      diffs.push({
        code: 'negative_component',
        legacy: value,
        recomputed: 0,
        delta: round2(value),
        detail: `${name} is negative after decomposition — the booking cannot be settled as recorded`,
      });
    }
  }

  const real = diffs.filter((d): d is ParityDiff => d !== null);
  return { bookingId: b.id, reference: b.reference, ok: real.length === 0, diffs: real };
}

export interface ParitySummary {
  checked: number;
  passed: number;
  failed: number;
  /** How many bookings exhibit each failure code (one booking can hit several). */
  byCode: Record<string, number>;
  /** The worst offenders, for the report. */
  worst: ParityResult[];
  /** The gate: true only when everything reconciles. */
  canCutOver: boolean;
}

export function summarise(results: ParityResult[], worstN = 20): ParitySummary {
  const failures = results.filter((r) => !r.ok);
  const byCode: Record<string, number> = {};
  for (const r of failures) {
    for (const code of new Set(r.diffs.map((d) => d.code))) {
      byCode[code] = (byCode[code] ?? 0) + 1;
    }
  }
  const worst = [...failures].sort((a, b) => maxAbsDelta(b) - maxAbsDelta(a)).slice(0, worstN);

  return {
    checked: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    byCode,
    worst,
    canCutOver: failures.length === 0,
  };
}

function maxAbsDelta(r: ParityResult): number {
  return r.diffs.reduce((m, d) => Math.max(m, Math.abs(d.delta)), 0);
}
