import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { bookingInclusions, bookingRooms, bookings, folioCharges, type Tx } from '@yohobed/db';
import { routedWindow } from './windows';

const money = (n: number) => n.toFixed(2);

/**
 * Post a night's inclusions (Development Phase 02, Sprint 5): breakfast, dinner, a driver's room.
 *
 * Run by night audit for the night it closes, for guests actually in the house — a no-show is not
 * charged a breakfast they never ate. A `once` inclusion is posted on the first night only. An
 * inclusion already inside the room rate is never posted: the room lines already carry its price,
 * and posting it would charge it twice.
 *
 * Idempotent: an inclusion already posted for the night is skipped (looked up first — a unique
 * violation would abort the audit's whole transaction), and a partial unique index backs it up.
 */
export async function postInclusionsForNight(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  date: string,
  userId: string | null,
): Promise<{ posted: number; total: number }> {
  const due = await tx
    .select({
      inclusion: bookingInclusions,
      bookingId: bookings.id,
      propertyId: bookings.propertyId,
      currency: bookings.currency,
      checkin: bookings.checkin,
    })
    .from(bookingInclusions)
    .innerJoin(bookings, eq(bookings.id, bookingInclusions.bookingId))
    .where(
      and(
        eq(bookings.propertyId, propertyId),
        eq(bookings.status, 'CheckedIn'),
        lte(bookings.checkin, date),
        sql`${bookings.checkout} > ${date}`,
        eq(bookingInclusions.includedInRate, false),
      ),
    );

  let posted = 0;
  let total = 0;
  for (const row of due) {
    const inc = row.inclusion;
    if (inc.rhythm === 'once' && row.checkin !== date) continue;

    const [already] = await tx
      .select({ id: folioCharges.id })
      .from(folioCharges)
      .where(
        and(
          eq(folioCharges.bookingInclusionId, inc.id),
          eq(folioCharges.postedFor, date),
          isNull(folioCharges.voidedAt),
        ),
      );
    if (already) continue;

    const [pax] = await tx
      .select({
        adults: sql<number>`coalesce(sum(${bookingRooms.adults}), 0)::int`,
        children: sql<number>`coalesce(sum(${bookingRooms.children}), 0)::int`,
      })
      .from(bookingRooms)
      .where(and(eq(bookingRooms.bookingId, row.bookingId), isNull(bookingRooms.releasedAt)));
    const adults = pax?.adults ?? 0;
    const children = pax?.children ?? 0;
    const quantity =
      inc.rhythm === 'per_guest_per_night'
        ? adults + children
        : inc.rhythm === 'per_adult_per_night'
          ? adults
          : inc.rhythm === 'per_child_per_night'
            ? children
            : 1;
    if (quantity <= 0) continue;

    // Prices are tax inclusive, like the room rate: the tax is decomposed out of the total, and
    // net is derived from the rounded pair so `net + tax = total` always holds.
    const unit = Number(money(Number(inc.unitPrice) * (1 - Number(inc.discountPct) / 100)));
    const lineTotal = Number(money(unit * quantity));
    const rate = Number(inc.taxRatePct);
    const tax = Number(money(rate > 0 ? lineTotal - lineTotal / (1 + rate / 100) : 0));

    const window = await routedWindow(
      tx,
      tenantId,
      { id: row.bookingId, propertyId: row.propertyId, currency: row.currency },
      'inclusion',
    );
    await tx.insert(folioCharges).values({
      tenantId,
      folioId: window.id,
      particularId: inc.particularId,
      source: 'inclusion',
      description: quantity > 1 ? `${inc.name} — ${date} (×${quantity})` : `${inc.name} — ${date}`,
      postedFor: date,
      quantity: money(quantity),
      unitPrice: money(unit),
      net: money(lineTotal - tax),
      tax: money(tax),
      total: money(lineTotal),
      bookingInclusionId: inc.id,
      postedByUserId: userId,
    });
    posted += 1;
    total += lineTotal;
  }
  return { posted, total: Number(money(total)) };
}
