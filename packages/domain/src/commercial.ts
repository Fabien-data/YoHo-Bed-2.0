import { round2 } from './rounding';

/**
 * The discount a coupon applies to a booking amount.
 * - `percentage`: `value`% off the amount (value = 10 → 10%).
 * - `fixed`: a flat LKR amount off.
 * Never exceeds the amount itself (a coupon can zero a booking, not make it negative).
 */
export function couponDiscount(
  amount: number,
  type: 'percentage' | 'fixed',
  value: number,
): number {
  const raw = type === 'percentage' ? amount * (value / 100) : value;
  return round2(Math.max(0, Math.min(amount, raw)));
}

/**
 * A referral partner's commission = `pct`% of the booking's commissionable amount
 * (selling minus taxes). Recorded against the booking for settlement to the partner.
 */
export function referralCommission(commissionable: number, pct: number): number {
  return round2(commissionable * (pct / 100));
}
