import {
  roundMoney,
  type RateOverride,
  type SmartGuestMix,
  type SmartNightQuote,
} from '@yohobed/domain';
import type { PricingPolicy } from './pricer';

/**
 * `bookings.pricing` — the terms a stay was sold under (Development Phase 02).
 *
 * Kept so that an amendment re-prices the new dates under the same terms: a typed rate stays
 * typed, a contract stays a contract, a complimentary room stays free, an exemption stays exempt.
 * An empty object is a plain rate-calendar booking.
 */
export interface PricingSnapshot {
  smart?: {
    policyVersion: number;
    guests: SmartGuestMix;
    nights: Array<{ date: string; quote?: SmartNightQuote }>;
  };
  override?: RateOverride;
  contractAccountId?: string;
  complimentary?: boolean;
  taxExempt?: { exemptionId: string; reason?: string | null };
  /** Why the price was changed — required for any of the above except a contract. */
  reason?: string;
  /** The owner who approved it on the spot, when the desk needed approval. */
  approvedBy?: Record<string, string>;
}

export function readPricingSnapshot(raw: unknown): PricingSnapshot {
  return raw && typeof raw === 'object' ? (raw as PricingSnapshot) : {};
}

/**
 * The policy an amendment re-prices under.
 *
 * A nightly rate and a percentage discount carry straight over. A stay total or per-night prices
 * were agreed for the old dates only, so they become a nightly rate at the average the guest was
 * paying per night — the least surprising price for nights that were never agreed.
 */
export function policyForAmend(
  snapshot: PricingSnapshot,
  currentNightlyPrices: number[],
): PricingPolicy {
  let override: RateOverride | undefined = snapshot.override;
  if (override && (override.mode === 'total' || override.mode === 'per_night')) {
    const n = currentNightlyPrices.length;
    const average = n > 0 ? roundMoney(currentNightlyPrices.reduce((s, v) => s + v, 0) / n) : 0;
    override = { mode: 'nightly', amount: average };
  }
  return {
    override: override ?? null,
    contractAccountId: snapshot.contractAccountId ?? null,
    complimentary: snapshot.complimentary ?? false,
    taxExempt: Boolean(snapshot.taxExempt),
  };
}
