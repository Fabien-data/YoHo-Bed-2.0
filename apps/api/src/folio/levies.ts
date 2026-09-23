import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { bookings, folioCharges, folios, propertyLevies, type Tx } from '@yohobed/db';
import {
  isResidency,
  levyExemption,
  levyForNight,
  levyInForce,
  roundMoney,
  type Levy,
  type LevyStay,
} from '@yohobed/domain';
import { routedWindow } from './windows';

/**
 * Levies on the folio (Development Phase 02, Sprint 7) — Malaysia's Tourism Tax.
 *
 * One folio line per levy per night, `source = 'levy'`, never inside the room price, so the room
 * charges still add up to `bookings.amount`. Two writers:
 *
 * - **night audit** posts the night just ending for every CheckedIn stay (a stay that never
 *   arrived is never charged — no levy on a no-show);
 * - **check-out** reconciles: posts any stayed night the audit did not (a Starter hotel has no
 *   night audit) and voids any night the guest did not stay (an early departure).
 *
 * Complimentary nights are charged: the levy is on the stay, not the price. A night already
 * posted on any window of the booking is never posted again; the partial unique index backs that
 * up per window.
 */

type Booking = typeof bookings.$inferSelect;

const money = (n: number) => n.toFixed(2);

async function leviesOf(tx: Tx, propertyId: string): Promise<Levy[]> {
  const rows = await tx
    .select()
    .from(propertyLevies)
    .where(and(eq(propertyLevies.propertyId, propertyId), eq(propertyLevies.active, true)))
    .orderBy(asc(propertyLevies.code));
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    amount: Number(r.amount),
    currency: r.currency,
    basis: 'per_room_per_night',
    appliesTo: r.appliesTo === 'all' ? 'all' : 'non_resident',
    validFrom: r.validFrom,
    validTo: r.validTo,
    registrationNo: r.registrationNo,
  }));
}

function stayOf(b: Booking): LevyStay {
  return {
    residency: isResidency(b.residency) ? b.residency : null,
    levyExempt: b.levyExempt,
    collectedByChannel: b.levyCollectedByChannel,
    rooms: b.rooms,
  };
}

/** The live levy lines of a booking, on every window. */
async function postedLevies(tx: Tx, bookingId: string) {
  return tx
    .select({
      id: folioCharges.id,
      levyCode: folioCharges.levyCode,
      bookingDate: folioCharges.bookingDate,
      folioId: folioCharges.folioId,
    })
    .from(folioCharges)
    .innerJoin(folios, eq(folios.id, folioCharges.folioId))
    .where(
      and(
        eq(folios.bookingId, bookingId),
        eq(folioCharges.source, 'levy'),
        isNull(folioCharges.voidedAt),
      ),
    );
}

/**
 * Post the levies for the given nights of a stay that are not posted yet. Returns the number of
 * lines written. The currency must be the property's — a levy in another currency is skipped.
 */
async function postNights(
  tx: Tx,
  tenantId: string,
  b: Booking,
  nights: string[],
  userId: string | null,
): Promise<number> {
  if (nights.length === 0) return 0;
  const levies = (await leviesOf(tx, b.propertyId)).filter((l) => l.currency === b.currency);
  if (levies.length === 0) return 0;
  const stay = stayOf(b);
  const already = await postedLevies(tx, b.id);
  const done = new Set(already.map((a) => `${a.levyCode}|${a.bookingDate}`));

  // Levies go where the lowest open window routing them says — window 1 unless the desk routed
  // them — and every line of one booking stays on one window (they move together).
  const current = already[0]?.folioId;
  const window = current
    ? { id: current }
    : await routedWindow(
        tx,
        tenantId,
        { id: b.id, propertyId: b.propertyId, currency: b.currency },
        'levy',
      );

  let written = 0;
  for (const levy of levies) {
    if (levyExemption(levy, stay) !== null) continue;
    for (const date of nights) {
      if (done.has(`${levy.code}|${date}`) || !levyInForce(levy, date)) continue;
      const total = levyForNight(levy, stay, date);
      if (total <= 0) continue;
      await tx.insert(folioCharges).values({
        tenantId,
        folioId: window.id,
        source: 'levy',
        levyCode: levy.code,
        description:
          stay.rooms > 1
            ? `${levy.name} — ${date} (${stay.rooms} rooms)`
            : `${levy.name} — ${date}`,
        postedFor: date,
        bookingDate: date,
        quantity: money(stay.rooms),
        unitPrice: money(levy.amount),
        net: money(total),
        tax: '0.00',
        total: money(total),
        postedByUserId: userId,
      });
      written += 1;
    }
  }
  return written;
}

/**
 * Night audit: the levy for the night `date` on every CheckedIn stay at the property that is in
 * house for it. Returns how many lines were posted.
 */
export async function postLeviesForNight(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  date: string,
  userId: string | null,
): Promise<number> {
  const levies = await leviesOf(tx, propertyId);
  if (levies.length === 0) return 0;
  const stays = await tx
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.propertyId, propertyId),
        eq(bookings.status, 'CheckedIn'),
        lt(bookings.checkin, nextDate(date)),
        gte(bookings.checkout, nextDate(date)),
      ),
    );
  let posted = 0;
  for (const b of stays) posted += await postNights(tx, tenantId, b, [date], userId);
  return posted;
}

/**
 * Check-out: the levy for exactly the nights stayed — from arrival to the night before
 * `departure` — posting what is missing and voiding what the guest did not stay.
 */
export async function reconcileLevies(
  tx: Tx,
  tenantId: string,
  b: Booking,
  departure: string,
  userId: string | null,
): Promise<{ posted: number; voided: number }> {
  const stayed: string[] = [];
  for (let d = b.checkin; d < departure && d < b.checkout; d = nextDate(d)) stayed.push(d);

  const already = await postedLevies(tx, b.id);
  const extra = already.filter((a) => a.bookingDate !== null && a.bookingDate >= departure);
  if (extra.length) {
    await tx
      .update(folioCharges)
      .set({
        voidedAt: new Date(),
        voidReason: 'Night not stayed — guest left early',
        voidedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(
        inArray(
          folioCharges.id,
          extra.map((e) => e.id),
        ),
      );
  }
  const posted = await postNights(tx, tenantId, b, stayed, userId);
  return { posted, voided: extra.length };
}

/**
 * Undo check-in: nothing was stayed, so any levy posted for the stay is voided with it.
 */
export async function voidAllLevies(
  tx: Tx,
  bookingId: string,
  reason: string,
  userId: string | null,
) {
  const live = await postedLevies(tx, bookingId);
  if (live.length === 0) return 0;
  await tx
    .update(folioCharges)
    .set({
      voidedAt: new Date(),
      voidReason: reason,
      voidedByUserId: userId,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        folioCharges.id,
        live.map((l) => l.id),
      ),
    );
  return live.length;
}

/** What a stay will owe in levies if it is stayed in full — for quotes and the pro-forma. */
export async function levyEstimate(
  tx: Tx,
  b: Pick<Booking, 'propertyId' | 'currency' | 'checkin' | 'checkout'> & LevyStay,
): Promise<Array<{ code: string; name: string; amount: number; nights: number; unit: number }>> {
  const levies = (await leviesOf(tx, b.propertyId)).filter((l) => l.currency === b.currency);
  const out: Array<{ code: string; name: string; amount: number; nights: number; unit: number }> =
    [];
  for (const levy of levies) {
    let amount = 0;
    let nights = 0;
    for (let d = b.checkin; d < b.checkout; d = nextDate(d)) {
      const n = levyForNight(levy, b, d);
      if (n > 0) {
        amount = roundMoney(amount + n);
        nights += 1;
      }
    }
    if (amount > 0)
      out.push({ code: levy.code, name: levy.name, amount, nights, unit: levy.amount });
  }
  return out;
}

function nextDate(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
