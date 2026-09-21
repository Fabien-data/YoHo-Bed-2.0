import { and, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Database } from './client';
import type { Tx } from './scope';
import { withTenant } from './scope';
import {
  bookingRooms,
  bookings,
  customers,
  housekeepingStatus,
  housekeepingTasks,
  roomMoves,
} from './schema';

/** Returns only properties whose local clock has passed 02:00. The SQL function is SECURITY DEFINER. */
export async function housekeepingDueProperties(db: Database, at: Date = new Date()) {
  return (await db.execute(
    sql`select * from housekeeping_due_properties(${at.toISOString()}::timestamptz)`,
  )) as unknown as Array<{ tenantId: string; propertyId: string; localDate: string }>;
}

/** Task uniqueness makes retries safe: a later sweep never dirties a room cleaned after 02:00. */
export async function sweepStayoverCleaning(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  date: string,
) {
  const stays = await tx
    .select({ roomUnitId: bookingRooms.roomUnitId, bookingId: bookings.id, vip: customers.vip })
    .from(bookingRooms)
    .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(
      and(
        eq(bookings.propertyId, propertyId),
        eq(bookings.status, 'CheckedIn'),
        isNull(bookingRooms.releasedAt),
        lt(bookingRooms.checkin, date),
        gt(bookingRooms.checkout, date),
      ),
    );
  let created = 0;
  for (const stay of stays) {
    if (!stay.roomUnitId) continue;
    const [task] = await tx
      .insert(housekeepingTasks)
      .values({
        tenantId,
        propertyId,
        roomUnitId: stay.roomUnitId,
        date,
        kind: 'stayover',
        bookingId: stay.bookingId,
        rush: stay.vip,
      })
      .onConflictDoNothing()
      .returning({ id: housekeepingTasks.id });
    if (!task) continue;
    created++;
    await tx
      .insert(housekeepingStatus)
      .values({ tenantId, propertyId, roomUnitId: stay.roomUnitId, date, status: 'dirty' })
      .onConflictDoUpdate({
        target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
        set: { status: 'dirty', changedAt: new Date(), updatedAt: new Date() },
      });
  }
  return created;
}

/** Called inside check-out's transaction so the room and task change together. */
export async function enqueueDepartureCleaning(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  bookingId: string,
  date: string,
) {
  const legs = await tx
    .select({ roomUnitId: bookingRooms.roomUnitId })
    .from(bookingRooms)
    .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)));
  for (const leg of legs) {
    if (!leg.roomUnitId) continue;
    await tx
      .insert(housekeepingTasks)
      .values({
        tenantId,
        propertyId,
        roomUnitId: leg.roomUnitId,
        date,
        kind: 'departure',
        bookingId,
      })
      .onConflictDoNothing();
    await tx
      .insert(housekeepingStatus)
      .values({ tenantId, propertyId, roomUnitId: leg.roomUnitId, date, status: 'dirty' })
      .onConflictDoUpdate({
        target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
        set: { status: 'dirty', changedAt: new Date(), updatedAt: new Date() },
      });
  }
}

/** Apply due planned moves by splitting the dated room leg, preserving both sides of its history. */
export async function applyPlannedRoomMoves(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  date: string,
) {
  const due = await tx
    .select({ move: roomMoves })
    .from(roomMoves)
    .innerJoin(bookings, eq(bookings.id, roomMoves.bookingId))
    .where(
      and(
        eq(roomMoves.propertyId, propertyId),
        eq(roomMoves.status, 'planned'),
        lte(roomMoves.effectiveDate, date),
        sql`${bookings.status} in ('Approved', 'CheckedIn')`,
      ),
    );

  let completed = 0;
  for (const row of due) {
    try {
      await tx.transaction(async (sp) => {
        const [move] = await sp
          .select()
          .from(roomMoves)
          .where(and(eq(roomMoves.id, row.move.id), eq(roomMoves.status, 'planned')))
          .for('update');
        if (!move) return;
        const [leg] = await sp
          .select()
          .from(bookingRooms)
          .where(eq(bookingRooms.id, move.legId))
          .for('update');
        if (
          !leg ||
          !leg.roomUnitId ||
          leg.roomUnitId !== move.fromRoomUnitId ||
          leg.checkout <= move.effectiveDate
        ) {
          await sp
            .update(roomMoves)
            .set({ status: 'stopped', stoppedAt: new Date() })
            .where(eq(roomMoves.id, move.id));
          return;
        }

        let destinationLegId = leg.id;
        if (move.effectiveDate > leg.checkin) {
          await sp
            .update(bookingRooms)
            .set({ checkout: move.effectiveDate, updatedAt: new Date() })
            .where(eq(bookingRooms.id, leg.id));
          const [destination] = await sp
            .insert(bookingRooms)
            .values({
              tenantId,
              bookingId: leg.bookingId,
              roomUnitId: move.toRoomUnitId,
              legIndex: leg.legIndex,
              checkin: move.effectiveDate,
              checkout: leg.checkout,
              adults: leg.adults,
              children: leg.children,
              childAges: leg.childAges,
              extraBeds: leg.extraBeds,
            })
            .returning({ id: bookingRooms.id });
          destinationLegId = destination!.id;
          // A second future move for the same logical room continues from this new segment.
          await sp
            .update(roomMoves)
            .set({ legId: destinationLegId })
            .where(
              and(
                eq(roomMoves.legId, leg.id),
                eq(roomMoves.status, 'planned'),
                gt(roomMoves.effectiveDate, move.effectiveDate),
              ),
            );
        } else {
          await sp
            .update(bookingRooms)
            .set({ roomUnitId: move.toRoomUnitId, updatedAt: new Date() })
            .where(eq(bookingRooms.id, leg.id));
        }

        await sp
          .update(roomMoves)
          .set({ status: 'completed', destinationLegId, appliedAt: new Date() })
          .where(eq(roomMoves.id, move.id));
        await sp
          .insert(housekeepingTasks)
          .values({
            tenantId,
            propertyId,
            roomUnitId: move.fromRoomUnitId,
            date,
            kind: 'departure',
            bookingId: move.bookingId,
            notes: 'Room move turnover',
          })
          .onConflictDoNothing();
        await sp
          .insert(housekeepingStatus)
          .values({ tenantId, propertyId, roomUnitId: move.fromRoomUnitId, date, status: 'dirty' })
          .onConflictDoUpdate({
            target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
            set: { status: 'dirty', changedAt: new Date(), updatedAt: new Date() },
          });
        completed++;
      });
    } catch (error) {
      // Leave it planned: the next sweep retries after the desk resolves a last-minute conflict.
      console.error(`[room-move] failed to apply ${row.move.id}`, error);
    }
  }
  return completed;
}

/** Worker entry point; each property is isolated in its own RLS transaction. */
export async function sweepHousekeeping(db: Database, at: Date = new Date()) {
  const due = await housekeepingDueProperties(db, at);
  let created = 0;
  let moved = 0;
  for (const p of due) {
    const result = await withTenant(db, p.tenantId, async (tx) => ({
      created: await sweepStayoverCleaning(tx, p.tenantId, p.propertyId, p.localDate),
      moved: await applyPlannedRoomMoves(tx, p.tenantId, p.propertyId, p.localDate),
    }));
    created += result.created;
    moved += result.moved;
  }
  return { properties: due.length, created, moved };
}
