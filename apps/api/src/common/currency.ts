import { CONSOLIDATION_CURRENCY, isCurrencyCode, type CurrencyCode } from '@yohobed/domain';

/**
 * How a multi-row money aggregate is denominated (multi-currency Phase 4).
 *
 * Every booking stores its amount in its property's base currency plus `fxRateToLkr`, the rate
 * snapshotted at creation. Summing `amount` across properties that price in different currencies
 * therefore adds unlike numbers — the bug this resolves.
 *
 * The rule, applied at every cross-property aggregate:
 *
 *   - **One distinct currency** (overwhelmingly the common case) → report it natively. The sum is
 *     exact and no FX is applied. A tenant whose properties all price in USD sees USD, not a
 *     nonsensical rupee conversion.
 *   - **More than one** → consolidate to LKR using each booking's own snapshotted rate, and mark
 *     the figure `approximate` so the UI can label it. Historic rates are used deliberately: a
 *     consolidated total should not drift every time the FX job runs.
 *
 * Because an LKR-only tenant has one currency and `fxRateToLkr = 1`, this produces byte-identical
 * output to the pre-Phase-4 code for every existing tenant.
 */
export interface AggCurrency {
  /** The currency the folded figures are denominated in. */
  currency: CurrencyCode;
  /** True when figures were FX-converted and should be labelled as estimates. */
  approximate: boolean;
}

/**
 * Decide the denomination for an aggregate spanning `currencies`.
 *
 * Callers select BOTH a native sum and an LKR-converted sum, then pick per `approximate`:
 * `const total = agg.approximate ? row.lkr : row.native`.
 */
export function resolveAggCurrency(currencies: Iterable<string | null | undefined>): AggCurrency {
  const distinct = new Set<CurrencyCode>();
  for (const c of currencies) {
    // Defensive: a row predating the currency column (or hand-edited) is treated as LKR, matching
    // the column default, rather than poisoning the set with an unknown code.
    distinct.add(isCurrencyCode(c) ? c : 'LKR');
  }
  if (distinct.size <= 1) {
    const [only] = distinct;
    return { currency: only ?? 'LKR', approximate: false };
  }
  return { currency: CONSOLIDATION_CURRENCY, approximate: true };
}
