import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  availabilityCalendar,
  bookingGroups,
  bookingRooms,
  bookings,
  businessSources,
  customers,
  housekeepingAsOf,
  maintenanceBlocks,
  occupancies,
  otaReservations,
  properties,
  rateCalendar,
  ratePlans,
  roomUnits,
  rooms,
  users,
  type Tx,
} from '@yohobed/db';
import { nightAuditDueAt, resolvePropertySettings } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { deskBalance, extrasSql, paidSql } from '../bookings/balance';
import { eachNight } from '../common/dates';
import { localToday, propertyBusinessDate } from '../common/local-date';

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
  /** Yanolja's reservation type (Development Phase 02). */
  reservationKind?: string;
  /** When a hold gives its rooms back — the bar's tooltip. */
  holdUntil?: string | null;
  /** The business source's short code and palette colour, which colour the bar. */
  sourceCode?: string | null;
  sourceColor?: string | null;
  /** On a tentative bar: the room the guest asked for. */
  preferredRoomUnitId?: string | null;
  roomId?: string;
  adults?: number;
  children?: number;
  /** A VIP stay or a VIP guest: the crown. */
  vip?: boolean;
  /** The desk flagged this stay VIP (2026-09-26), as opposed to the guest's profile. */
  vipStay?: boolean;
  hasNotes?: boolean;
  amount?: string;
  balance?: string;
  /** The physical room, or null for a stay not yet given one. */
  roomUnitId?: string | null;
  /** Which room of the reservation this is (0-based), and the leg's version for safe edits. */
  legIndex?: number;
  legUpdatedAt?: string;
  /**
   * A stay moved mid-way lives in several rooms, one dated segment each. `of` > 1 marks a split
   * stay; `index` is this segment's place in it, counted over the whole stay, not just the window.
   */
  segment?: { index: number; of: number };
  groupCode?: string | null;
  /** On a block: what it is for. */
  blockKind?: 'out_of_service' | 'blocked';
  blockedBy?: string | null;
}

/** A stay leaving a room on the chips' day — shown on the room even when its bar is off screen. */
export interface StayDeparture {
  bookingId: string;
  reference: string;
  guestName: string;
  balanceDue?: boolean;
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

  async get(
    tenantId: string,
    propertyId: string,
    from: string,
    to: string,
    ratePlanId?: string,
    showFinancial = true,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      // `to` is exclusive, matching the half-open convention used for stays everywhere else.
      const dates = eachNight(from, to);

      const [property] = await tx
        .select({
          name: properties.name,
          code: properties.code,
          currency: properties.currency,
          timezone: properties.timezone,
          settings: properties.settings,
        })
        .from(properties)
        .where(eq(properties.id, propertyId));
      const settings = resolvePropertySettings(property?.settings);
      // The hotel's own today, in its timezone — the browser's clock may be elsewhere. The chips,
      // housekeeping and "due out" describe today whenever today is on screen, otherwise the
      // window's first day.
      const today = localToday(property?.timezone);
      const business = await propertyBusinessDate(tx, propertyId, property?.timezone ?? null);
      const operatingDate = business.date > today ? business.date : today;
      const anchor = from <= today && today < to ? today : from;

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
          displayName: roomUnits.displayName,
          floor: roomUnits.floor,
          status: roomUnits.status,
          displayOrder: roomUnits.displayOrder,
          notes: roomUnits.notes,
          smokingPolicy: roomUnits.smokingPolicy,
          wheelchairAccessible: roomUnits.wheelchairAccessible,
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
        showFinancial ? this.ratesInWindow(tx, roomIds, from, to, ratePlanId) : Promise.resolve([]),
      ]);

      // The Dirty chip counts rooms dirty AS OF the picked date: a room left dirty yesterday is
      // still dirty today until someone cleans it (UX-1a).
      const housekeepingByUnit = await housekeepingAsOf(tx, propertyId, anchor);
      const dirty = [...housekeepingByUnit.values()].filter((h) => h.status === 'dirty').length;

      // Due-out cannot come from the drawn legs: a stay ending exactly on `from` is excluded by
      // the window overlap (checkout is exclusive), so counting it there always returned 0 for
      // the very date the chips describe.
      const [dueOutRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .where(
          and(
            eq(bookings.propertyId, propertyId),
            isNull(bookingRooms.releasedAt),
            eq(bookingRooms.checkout, anchor),
            // A room move ends one segment mid-stay; only the stay's last night is a departure.
            eq(bookingRooms.checkout, bookings.checkout),
            eq(bookings.status, 'CheckedIn'),
          ),
        );
      const dueOut = dueOutRow?.n ?? 0;

      // Who leaves each room on that day. A departure on the window's first day has no night in
      // the window, so its bar is not drawn — the room still has to say "due out", or the Due out
      // chip would find the count but hide every room (owner brief, 2026-09-26).
      const departureRows = await tx
        .select({
          roomUnitId: bookingRooms.roomUnitId,
          bookingId: bookings.id,
          reference: bookings.reference,
          guestName: customers.name,
          amount: bookings.amount,
          discount: bookings.discount,
          paid: paidSql(bookings.id),
          extras: extrasSql(bookings.id),
        })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .where(
          and(
            eq(bookings.propertyId, propertyId),
            isNull(bookingRooms.releasedAt),
            eq(bookingRooms.checkout, anchor),
            eq(bookingRooms.checkout, bookings.checkout),
            eq(bookings.status, 'CheckedIn'),
          ),
        );
      const departuresByUnit = new Map<string, StayDeparture[]>();
      for (const d of departureRows) {
        if (!d.roomUnitId) continue;
        const list = departuresByUnit.get(d.roomUnitId) ?? [];
        list.push({
          bookingId: d.bookingId,
          reference: d.reference,
          guestName: d.guestName,
          ...(showFinancial ? { balanceDue: deskBalance(d).due } : {}),
        });
        departuresByUnit.set(d.roomUnitId, list);
      }

      // --- index everything by the keys the assembly needs -----------------
      const barsByUnit = new Map<string, StayBar[]>();
      const unassigned: StayBar[] = [];
      // Bookings that hold no rooms (inquiries, failed online bookings) get their own lane: they
      // are on the hotel's radar, but they occupy nothing and are never counted as sold.
      const tentative: Array<StayBar & { roomId: string }> = [];
      for (const l of legRows) {
        const money = deskBalance(l);
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
          balanceDue: showFinancial ? money.due : undefined,
          reservationKind: l.reservationKind,
          holdUntil: l.holdUntil?.toISOString() ?? null,
          sourceCode: l.sourceCode,
          sourceColor: l.sourceColor,
          roomId: l.roomId,
          adults: l.adults,
          children: l.children,
          vip: l.vip,
          vipStay: l.vipStay,
          hasNotes: l.hasNotes,
          // The bill's total — the room after any coupon, plus extras — like the Reservations list.
          amount: showFinancial ? money.total : undefined,
          balance: showFinancial ? money.balance : undefined,
          roomUnitId: l.roomUnitId,
          legIndex: l.legIndex,
          legUpdatedAt: l.legUpdatedAt.toISOString(),
          segment: { index: l.segmentIndex, of: l.segmentOf },
          groupCode: l.groupCode,
        };
        if (!l.inventoryHeld) {
          tentative.push({ ...bar, roomId: l.roomId, preferredRoomUnitId: l.preferredRoomUnitId });
          continue;
        }
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
          blockKind: b.kind as 'out_of_service' | 'blocked',
          blockedBy: b.blockedBy,
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
          .map((u) => ({
            ...u,
            housekeeping: housekeepingByUnit.get(u.id)?.status ?? 'clean',
            housekeepingNotes: housekeepingByUnit.get(u.id)?.remarks ?? null,
            bars: barsByUnit.get(u.id) ?? [],
            departures: departuresByUnit.get(u.id) ?? [],
          })),
      }));

      // --- footers -----------------------------------------------------------
      const activeUnits = unitRows.filter((u) => u.status === 'active').length;
      const heldLegs = legRows.filter((l) => l.inventoryHeld);
      const footer = dates.map((d) => {
        const sold = heldLegs.filter((l) => l.checkin <= d && d < l.checkout).length;
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
        /** The property's calendar today, and the date the desk works to (night audit aware). */
        today,
        operatingDate,
        businessDate: business.date,
        dates,
        roomTypes,
        /** Legs with no room yet — Yanolja's "Default Unmapped Room" row. */
        unassigned,
        /** Bookings that hold no rooms yet (inquiries), drawn in their own lane. */
        tentative,
        footer,
        counts: {
          /** The day the chips describe: today when it is on screen, else the first day. */
          date: anchor,
          ...this.countsFor(anchor, heldLegs, blockRows, activeUnits),
          tentative: tentative.filter((t) => t.from <= anchor && anchor < t.to).length,
          dirty,
          dueOut,
          // Rooms whose guest owes money on that day: staying, arriving or leaving. Money, so
          // only for those who may see it.
          paymentDue: showFinancial
            ? this.paymentDueRooms(anchor, legRows, departureRows)
            : undefined,
        },
        /** How the day closes by itself, so the calendar can say so instead of nagging. */
        dayClose: {
          autoCheckout: settings.autoCheckout,
          nightAudit: settings.nightAudit.mode,
          auditTime: settings.nightAudit.time,
          auditDueAt:
            settings.nightAudit.mode === 'auto' && business.source === 'night_audit'
              ? nightAuditDueAt(business.date, settings.nightAudit.time)
              : null,
        },
      };
    });
  }

  /**
   * The counted filter chips, for the first date in the window (the "business date" the user
   * picked). Staff scan these numbers to decide where the day's work is.
   *
   * `dirty` is added by the caller from `housekeeping_status`, which is why it is not computed here.
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
    return {
      all: activeUnits,
      vacant: Math.max(activeUnits - on.length - blockedNow, 0),
      occupied,
      reserved,
      blocked: blockedNow,
    };
  }

  /** Rooms with a guest who owes money on `date` — staying that night, or leaving that morning. */
  private paymentDueRooms(
    date: string,
    legs: Awaited<ReturnType<StayViewService['legsInWindow']>>,
    departures: Array<{
      roomUnitId: string | null;
      amount: string;
      discount: string;
      paid: string;
      extras: string;
    }>,
  ): number {
    const rooms = new Set<string>();
    for (const l of legs)
      if (
        l.roomUnitId &&
        l.inventoryHeld &&
        (l.status === 'Approved' || l.status === 'Pending' || l.status === 'CheckedIn') &&
        l.checkin <= date &&
        date < l.checkout &&
        deskBalance(l).due
      )
        rooms.add(l.roomUnitId);
    for (const d of departures) if (d.roomUnitId && deskBalance(d).due) rooms.add(d.roomUnitId);
    return rooms.size;
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
        reservationKind: bookings.reservationKind,
        inventoryHeld: bookings.inventoryHeld,
        holdUntil: bookings.holdUntil,
        preferredRoomUnitId: bookingRooms.preferredRoomUnitId,
        sourceCode: businessSources.shortCode,
        sourceColor: businessSources.palette,
        source: bookings.source,
        groupId: bookings.groupId,
        amount: bookings.amount,
        discount: bookings.discount,
        paid: paidSql(bookings.id),
        extras: extrasSql(bookings.id),
        guestName: customers.name,
        adults: bookingRooms.adults,
        children: bookingRooms.children,
        legIndex: bookingRooms.legIndex,
        legUpdatedAt: bookingRooms.updatedAt,
        // Split stays: how many dated segments this room of the reservation has, and which one
        // this is. Counted over the whole stay, so a segment outside the window still counts.
        segmentOf: sql<number>`(
          select count(*) from booking_rooms s
          where s.booking_id = booking_rooms.booking_id
            and s.leg_index = booking_rooms.leg_index
            and s.released_at is null
        )::int`,
        segmentIndex: sql<number>`(
          select count(*) from booking_rooms s
          where s.booking_id = booking_rooms.booking_id
            and s.leg_index = booking_rooms.leg_index
            and s.released_at is null
            and s.checkin < booking_rooms.checkin
        )::int`,
        groupCode: bookingGroups.code,
        vip: sql<boolean>`(${bookings.isVip} or ${customers.vip})`,
        vipStay: bookings.isVip,
        hasNotes: sql<boolean>`exists(select 1 from booking_remarks r where r.booking_id = ${bookings.id})`,
        channel: otaReservations.channel,
      })
      .from(bookingRooms)
      .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(otaReservations, eq(otaReservations.bookingId, bookings.id))
      .leftJoin(businessSources, eq(businessSources.id, bookings.businessSourceId))
      .leftJoin(bookingGroups, eq(bookingGroups.id, bookings.groupId))
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
        kind: maintenanceBlocks.kind,
        blockedBy: users.name,
      })
      .from(maintenanceBlocks)
      .leftJoin(users, eq(users.id, maintenanceBlocks.blockedByUserId))
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
