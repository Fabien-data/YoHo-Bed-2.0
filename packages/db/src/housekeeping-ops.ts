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

export type HousekeepingState = 'dirty' | 'clean' | 'inspected' | 'out_of_order';

export interface HousekeepingAsOf {
  roomUnitId: string;
  status: HousekeepingState;
  remarks: string | null;
  assignedToUserId: string | null;
  /** The day the status was set — earlier than the asked date when carried forward. */
  since: string;
}

/**
 * Each room's housekeeping state AS OF a date: its latest record on or before that day.
 *
 * Rows are written only when something happens to a room, so a status has to carry forward until
 * the next event. Reading just the day's own row (as every screen once did) meant a room left dirty
 * at close of day read "clean" the next morning — the next arrival could be sold a dirty room
 * (UX-1a). A room with no record at all has never been touched, and is clean.
 */
export async function housekeepingAsOf(
  tx: Tx,
  propertyId: string,
  date: string,
): Promise<Map<string, HousekeepingAsOf>> {
  const rows = (await tx.execute(sql`
    select distinct on (room_unit_id)
      room_unit_id as "roomUnitId",
      status,
      remarks,
      assigned_to_user_id as "assignedToUserId",
      date::text as since
    from housekeeping_status
    where property_id = ${propertyId} and date <= ${date}::date
    order by room_unit_id, date desc
  `)) as unknown as HousekeepingAsOf[];
  return new Map(rows.map((r) => [r.roomUnitId, r]));
}

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

/** Reconcile the day's arrival queue with the current room assignments and VIP flags. */
export async function reconcileArrivalPreparation(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  date: string,
) {
  const arrivals = await tx
    .select({ roomUnitId: bookingRooms.roomUnitId, bookingId: bookings.id, vip: customers.vip })
    .from(bookingRooms)
    .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(
      and(
        eq(bookings.propertyId, propertyId),
        isNull(bookingRooms.releasedAt),
        eq(bookingRooms.checkin, date),
        sql`${bookings.status} in ('Pending', 'Approved')`,
      ),
    );
  const byRoom = new Map(arrivals.filter((a) => a.roomUnitId).map((a) => [a.roomUnitId!, a]));
  const existing = await tx
    .select()
    .from(housekeepingTasks)
    .where(
      and(
        eq(housekeepingTasks.propertyId, propertyId),
        eq(housekeepingTasks.date, date),
        eq(housekeepingTasks.kind, 'arrival_prep'),
      ),
    );
  for (const task of existing) {
    if (!byRoom.has(task.roomUnitId) && task.status !== 'cancelled' && task.status !== 'done') {
      await tx
        .update(housekeepingTasks)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(housekeepingTasks.id, task.id));
    }
  }
  let created = 0;
  for (const [roomUnitId, arrival] of byRoom) {
    const previous = existing.find((task) => task.roomUnitId === roomUnitId);
    if (!previous) created++;
    await tx
      .insert(housekeepingTasks)
      .values({
        tenantId,
        propertyId,
        roomUnitId,
        date,
        kind: 'arrival_prep',
        bookingId: arrival.bookingId,
        rush: arrival.vip,
      })
      .onConflictDoUpdate({
        target: [housekeepingTasks.roomUnitId, housekeepingTasks.date, housekeepingTasks.kind],
        set: {
          bookingId: arrival.bookingId,
          rush: arrival.vip,
          status:
            previous?.bookingId === arrival.bookingId && previous.status !== 'cancelled'
              ? previous.status
              : 'queued',
          completedAt:
            previous?.bookingId === arrival.bookingId && previous.status === 'done'
              ? previous.completedAt
              : null,
          updatedAt: new Date(),
        },
      });
  }
  return created;
}

/**
 * Called inside check-out's transaction so the room and task change together.
 *
 * Only the rooms the guest is leaving now: for each room of the booking, its latest dated segment.
 * An earlier segment of a split stay is a room the guest moved out of days ago — it was turned
 * over at the move (`markRoomVacated`), and dirtying it again would undo that cleaning.
 *
 * `departedOn` is for a check-out recorded after the departure day (the automatic check-out of a
 * stay nobody checked out). Then a room is only made dirty if nothing has happened to it since the
 * guest was due to leave: no housekeeping record from that day on, and nobody else in it now.
 * Otherwise the late check-out would undo a cleaning, or dirty a room a new guest is using.
 */
export async function enqueueDepartureCleaning(
  tx: Tx,
  tenantId: string,
  propertyId: string,
  bookingId: string,
  date: string,
  opts: { departedOn?: string } = {},
) {
  const segments = await tx
    .select({
      legIndex: bookingRooms.legIndex,
      checkin: bookingRooms.checkin,
      roomUnitId: bookingRooms.roomUnitId,
    })
    .from(bookingRooms)
    .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)));
  const current = new Map<number, (typeof segments)[number]>();
  for (const s of segments) {
    const seen = current.get(s.legIndex);
    if (!seen || s.checkin > seen.checkin) current.set(s.legIndex, s);
  }
  for (const leg of current.values()) {
    if (!leg.roomUnitId) continue;
    if (
      opts.departedOn &&
      opts.departedOn < date &&
      (await roomUsedSince(tx, leg.roomUnitId, bookingId, opts.departedOn, date))
    )
      continue;
    const [inserted] = await tx
      .insert(housekeepingTasks)
      .values({
        tenantId,
        propertyId,
        roomUnitId: leg.roomUnitId,
        date,
        kind: 'departure',
        bookingId,
      })
      .onConflictDoNothing()
      .returning({ id: housekeepingTasks.id });
    if (!inserted) {
      const [current] = await tx
        .select({ id: housekeepingTasks.id, bookingId: housekeepingTasks.bookingId })
        .from(housekeepingTasks)
        .where(
          and(
            eq(housekeepingTasks.roomUnitId, leg.roomUnitId),
            eq(housekeepingTasks.date, date),
            eq(housekeepingTasks.kind, 'departure'),
          ),
        )
        .for('update');
      if (current?.bookingId === bookingId) continue;
      if (current)
        await tx
          .update(housekeepingTasks)
          .set({ bookingId, status: 'queued', completedAt: null, updatedAt: new Date() })
          .where(eq(housekeepingTasks.id, current.id));
    }
    await tx
      .insert(housekeepingStatus)
      .values({ tenantId, propertyId, roomUnitId: leg.roomUnitId, date, status: 'dirty' })
      .onConflictDoUpdate({
        target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
        set: { status: 'dirty', changedAt: new Date(), updatedAt: new Date() },
      });
  }
}

/**
 * Has anything happened to a room since `since` — a housekeeping record on or after that day, or
 * another guest staying in it on `today`? Decides whether a late check-out may still dirty it.
 */
async function roomUsedSince(
  tx: Tx,
  roomUnitId: string,
  bookingId: string,
  since: string,
  today: string,
): Promise<boolean> {
  const [row] = (await tx.execute(sql`
    select exists (
             select 1 from housekeeping_status hs
              where hs.room_unit_id = ${roomUnitId} and hs.date >= ${since}::date
           )
        or exists (
             select 1 from booking_rooms br
               join bookings b on b.id = br.booking_id
              where br.room_unit_id = ${roomUnitId}
                and br.booking_id <> ${bookingId}
                and br.released_at is null
                and b.status = 'CheckedIn'
                and br.checkin <= ${today}::date
                and br.checkout > ${today}::date
           ) as used
  `)) as unknown as Array<{ used: boolean }>;
  return Boolean(row?.used);
}

/**
 * A guest has just left this room mid-stay (a room move), so it needs turning over: it reads dirty
 * from `date`, and housekeeping gets a departure clean. Idempotent — a retried move neither
 * duplicates the task nor undoes a clean that already happened on a later date.
 */
export async function markRoomVacated(
  tx: Tx,
  v: { tenantId: string; propertyId: string; roomUnitId: string; date: string; bookingId: string },
) {
  await tx
    .insert(housekeepingTasks)
    .values({
      tenantId: v.tenantId,
      propertyId: v.propertyId,
      roomUnitId: v.roomUnitId,
      date: v.date,
      kind: 'departure',
      bookingId: v.bookingId,
      notes: 'Room move turnover',
    })
    .onConflictDoNothing();
  await tx
    .insert(housekeepingStatus)
    .values({
      tenantId: v.tenantId,
      propertyId: v.propertyId,
      roomUnitId: v.roomUnitId,
      date: v.date,
      status: 'dirty',
    })
    .onConflictDoUpdate({
      target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
      set: { status: 'dirty', changedAt: new Date(), updatedAt: new Date() },
    });
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
        await markRoomVacated(sp, {
          tenantId,
          propertyId,
          roomUnitId: move.fromRoomUnitId,
          date,
          bookingId: move.bookingId,
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
  let arrivals = 0;
  let moved = 0;
  for (const p of due) {
    const result = await withTenant(db, p.tenantId, async (tx) => ({
      created: await sweepStayoverCleaning(tx, p.tenantId, p.propertyId, p.localDate),
      arrivals: await reconcileArrivalPreparation(tx, p.tenantId, p.propertyId, p.localDate),
      moved: await applyPlannedRoomMoves(tx, p.tenantId, p.propertyId, p.localDate),
    }));
    created += result.created;
    arrivals += result.arrivals;
    moved += result.moved;
  }
  return { properties: due.length, created, arrivals, moved };
}
