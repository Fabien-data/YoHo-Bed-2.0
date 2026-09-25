import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * The desk's one balance: the room at its sold price after any coupon, plus everything else on
 * the bill, less what was paid (net of refunds). The Reservations list shows it as Total / Paid /
 * Balance, and Stay View's "Payment due" must agree with it to the cent — so both read it here.
 */

/** Paid is what came in, less anything given back. */
export function paidSql(bookingId: AnyColumn | SQL): SQL<string> {
  return sql<string>`coalesce((
    select sum(case when p.direction = 'received' then p.amount else -p.amount end)
    from payments p
    where p.booking_id = ${bookingId}
  ), 0)::text`;
}

/** Anything on the bill besides the room: minibar, laundry, a restaurant ticket. */
export function extrasSql(bookingId: AnyColumn | SQL): SQL<string> {
  return sql<string>`coalesce((
    select sum(fc.total)
    from folio_charges fc
    join folios f on f.id = fc.folio_id
    where f.booking_id = ${bookingId} and fc.voided_at is null and fc.source <> 'room'
  ), 0)::text`;
}

export interface BalanceParts {
  amount: string;
  discount: string;
  extras: string;
  paid: string;
}

/** Total, and what is still to pay — never a float the next screen rounds differently. */
export function deskBalance(r: BalanceParts): { total: string; balance: string; due: boolean } {
  const total = Number(r.amount) - Number(r.discount) + Number(r.extras);
  const balance = total - Number(r.paid);
  return { total: total.toFixed(2), balance: balance.toFixed(2), due: balance > 0.004 };
}
