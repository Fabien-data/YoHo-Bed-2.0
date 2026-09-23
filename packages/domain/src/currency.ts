/**
 * Multi-currency metadata and conversion (framework-free).
 *
 * Model (decided 2026-07-24, widened 2026-09-22): every property has ONE base currency — LKR, USD,
 * MYR or INR — in which it prices, stores, and settles. GBP/EUR are display-only conversions applied at the current
 * (or booking-snapshotted) FX rate; they never become a base currency and never touch the
 * pricing/settlement math. Amounts stay in their base currency everywhere except the display
 * layer and the cross-property consolidated view (which converts to LKR, labelled approximate).
 *
 * NOTE: currency conversion is intentionally OUTSIDE the pricing parity path (see rounding.ts).
 * The pricing engine mirrors legacy float arithmetic in a single base currency; FX is applied
 * only after a price/amount is final, so it never perturbs the bit-for-bit legacy parity.
 */

/** Every currency the platform can display. */
export const SUPPORTED_CURRENCIES = ['LKR', 'USD', 'INR', 'MYR', 'GBP', 'EUR'] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * Currencies a property may price/store/settle in. Superset (display) is SUPPORTED_CURRENCIES.
 * MYR and INR joined in Development Phase 02 Sprint 7, for hotels in Malaysia and India.
 */
export const BASE_CURRENCIES = ['LKR', 'USD', 'MYR', 'INR'] as const;
export type BaseCurrencyCode = (typeof BASE_CURRENCIES)[number];

/** The currency all cross-property/consolidated figures are normalised to. */
export const CONSOLIDATION_CURRENCY: CurrencyCode = 'LKR';

export interface CurrencyMeta {
  code: CurrencyCode;
  /** Display symbol (prefix). */
  symbol: string;
  /** Human label. */
  name: string;
  /** Fraction digits for display/rounding. */
  decimals: number;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  LKR: { code: 'LKR', symbol: 'Rs', name: 'Sri Lankan Rupee', decimals: 2 },
  USD: { code: 'USD', symbol: '$', name: 'US Dollar', decimals: 2 },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimals: 2 },
  MYR: { code: 'MYR', symbol: 'RM', name: 'Malaysian Ringgit', decimals: 2 },
  GBP: { code: 'GBP', symbol: '£', name: 'Pound Sterling', decimals: 2 },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro', decimals: 2 },
};

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(v);
}

export function isBaseCurrencyCode(v: unknown): v is BaseCurrencyCode {
  return typeof v === 'string' && (BASE_CURRENCIES as readonly string[]).includes(v);
}

/**
 * A snapshot of FX rates expressed as "1 unit of currency = `rate` LKR". LKR itself is 1.
 * Storing everything against a single pivot (LKR) makes any A→B conversion a division; it also
 * matches the exchange_rates table, which always quotes against LKR.
 */
export type RatesToLkr = Partial<Record<CurrencyCode, number>> & { LKR: 1 };

/**
 * Convert `amount` from `from` to `to` using LKR-pivot rates. Returns the raw (unrounded) value;
 * callers round for display. Throws if a needed rate is missing so a silent 0 never ships.
 */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: RatesToLkr,
): number {
  if (from === to) return amount;
  const fromRate = from === 'LKR' ? 1 : rates[from];
  const toRate = to === 'LKR' ? 1 : rates[to];
  if (!fromRate || !toRate) {
    throw new Error(`Missing FX rate for ${from}->${to} (from=${fromRate}, to=${toRate})`);
  }
  return (amount * fromRate) / toRate;
}

/** The multiplier that turns one unit of `from` into LKR (the value snapshotted onto bookings). */
export function rateToLkr(from: CurrencyCode, rates: RatesToLkr): number {
  if (from === 'LKR') return 1;
  const r = rates[from];
  if (!r) throw new Error(`Missing FX rate for ${from}->LKR`);
  return r;
}
