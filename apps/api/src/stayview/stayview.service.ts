import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  availabilityCalendar,
  bookingRooms,
  bookings,
  customers,
  maintenanceBlocks,
  occupancies,
  otaReservations,
  properties,
  rateCalendar,
  ratePlans,
  roomUnits,
  rooms,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { eachNight } from '../common/dates';

/** A booking occupying a room, or a maintenance block taking it out of service. */
export interface StayBar {
  kind: 'booking' | 'block';
  /** Leg id for a booking, block id for a block — what the UI acts on. */
  id: string;
  from: string;
  to: string;
  bookingId?: string;
  reference?: string;
  guestName?: string;
  status?: string;
  source?: string;
  channel?: string | null;
  groupId?: string | null;
  balanceDue?: boolean;
  reason?: string;
}

/**
 * The tape chart, in one request.
 *
 * Yanolja's Stay View is a single dense screen and it must feel instant, so this deliberately
 * assembles the whole window server-side rather than making the browser stitch six endpoints
 * together. Everything is bounded by the date window and one property, so the payload stays small
 * even for a large hotel.
 */
@Injectable()
export class StayViewService {
  constructor(private readonly dbs: DatabaseService) {}

  async get(tenantId: string, propertyId: string, from: string, to: string, ratePlanId?: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      // `to` is exclusive, matching the half-open convention used for stays everywhere else.
      const dates = eachNight(from, to);

      const [property] = await tx
        .select({ name: properties.name, code: properties.code, currency: properties.currency })
        .from(properties)
        .where(eq(properties.id, propertyId));

      const roomRows = await tx
        .select({ id: rooms.id, name: rooms.name, quantity: rooms.quantity })
        .from(rooms)
        .where(eq(rooms.propertyId, propertyId))
        .orderBy(asc(rooms.name));
      const roomIds = roomRows.map((r) => r.id);

      const unitRows = await tx
        .select({
          id: roomUnits.id,
          roomId: roomUnits.roomId,
          code: roomUnits.code,
          floor: roomUnits.floor,
          status: roomUnits.status,
          displayOrder: roomUnits.displayOrder,
        })
        .from(roomUnits)
        .where(eq(roomUnits.propertyId, propertyId))
        .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code));

      const [legRows, blockRows, availRows, rateRows] = await Promise.all([
        this.legsInWindow(tx, propertyId, from, to),
        this.blocksInWindow(tx, propertyId, from, to),
        roomIds.length
          ? tx
              .select({
                roomId: availabilityCalendar.roomId,
                date: availabilityCalendar.date,
                roomsToSell: availabilityCalendar.roomsToSell,
                status: availabilityCalendar.status,
              })
              .from(availabilityCalendar)
              .where(
                and(
                  inArray(availabilityCalendar.roomId, roomIds),
                  gte(availabilityCalendar.date, from),
                  lt(availabilityCalendar.date, to),
                ),
              )
          : Promise.resolve([]),
        this.ratesInWindow(tx, roomIds, from, to, ratePlanId),
      ]);

      // --- index everything by the keys the assembly needs -----------------
      const barsByUnit = new Map<string, StayBar[]>();
      const unassigned: StayBar[] = [];
      for (const l of legRows) {
        const bar: StayBar = {
          kind: 'booking',
          id: l.legId,
          from: l.checkin,
          to: l.checkout,
          bookingId: l.bookingId,
          reference: l.reference,
          guestName: l.guestName,
          status: l.status,
          source: l.source,
          channel: l.channel,
          groupId: l.groupId,
          balanceDue: Number(l.amount) > Number(l.paid ?? 0),
        };
        if (l.roomUnitId) {
          const list = barsByUnit.get(l.roomUnitId) ?? [];
          list.push(bar);
          barsByUnit.set(l.roomUnitId, list);
        } else {
          unassigned.push({ ...bar, roomId: l.roomId } as StayBar & { roomId: string });
        }
      }
      for (const b of blockRows) {
        const list = barsByUnit.get(b.roomUnitId) ?? [];
        list.push({
          kind: 'block',
          id: b.id,
          from: b.blockFrom,
          to: b.blockTo,
          reason: b.reason,
        });
        barsByUnit.set(b.roomUnitId, list);
      }

      const availByRoomDate = new Map(availRows.map((a) => [`${a.roomId}|${a.date}`, a]));
      const rateByRoomDate = new Map(rateRows.map((r) => [`${r.roomId}|${r.date}`, r.rate]));

      const roomTypes = roomRows.map((r) => ({
        roomId: r.id,
        name: r.name,
        quantity: r.quantity,
        perDate: dates.map((d) => {
          const a = availByRoomDate.get(`${r.id}|${d}`);
          return {
            date: d,
            available: a?.roomsToSell ?? null,
            closed: a?.status === 'Close',
            rate: rateByRoomDate.get(`${r.id}|${d}`) ?? null,
          };
        }),
        units: unitRows
          .filter((u) => u.roomId === r.id)
          .map((u) => ({ ...u, bars: barsByUnit.get(u.id) ?? [] })),
      }));

      // --- footers -----------------------------------------------------------
      const activeUnits = unitRows.filter((u) => u.status === 'active').length;
      const footer = dates.map((d) => {
        const sold = legRows.filter((l) => l.checkin <= d && d < l.checkout).length;
        const blocked = blockRows.filter((b) => b.blockFrom <= d && d < b.blockTo).length;
        // Yanolja divides by SELLABLE rooms, not physical ones: an 8-room property with one
        // blocked shows 5 sold as 71% (5/7), not 63%. Reproduced exactly.
        const sellable = Math.max(activeUnits - blocked, 0);
        return {
          date: d,
          soldRooms: sold,
          blocked,
          availableInventory: Math.max(sellable - sold, 0),
          totalRooms: activeUnits,
          occupancyPct: sellable > 0 ? Math.round((sold / sellable) * 100) : 0,
        };
      });

      return {
        property: { id: propertyId, ...property },
        from,
        to,
        dates,
        roomTypes,
        /** Legs with no room yet — Yanolja's "Default Unmapped Room" row. */
        unassigned,
        footer,
        counts: this.countsFor(from, legRows, blockRows, activeUnits),
      };
    });
  }

  /**
   * The counted filter chips, for the first date in the window (the "business date" the user
   * picked). Staff scan these numbers to decide where the day's work is.
   *
   * `Dirty` is absent until housekeeping lands in Sprint 4 — a chip permanently reading 0 would
   * be worse than no chip.
   */
  private countsFor(
    date: string,
    legs: Awaited<ReturnType<StayViewService['legsInWindow']>>,
    blocks: Array<{ roomUnitId: string; blockFrom: string; blockTo: string }>,
    activeUnits: number,
  ) {
    const on = legs.filter((l) => l.checkin <= date && date < l.checkout);
    const blockedNow = blocks.filter((b) => b.blockFrom <= date && date < b.blockTo).length;
    const occupied = on.filter((l) => l.status === 'CheckedIn').length;
    const reserved = on.filter((l) => l.status === 'Approved' || l.status === 'Pending').length;
    const dueOut = legs.filter((l) => l.checkout === date && l.status === 'CheckedIn').length;
    return {
      all: activeUnits,
      vacant: Math.max(activeUnits - on.length - blockedNow, 0),
      occupied,
      reserved,
      blocked: blockedNow,
      dueOut,
    };
  }

  /** Occupying legs overlapping the window, with just enough of the booking to draw a bar. */
  private legsInWindow(tx: Tx, propertyId: string, from: string, to: string) {
    return tx
      .select({
        legId: bookingRooms.id,
        roomUnitId: bookingRooms.roomUnitId,
        checkin: bookingRooms.checkin,
        checkout: bookingRooms.checkout,
        bookingId: bookings.id,
        roomId: bookings.roomId,
        reference: bookings.reference,
        status: bookings.status,
        source: bookings.source,
        groupId: bookings.groupId,
        amount: bookings.amount,
        paid: sql<string>`coalesce((
          select sum(p.amount) from payments p
          where p.booking_id = ${bookings.id} and p.direction = 'received'
        ), 0)`,
        guestName: customers.name,
        channel: otaReservations.channel,
      })
      .from(bookingRooms)
      .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(otaReservations, eq(otaReservations.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          isNull(bookingRooms.releasedAt),
          // Half-open overlap: a stay ending on `from` does not appear in the window.
          lt(bookingRooms.checkin, to),
          gt(bookingRooms.checkout, from),
        ),
      )
      .orderBy(asc(bookingRooms.checkin));
  }

  private blocksInWindow(tx: Tx, propertyId: string, from: string, to: string) {
    return tx
      .select({
        id: maintenanceBlocks.id,
        roomUnitId: maintenanceBlocks.roomUnitId,
        blockFrom: maintenanceBlocks.blockFrom,
        blockTo: maintenanceBlocks.blockTo,
        reason: maintenanceBlocks.reason,
      })
      .from(maintenanceBlocks)
      .where(
        and(
          eq(maintenanceBlocks.propertyId, propertyId),
          isNull(maintenanceBlocks.releasedAt),
          lt(maintenanceBlocks.blockFrom, to),
          gt(maintenanceBlocks.blockTo, from),
        ),
      );
  }

  /**
   * The cheapest selling price per room type per date — the number Yanolja prints under the
   * availability count on the room-type row. Optionally pinned to one rate plan.
   */
  private async ratesInWindow(
    tx: Tx,
    roomIds: string[],
    from: string,
    to: string,
    ratePlanId?: string,
  ): Promise<Array<{ roomId: string; date: string; rate: string }>> {
    if (roomIds.length === 0) return [];
    return tx
      .select({
        roomId: ratePlans.roomId,
        date: rateCalendar.date,
        rate: sql<string>`min(${rateCalendar.sellingPrice})`,
      })
      .from(rateCalendar)
      .innerJoin(occupancies, eq(occupancies.id, rateCalendar.occupancyId))
      .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
      .where(
        and(
          inArray(ratePlans.roomId, roomIds),
          gte(rateCalendar.date, from),
          lt(rateCalendar.date, to),
          ratePlanId ? eq(ratePlans.id, ratePlanId) : undefined,
        ),
      )
      .groupBy(ratePlans.roomId, rateCalendar.date);
  }

  /** The rate plans available to pin the chart to (Yanolja's "BB" selector). */
  listRatePlans(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({ id: ratePlans.id, roomId: ratePlans.roomId, status: ratePlans.status })
        .from(ratePlans)
        .where(and(eq(ratePlans.propertyId, propertyId), eq(ratePlans.status, 'Active'))),
    );
  }
}
