import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { resolvePropertySettings } from '@yohobed/domain';
import type { Database } from './client';
import type { Tx } from './scope';
import { releaseStay, reserveStay } from './inventory';
import { enqueueOutbox } from './outbox';
import { bookingApprovals, bookingRooms, bookings, notifications, properties } from './schema';

/**
 * The reservation lifecycle (Development Phase 02).
 *
 * Holds give their rooms back at their release time, the hotel is reminded before that happens,
 * and — where the owner asks for it — unconfirmed bookings are cancelled once their arrival day is
 * over. One implementation, two callers: the worker sweeps every minute so a hold is released on
 * time, and night audit sweeps before it marks no-shows so the day closes on the right picture.
 *
 * Everything here runs inside a tenant's RLS-scoped transaction. Rows are claimed with
 * `UPDATE … WHERE id IN (… FOR UPDATE SKIP LOCKED)`, so two sweepers running at once never release
 * the same hold twice.
 */

/** How many bookings one sweep handles per step; the rest wait for the next sweep. */
const BATCH = 200;

/** The part of a booking that decides what it holds. */
export interface InventoryBooking {
  id: string;
  tenantId: string;
  propertyId: string;
  roomId: string;
  checkin: string;
  checkout: string;
  rooms: number;
  inventoryReleasedFrom: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The nights of a half-open stay [from, to), as ISO dates. */
export function stayNights(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Today in a timezone, as 'YYYY-MM-DD'. A bad timezone falls back to UTC. */
export function localDateIn(timezone: string | null | undefined, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'UTC' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(at);
  }
}

/**
 * Where a no-show stops holding rooms: the night after the later of its arrival and the date it
 * was marked. That night stays held — it is the night the hotel may charge for — and the rest go
 * back on sale. Null when there is nothing left to give back.
 */
export function noShowReleaseFrom(
  checkin: string,
  checkout: string,
  markedOn: string,
): string | null {
  const from = addDays(markedOn > checkin ? markedOn : checkin, 1);
  return from < checkout ? from : null;
}

/**
 * Take a booking's rooms out of inventory for its whole stay, and tell the channel manager.
 * Throws InsufficientAvailabilityError — rolling back the caller's transaction — when a night is
 * full.
 */
export async function reserveBookingInventory(
  tx: Tx,
  b: InventoryBooking,
  origin = 'booking',
): Promise<string[]> {
  const nights = stayNights(b.checkin, b.checkout);
  await reserveStay(tx, b.roomId, nights, b.rooms);
  await enqueueOutbox(tx, {
    tenantId: b.tenantId,
    aggregate: 'availability',
    aggregateId: b.roomId,
    eventType: 'ari.availability',
    payload: {
      propertyId: b.propertyId,
      roomId: b.roomId,
      nights,
      rooms: b.rooms,
      action: 'reserve',
      origin,
    },
  });
  return nights;
}

/**
 * Give a booking's rooms back to inventory, and tell the channel manager.
 *
 * Without `from` the whole stay goes back and the physical rooms are freed: the legs are stamped
 * released, which keeps the record of which room each had. With `from` (a no-show keeping the
 * night it missed) only the nights from that date go back, and the legs are shortened to end
 * there. Nights an earlier partial release already gave back are never given back twice.
 *
 * The caller changes the booking's status; this only moves inventory. Returns the nights released.
 */
export async function releaseBookingInventory(
  tx: Tx,
  b: InventoryBooking,
  opts: { from?: string; origin?: string } = {},
): Promise<string[]> {
  const heldUntil =
    b.inventoryReleasedFrom && b.inventoryReleasedFrom < b.checkout
      ? b.inventoryReleasedFrom
      : b.checkout;
  const from = opts.from && opts.from > b.checkin ? opts.from : b.checkin;
  const nights = from < heldUntil ? stayNights(from, heldUntil) : [];

  if (nights.length > 0) {
    await releaseStay(tx, b.roomId, nights, b.rooms);
    await enqueueOutbox(tx, {
      tenantId: b.tenantId,
      aggregate: 'availability',
      aggregateId: b.roomId,
      eventType: 'ari.availability',
      payload: {
        propertyId: b.propertyId,
        roomId: b.roomId,
        nights,
        rooms: b.rooms,
        action: 'release',
        origin: opts.origin ?? 'booking',
      },
    });
  }

  const now = new Date();
  const liveLegs = and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt));
  if (from === b.checkin) {
    await tx.update(bookingRooms).set({ releasedAt: now, updatedAt: now }).where(liveLegs);
    return nights;
  }

  if (nights.length > 0) {
    // A leg that starts on or after the release point holds nothing any more.
    await tx
      .update(bookingRooms)
      .set({ releasedAt: now, updatedAt: now })
      .where(and(liveLegs, gte(bookingRooms.checkin, from)));
    await tx
      .update(bookingRooms)
      .set({ checkout: from, updatedAt: now })
      .where(and(liveLegs, lt(bookingRooms.checkin, from), gt(bookingRooms.checkout, from)));
    await tx
      .update(bookings)
      .set({ inventoryReleasedFrom: from, updatedAt: now })
      .where(eq(bookings.id, b.id));
  }
  return nights;
}

/** A booking the sweep changed. */
export interface SweptBooking {
  id: string;
  reference: string;
}

export interface LifecycleSweep {
  /** Holds whose release time passed: cancelled, rooms back on sale. */
  released: SweptBooking[];
  /** Unconfirmed bookings past their arrival day, where the property cancels those. */
  expired: SweptBooking[];
  /** Holds the hotel has now been reminded about. */
  reminded: number;
}

interface ClaimedRow extends InventoryBooking {
  reference: string;
  reservationKind: string;
}

const CLAIMED_COLUMNS = sql`
  id, tenant_id AS "tenantId", property_id AS "propertyId", room_id AS "roomId",
  checkin::text AS checkin, checkout::text AS checkout, rooms, reference,
  reservation_kind AS "reservationKind",
  inventory_released_from::text AS "inventoryReleasedFrom"`;

/** Run every lifecycle step for one tenant. */
export async function sweepReservationLifecycle(
  tx: Tx,
  tenantId: string,
  now: Date = new Date(),
): Promise<LifecycleSweep> {
  const released = await releaseDueHolds(tx, tenantId, now);
  const reminded = await remindDueHolds(tx, tenantId, now);
  const expired = await expireUnconfirmed(tx, tenantId, now);
  return { released, expired, reminded };
}

/** Tenants with lifecycle work due — the only query the worker makes without a tenant. */
export async function dueLifecycleTenants(
  db: Database | Tx,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = (await db.execute(
    sql`select lifecycle_due_tenants(${now.toISOString()}::timestamptz) as "tenantId"`,
  )) as unknown as Array<{ tenantId: string }>;
  return rows.map((r) => r.tenantId);
}

async function releaseDueHolds(tx: Tx, tenantId: string, now: Date): Promise<SweptBooking[]> {
  const rows = (await tx.execute(sql`
    UPDATE bookings SET status = 'Cancelled', updated_at = now()
     WHERE id IN (
       SELECT id FROM bookings
        WHERE hold_until IS NOT NULL
          AND hold_until <= ${now.toISOString()}::timestamptz
          AND status IN ('Pending', 'Approved')
        ORDER BY hold_until
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED)
    RETURNING ${CLAIMED_COLUMNS}
  `)) as unknown as ClaimedRow[];

  for (const b of rows) {
    // Every hold takes rooms, so every released hold has rooms to give back.
    await releaseBookingInventory(tx, b, { origin: 'hold_release' });
    await tx.insert(bookingApprovals).values({
      tenantId,
      bookingId: b.id,
      action: 'released',
      reason: 'hold_released',
    });
    await tx.insert(notifications).values({
      tenantId,
      type: 'hold_released',
      title: `Hold released — ${b.reference}`,
      body: `The hold on ${b.reference} (${b.checkin} → ${b.checkout}) reached its release time. Its rooms are back on sale.`,
      entity: 'booking',
      entityId: b.id,
    });
  }
  return rows.map((r) => ({ id: r.id, reference: r.reference }));
}

async function remindDueHolds(tx: Tx, tenantId: string, now: Date): Promise<number> {
  const candidates = await tx
    .select({
      id: bookings.id,
      reference: bookings.reference,
      holdUntil: bookings.holdUntil,
      checkin: bookings.checkin,
      settings: properties.settings,
    })
    .from(bookings)
    .innerJoin(properties, eq(properties.id, bookings.propertyId))
    .where(
      and(
        isNotNull(bookings.holdUntil),
        gt(bookings.holdUntil, now),
        isNull(bookings.holdRemindedAt),
        inArray(bookings.status, ['Pending', 'Approved']),
      ),
    )
    .limit(BATCH);

  let reminded = 0;
  for (const c of candidates) {
    const hours = resolvePropertySettings(c.settings).hold.reminderHours;
    if (hours <= 0 || !c.holdUntil) continue;
    if (c.holdUntil.getTime() - hours * 3_600_000 > now.getTime()) continue;

    // Claim the reminder, so a second sweeper running at the same moment does not repeat it.
    const claimed = await tx
      .update(bookings)
      .set({ holdRemindedAt: now })
      .where(and(eq(bookings.id, c.id), isNull(bookings.holdRemindedAt)))
      .returning({ id: bookings.id });
    if (claimed.length === 0) continue;

    const minutes = Math.max(1, Math.round((c.holdUntil.getTime() - now.getTime()) / 60_000));
    const left = minutes >= 90 ? `${Math.round(minutes / 60)} hours` : `${minutes} minutes`;
    await tx.insert(notifications).values({
      tenantId,
      type: 'hold_reminder',
      title: `Hold ends soon — ${c.reference}`,
      body: `The hold on ${c.reference} (arriving ${c.checkin}) releases its rooms in about ${left}. Confirm it or extend the hold to keep them.`,
      entity: 'booking',
      entityId: c.id,
    });
    reminded += 1;
  }
  return reminded;
}

async function expireUnconfirmed(tx: Tx, tenantId: string, now: Date): Promise<SweptBooking[]> {
  const props = await tx
    .select({ id: properties.id, timezone: properties.timezone, settings: properties.settings })
    .from(properties);

  const expired: SweptBooking[] = [];
  for (const p of props) {
    if (resolvePropertySettings(p.settings).unconfirmedPolicy !== 'arrival_day_end') continue;
    const today = localDateIn(p.timezone, now);

    const rows = (await tx.execute(sql`
      UPDATE bookings SET status = 'Cancelled', updated_at = now()
       WHERE id IN (
         SELECT id FROM bookings
          WHERE property_id = ${p.id}
            AND status = 'Pending'
            AND checkin < ${today}::date
          ORDER BY checkin
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING ${CLAIMED_COLUMNS}
    `)) as unknown as ClaimedRow[];

    for (const b of rows) {
      if (b.reservationKind === 'hold_unconfirm') {
        await releaseBookingInventory(tx, b, { origin: 'unconfirmed_expired' });
      } else {
        // An inquiry holds no rooms; its legs only need closing.
        await tx
          .update(bookingRooms)
          .set({ releasedAt: now, updatedAt: now })
          .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
      }
      await tx.insert(bookingApprovals).values({
        tenantId,
        bookingId: b.id,
        action: 'cancelled',
        reason: 'unconfirmed_expired',
      });
      await tx.insert(notifications).values({
        tenantId,
        type: 'booking_expired',
        title: `Unconfirmed booking cancelled — ${b.reference}`,
        body: `${b.reference} was still unconfirmed after its arrival day (${b.checkin}), so it was cancelled.`,
        entity: 'booking',
        entityId: b.id,
      });
      expired.push({ id: b.id, reference: b.reference });
    }
  }
  return expired;
}
