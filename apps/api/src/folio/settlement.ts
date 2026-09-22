import { and, asc, eq, sql } from 'drizzle-orm';
import { bookingDays, bookings, folios, ledgerAccounts, ledgerEntries, type Tx } from '@yohobed/db';
import { chargeToAccountWithin } from '../payments/take-payment';

const money = (n: number) => n.toFixed(2);

/**
 * What check-out settles with the city ledger (Development Phase 02, Sprint 5; Pro):
 *
 * 1. A window billed to a travel agent or company hands its balance to that account — the guest
 *    leaves, the company is invoiced. (A window billed to the guest stays as it is: the desk
 *    collects it.)
 * 2. A travel agent with a commission plan is credited its commission, once, on room revenue net
 *    of tax: a percentage of every night or of the first night, or a fixed amount per night or
 *    per stay.
 *
 * Runs inside the check-out transaction, so a guest is never out with the money half-moved.
 */
export async function settleAtCheckout(
  tx: Tx,
  tenantId: string,
  booking: typeof bookings.$inferSelect,
  userId: string | null,
): Promise<{ movedToLedger: number; commission: string | null }> {
  let moved = 0;
  const windows = await tx
    .select()
    .from(folios)
    .where(and(eq(folios.bookingId, booking.id), eq(folios.status, 'open')))
    .orderBy(asc(folios.window));
  for (const w of windows) {
    if (!w.payerLedgerAccountId) continue;
    const [row] = await tx
      .select({
        charges: sql<string>`coalesce((
          select sum(c.total) from folio_charges c
          where c.folio_id = ${w.id} and c.voided_at is null
        ), 0)::text`,
        // Net of refunds (UX-1b): money given back is no longer paid.
        paid: sql<string>`coalesce((
          select sum(case when p.direction = 'received' then p.amount else -p.amount end)
          from payments p
          where p.folio_id = ${w.id}
        ), 0)::text`,
      })
      .from(folios)
      .where(eq(folios.id, w.id));
    const balance = Number(row?.charges ?? 0) - Number(row?.paid ?? 0);
    if (balance <= 0.004) continue;
    await chargeToAccountWithin(tx, {
      tenantId,
      userId,
      bookingId: booking.id,
      folioId: w.id,
      ledgerAccountId: w.payerLedgerAccountId,
      amount: Number(money(balance)),
      currency: w.currency,
      description: `Stay ${booking.reference} — window ${w.window}`,
      reference: booking.voucherNo ?? booking.reference,
      note: 'Moved to the city ledger at check-out',
      // The guest is leaving either way; a limit breach is the credit controller's to chase, not
      // a reason to keep someone at the desk.
      enforceCreditLimit: false,
    });
    moved += 1;
  }

  const commission = await accrueCommission(tx, tenantId, booking, userId);
  return { movedToLedger: moved, commission };
}

async function accrueCommission(
  tx: Tx,
  tenantId: string,
  booking: typeof bookings.$inferSelect,
  userId: string | null,
): Promise<string | null> {
  if (!booking.ledgerAccountId) return null;
  const [account] = await tx
    .select()
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.id, booking.ledgerAccountId));
  if (!account || account.type !== 'travel_agent' || account.commissionPlan === 'none') return null;

  const reference = `COMMISSION ${booking.reference}`;
  const [already] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.bookingId, booking.id), eq(ledgerEntries.reference, reference)));
  if (already) return null;

  const nights = await tx
    .select({ sellingPrice: bookingDays.sellingPrice, tax: bookingDays.tax })
    .from(bookingDays)
    .where(eq(bookingDays.bookingId, booking.id))
    .orderBy(asc(bookingDays.date));
  const rooms = booking.rooms;
  const netOf = (n: { sellingPrice: string; tax: string }) =>
    (Number(n.sellingPrice) - Number(n.tax)) * rooms;
  const value = Number(account.commissionValue);
  let amount = 0;
  switch (account.commissionPlan) {
    case 'pct_all_nights':
      amount = (nights.reduce((s, n) => s + netOf(n), 0) * value) / 100;
      break;
    case 'pct_first_night':
      amount = nights[0] ? (netOf(nights[0]) * value) / 100 : 0;
      break;
    case 'fixed_per_night':
      amount = value * nights.length * rooms;
      break;
    case 'fixed_per_stay':
      amount = value;
      break;
  }
  amount = Number(money(amount));
  if (amount <= 0) return null;
  await tx.insert(ledgerEntries).values({
    tenantId,
    accountId: account.id,
    direction: 'credit',
    amount: money(amount),
    currency: account.currency,
    description: `Commission on ${booking.reference}`,
    bookingId: booking.id,
    reference,
    postedByUserId: userId,
  });
  return money(amount);
}
