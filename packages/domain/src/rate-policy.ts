import { roundMoney, splitProportional, sumMoney } from './money';
import type { TaxLine } from './tax-split';

/**
 * What a room night costs once the desk has had its say (Development Phase 02).
 *
 * The rate calendar gives every night a list price. A reservation may replace it: a typed rate
 * (an override), an agent's contract rate, a complimentary room, or a tax exemption. These
 * functions re-derive the stored economics of a night from that decision. Nothing here touches
 * the parity path — a night priced from the calendar goes through the legacy engine unchanged.
 */

/** Where a stored night's price came from (`booking_days.rate_source`). */
export const RATE_SOURCES = ['calendar', 'override', 'contract', 'complimentary'] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

/** A typed rate. Amounts are tax-inclusive, per room. */
export type RateOverride =
  | { mode: 'nightly'; amount: number }
  | { mode: 'total'; amount: number }
  | { mode: 'per_night'; amounts: Record<string, number> }
  | { mode: 'discount_pct'; pct: number };

export type DistributionModeLike = 'yoho' | 'standalone';

/** A night's stored economics, per room. */
export interface NightEconomics {
  base: number;
  commission: number;
  /** Tax-inclusive price. */
  selling: number;
  tax: number;
}

/**
 * The tax-inclusive price of each night under an override, in `dates` order.
 *
 * - `nightly`: the same price every night.
 * - `total`: the stay total, spread across the nights in proportion to their list prices (evenly
 *   when the list is all zero), so a weekend night stays dearer than a weekday one.
 * - `per_night`: a price for every date; a missing date is an error.
 * - `discount_pct`: the list price less the percentage, per night.
 */
export function overridePrices(
  override: RateOverride,
  dates: string[],
  listPrices: number[],
): number[] {
  switch (override.mode) {
    case 'nightly':
      return dates.map(() => roundMoney(override.amount));
    case 'total':
      return splitProportional(override.amount, listPrices);
    case 'per_night':
      return dates.map((d) => {
        const v = override.amounts[d];
        if (v === undefined) throw new Error(`No rate given for ${d}`);
        return roundMoney(v);
      });
    case 'discount_pct':
      return listPrices.map((p) => roundMoney(p * (1 - override.pct / 100)));
  }
}

/**
 * Re-derive a night after its price changed from the list price.
 *
 * `newTax` is decomposed from `newSelling` by the caller with the legacy engine, so the tax on an
 * overridden night is computed exactly like any other night's.
 *
 * - YoHo-distributed tenants: the property's base and YoHo's commission scale with the price, by
 *   r = new tax-exclusive price ÷ list tax-exclusive price, rounded half-up. Whatever is left is
 *   the OTA margin, and it is never allowed to go negative.
 * - Standalone tenants: there is no commission; the property keeps the tax-exclusive price.
 */
export function overrideNight(
  list: NightEconomics,
  newSelling: number,
  newTax: number,
  mode: DistributionModeLike,
): NightEconomics {
  const exclusive = roundMoney(newSelling - newTax);
  if (mode === 'standalone') {
    return { base: exclusive, commission: 0, selling: newSelling, tax: newTax };
  }
  const listExclusive = list.selling - list.tax;
  if (!(listExclusive > 0)) {
    // A zero list price gives nothing to scale from: the property keeps the lot.
    return { base: exclusive, commission: 0, selling: newSelling, tax: newTax };
  }
  const r = exclusive / listExclusive;
  const base = Math.min(roundMoney(list.base * r), exclusive);
  const commission = Math.max(
    0,
    Math.min(roundMoney(list.commission * r), roundMoney(exclusive - base)),
  );
  return { base, commission, selling: newSelling, tax: newTax };
}

/** A complimentary night: no charge, no tax, nothing to settle. */
export function complimentaryNight(): NightEconomics {
  return { base: 0, commission: 0, selling: 0, tax: 0 };
}

/**
 * Excuse a night from its exemptible taxes. The guest pays the price less those taxes; the
 * property's base and YoHo's commission are untouched, because the tax was never theirs.
 */
export function exemptNight(
  selling: number,
  tax: number,
  lines: TaxLine[],
): { selling: number; tax: number; lines: TaxLine[]; exempted: number } {
  const exempted = sumMoney(lines.filter((l) => l.exemptible).map((l) => l.amount));
  if (exempted === 0) return { selling, tax, lines, exempted: 0 };
  return {
    selling: roundMoney(selling - exempted),
    tax: roundMoney(tax - exempted),
    lines: lines.filter((l) => !l.exemptible),
    exempted,
  };
}

/**
 * How much cheaper `amount` is than `listAmount`, in percent (20 = 20% off). Negative when the
 * price was raised. A zero list price counts any charge as a raise and no charge as no change.
 */
export function discountPercent(listAmount: number, amount: number): number {
  if (!(listAmount > 0)) return amount > 0 ? -100 : 0;
  return Math.round(((listAmount - amount) / listAmount) * 100 * 10_000) / 10_000;
}
