import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  bookingGroups,
  bookingRooms,
  bookings,
  customers,
  otaReservations,
  properties,
  roomUnits,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { MakeGroupDto, ReservationQueryDto } from './dto';

/** The tabs across the top of Yanolja's Reservations screen, each carrying its live count. */
export type ReservationTab = 'all' | 'arrivals' | 'departures' | 'inhouse' | 'cancelled';

@Injectable()
export class ReservationsService {
  constructor(private readonly dbs: DatabaseService) {}

  /**
   * The Reservations list: one tab's rows plus every tab's count.
   *
   * Counts come back on every request rather than only for the active tab, because the numbers
   * are the navigation — staff pick a tab *because* it says 4, and a stale count sends them to an
   * empty screen.
   */
  async search(tenantId: string, q: ReservationQueryDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const date = q.date;

      const [rows, counts] = await Promise.all([
        this.rowsFor(tx, q),
        this.countsFor(tx, q.propertyId, date),
      ]);

      return { date, tab: q.tab, counts, rows };
    });
  }

  /** The predicate that defines each tab. Kept in one place so counts and rows cannot diverge. */
  private tabFilter(tab: ReservationTab, date: string) {
    switch (tab) {
      case 'arrivals':
        // Due to arrive: booked for today and not yet walked in.
        return and(eq(bookings.checkin, date), sql`${bookings.status} in ('Pending', 'Approved')`);
      case 'departures':
        // Due to leave today and still in the building — the 11am chase list.
        return and(eq(bookings.checkout, date), eq(bookings.status, 'CheckedIn'));
      case 'inhouse':
        return and(
          lte(bookings.checkin, date),
          gt(bookings.checkout, date),
          eq(bookings.status, 'CheckedIn'),
        );
      case 'cancelled':
        return sql`${bookings.status} in ('Cancelled', 'Rejected', 'NoShow')`;
      case 'all':
      default:
        // Everything whose stay touches the day, however it ended.
        return and(lte(bookings.checkin, date), gt(bookings.checkout, date));
    }
  }

  private async countsFor(tx: Tx, propertyId: string, date: string) {
    const tabs: ReservationTab[] = ['all', 'arrivals', 'departures', 'inhouse', 'cancelled'];
    const entries = await Promise.all(
      tabs.map(async (tab) => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(bookings)
          .where(and(eq(bookings.propertyId, propertyId), this.tabFilter(tab, date)));
        return [tab, row?.n ?? 0] as const;
      }),
    );
    return Object.fromEntries(entries) as Record<ReservationTab, number>;
  }

  private async rowsFor(tx: Tx, q: ReservationQueryDto) {
    const term = q.q?.trim();
    // Search spans the four things a guest can actually quote at the desk: their reference, their
    // name, their email or their phone.
    const searchFilter = term
      ? or(
          sql`${bookings.reference} ilike ${`%${term}%`}`,
          sql`${customers.name} ilike ${`%${term}%`}`,
          sql`${customers.email} ilike ${`%${term}%`}`,
          sql`${customers.phone} ilike ${`%${term}%`}`,
        )
      : undefined;

    const rows = await tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        source: bookings.source,
        channel: otaReservations.channel,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        nights: bookings.nights,
        rooms: bookings.rooms,
        amount: bookings.amount,
        currency: bookings.currency,
        groupId: bookings.groupId,
        groupCode: bookingGroups.code,
        groupName: bookingGroups.name,
        customerId: customers.id,
        guestName: customers.name,
        guestEmail: customers.email,
        guestPhone: customers.phone,
        vip: customers.vip,
        createdAt: bookings.createdAt,
        paid: sql<string>`coalesce((
          select sum(p.amount) from payments p
          where p.booking_id = ${bookings.id} and p.direction = 'received'
        ), 0)::text`,
        roomCodes: sql<string[]>`coalesce((
          select array_agg(ru.code order by ru.display_order)
          from booking_rooms br
          join room_units ru on ru.id = br.room_unit_id
          where br.booking_id = ${bookings.id} and br.released_at is null
        ), '{}')`,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(bookingGroups, eq(bookingGroups.id, bookings.groupId))
      .leftJoin(otaReservations, eq(otaReservations.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.propertyId, q.propertyId),
          this.tabFilter(q.tab, q.date),
          searchFilter,
          q.source ? eq(bookings.source, q.source) : undefined,
          q.groupsOnly ? sql`${bookings.groupId} is not null` : undefined,
        ),
      )
      .orderBy(asc(bookings.checkin), desc(bookings.createdAt))
      .limit(q.limit)
      .offset(q.offset);

    return rows.map((r) => ({
      ...r,
      balanceDue: Number(r.amount) > Number(r.paid ?? 0),
    }));
  }

  // --- Groups ----------------------------------------------------------------

  /**
   * Make a group from several bookings — Yanolja's Group ID, the thing that makes `3359-1` and
   * `3359-2` show up together.
   *
   * Grouping is presentational only: it never merges the money. Each member keeps its own amount,
   * folio and lifecycle, which is why this touches nothing but `bookings.group_id`.
   */
  async makeGroup(tenantId: string, propertyId: string, dto: MakeGroupDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const members = await tx
        .select({ id: bookings.id, propertyId: bookings.propertyId, groupId: bookings.groupId })
        .from(bookings)
        .where(inArray(bookings.id, dto.bookingIds));

      if (members.length !== dto.bookingIds.length) {
        throw new NotFoundException('One or more bookings were not found');
      }
      if (members.some((m) => m.propertyId !== propertyId)) {
        throw new BadRequestException('All bookings must belong to the same property');
      }
      const already = members.filter((m) => m.groupId);
      if (already.length > 0 && !dto.force) {
        throw new BadRequestException(
          'Some bookings are already in a group. Merge into that group, or pass force to move them.',
        );
      }

      const code = dto.code ?? (await this.nextGroupCode(tx, propertyId));
      const [group] = await tx
        .insert(bookingGroups)
        .values({ tenantId, propertyId, code, name: dto.name ?? null })
        .returning();

      await tx
        .update(bookings)
        .set({ groupId: group!.id, updatedAt: new Date() })
        .where(inArray(bookings.id, dto.bookingIds));

      return this.groupWithin(tx, group!.id);
    });
  }

  /** Add more bookings to an existing group. */
  async mergeIntoGroup(tenantId: string, groupId: string, bookingIds: string[]) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [group] = await tx.select().from(bookingGroups).where(eq(bookingGroups.id, groupId));
      if (!group) throw new NotFoundException('Group not found');

      const members = await tx
        .select({ id: bookings.id, propertyId: bookings.propertyId })
        .from(bookings)
        .where(inArray(bookings.id, bookingIds));
      if (members.length !== bookingIds.length) {
        throw new NotFoundException('One or more bookings were not found');
      }
      if (members.some((m) => m.propertyId !== group.propertyId)) {
        throw new BadRequestException('All bookings must belong to the group’s property');
      }

      await tx
        .update(bookings)
        .set({ groupId, updatedAt: new Date() })
        .where(inArray(bookings.id, bookingIds));

      return this.groupWithin(tx, groupId);
    });
  }

  /** Take one booking out of its group. The group survives even if it empties. */
  async leaveGroup(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!b) throw new NotFoundException('Booking not found');
      await tx
        .update(bookings)
        .set({ groupId: null, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId));
      return { bookingId, groupId: null };
    });
  }

  /** A group and its members — the Group Reservation List panel. */
  group(tenantId: string, groupId: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.groupWithin(tx, groupId));
  }

  /**
   * The same read, but inside a caller's transaction.
   *
   * `makeGroup` and `mergeIntoGroup` return the group they just wrote. Opening a fresh
   * `withTenant` to do that would take a *different* connection, outside the still-uncommitted
   * transaction — so the new rows would be invisible and the call would 404 on its own work.
   */
  private async groupWithin(tx: Tx, groupId: string) {
    const [group] = await tx.select().from(bookingGroups).where(eq(bookingGroups.id, groupId));
    if (!group) throw new NotFoundException('Group not found');

    const members = await tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        rooms: bookings.rooms,
        amount: bookings.amount,
        currency: bookings.currency,
        guestName: customers.name,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(eq(bookings.groupId, groupId))
      .orderBy(asc(bookings.reference));

    // Presentational total: the sum of independent bookings, not a merged folio.
    const total = members.reduce((sum, m) => sum + Number(m.amount), 0);
    return { ...group, members, memberCount: members.length, total: total.toFixed(2) };
  }

  private async nextGroupCode(tx: Tx, propertyId: string): Promise<string> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(bookingGroups)
      .where(eq(bookingGroups.propertyId, propertyId));
    return String((row?.n ?? 0) + 1).padStart(3, '0');
  }

  /**
   * Everything a printed registration card needs — Yanolja's "Print GR".
   *
   * Assembled server-side so the printed card and the screen can never disagree about who is in
   * which room.
   */
  registrationCard(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          reference: bookings.reference,
          status: bookings.status,
          source: bookings.source,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          nights: bookings.nights,
          rooms: bookings.rooms,
          amount: bookings.amount,
          taxes: bookings.taxes,
          currency: bookings.currency,
          guest: {
            name: customers.name,
            email: customers.email,
            phone: customers.phone,
            nationality: customers.nationality,
            idType: customers.idType,
            idNumber: customers.idNumber,
            dateOfBirth: customers.dateOfBirth,
            address: customers.address,
            city: customers.city,
            country: customers.country,
            vip: customers.vip,
          },
          property: {
            name: properties.name,
            code: properties.code,
            address: properties.address,
            city: properties.city,
            country: properties.country,
            phone: properties.phone,
            email: properties.email,
            checkinTime: properties.checkinTime,
            checkoutTime: properties.checkoutTime,
          },
        })
        .from(bookings)
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .innerJoin(properties, eq(properties.id, bookings.propertyId))
        .where(eq(bookings.id, bookingId));

      if (!row) throw new NotFoundException('Booking not found');

      const legs = await tx
        .select({
          legIndex: bookingRooms.legIndex,
          code: roomUnits.code,
          adults: bookingRooms.adults,
          children: bookingRooms.children,
        })
        .from(bookingRooms)
        .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
        .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)))
        .orderBy(asc(bookingRooms.legIndex));

      return { ...row, legs };
    });
  }
}
