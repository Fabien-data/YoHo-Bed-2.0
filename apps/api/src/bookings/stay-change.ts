/**
 * Changing an in-house stay's departure (UX-1b).
 *
 * The nights already slept are never re-priced — they may already be on the bill. An extension
 * prices only the added nights (through the one ReservationPricer); a shortening removes nights
 * from the end. Either way the booking's stored totals are then re-derived from its nights, which
 * keeps the load-bearing folio invariant: the room charges posted for a stay sum to
 * `bookings.amount`, because both are the nights' selling prices times the rooms.
 */

export interface StoredNight {
  sellingPrice: string;
  basePrice: string;
  tax: string;
}

export interface StayTotals {
  amount: string;
  totalBasePrice: string;
  taxes: string;
  commissionableAmount: string;
}

/** Whole cents, so summing many nights never drifts by a floating-point cent. */
const cents = (v: string | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/**
 * A stay's totals from its stored nights, per room times the rooms — exactly how the pricer
 * builds them, and exactly what posting every night to the folio adds up to.
 */
export function totalsFromNights(nights: StoredNight[], rooms: number): StayTotals {
  let amount = 0;
  let base = 0;
  let taxes = 0;
  for (const n of nights) {
    amount += cents(n.sellingPrice) * rooms;
    base += cents(n.basePrice) * rooms;
    taxes += cents(n.tax) * rooms;
  }
  return {
    amount: fromCents(amount),
    totalBasePrice: fromCents(base),
    taxes: fromCents(taxes),
    commissionableAmount: fromCents(amount - taxes),
  };
}
