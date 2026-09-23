import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { phoneNeedle, resolveReservationOptions } from '@yohobed/domain';
import {
  bookingGroups,
  bookingInclusions,
  bookingRooms,
  bookings,
  businessSources,
  customers,
  marketSegments,
  occupancies,
  otaReservations,
  properties,
  rateCodes,
  ratePlans,
  rooms,
  roomUnits,
  users,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type {
  MakeGroupDto,
  MergeGroupsDto,
  ReservationExportDto,
  ReservationGroupQueryDto,
  ReservationQueryDto,
} from './dto';

/** The tabs across the top of Yanolja's Reservations screen, each carrying its live count. */
export const RESERVATION_TABS = [
  'all',
  'upcoming',
  'booked',
  'arrivals',
  'departures',
  'inhouse',
  'cancelled',
] as const;
export type ReservationTab = (typeof RESERVATION_TABS)[number];

type ListFilters = Omit<ReservationQueryDto, 'tab' | 'limit' | 'offset' | 'groupsOnly'> & {
  groupsOnly?: boolean;
};

/** The most rows one export writes. A CSV this long is already at a spreadsheet's comfort limit. */
const EXPORT_CAP = 20_000;

@Injectable()
export class ReservationsService {
  constructor(private readonly dbs: DatabaseService) {}

  /**
   * The Reservations list: one tab's page of rows, that tab's total, and every tab's count.
   *
   * Counts come back on every request rather than only for the active tab, because the numbers
   * are the navigation — staff pick a tab *because* it says 4, and a stale count sends them to an
   * empty screen. They respect the filters, so "Holds" counts only holds on every tab.
   */
  async search(tenantId: string, q: ReservationQueryDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const tz = await this.timezoneOf(tx, q.propertyId);
      // A group's rooms are listed together whatever their dates, so the tab does not apply.
      const where = and(
        this.filtersFor(q),
        q.groupId ? undefined : this.tabFilter(q.tab, q.date, tz),
      );
      const [rows, counts, [total]] = await Promise.all([
        this.rowsFor(tx, where, q.tab).limit(q.limit).offset(q.offset),
        this.countsFor(tx, q, tz),
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(bookings)
          .innerJoin(customers, eq(customers.id, bookings.customerId))
          .where(where),
      ]);
      return {
        date: q.date,
        tab: q.tab,
        counts,
        total: total?.n ?? 0,
        limit: q.limit,
        offset: q.offset,
        rows: rows.map(shapeRow),
      };
    });
  }

  /**
   * Every row of a tab as CSV — not just the page on screen. Built server-side so a list of
   * thousands is one request, with exactly the numbers the screen shows.
   */
  async exportCsv(tenantId: string, q: ReservationExportDto): Promise<string> {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const tz = await this.timezoneOf(tx, q.propertyId);
      const where = and(
        this.filtersFor(q),
        q.groupId ? undefined : this.tabFilter(q.tab, q.date, tz),
      );
      const rows = (await this.rowsFor(tx, where, q.tab).limit(EXPORT_CAP)).map(shapeRow);
      const head = [
        'Reference',
        'Voucher',
        'Booked at',
        'Guest',
        'Email',
        'Phone',
        'Adults',
        'Children',
        'Arrival',
        'Departure',
        'Nights',
        'Room type',
        'Rate code',
        'Rooms',
        'Room numbers',
        'Type',
        'Status',
        'Business source',
        'Market segment',
        'Taken by',
        'Currency',
        'Total',
        'Paid',
        'Balance',
        'Group',
      ];
      const body = rows.map((r) => [
        r.reference,
        r.voucherNo ?? '',
        localStamp(r.createdAt, tz),
        r.guestName,
        r.guestEmail ?? '',
        r.guestPhone ?? '',
        r.adults,
        r.children,
        r.checkin,
        r.checkout,
        r.nights,
        r.roomTypeName ?? '',
        r.rateCode ?? '',
        r.rooms,
        r.roomCodes.join(' '),
        r.reservationKind,
        r.status,
        r.sourceName ?? r.channel ?? r.source,
        r.segmentName ?? '',
        r.createdByName ?? '',
        r.currency,
        r.total,
        r.paid,
        r.balance,
        r.groupCode ?? '',
      ]);
      // A UTF-8 byte-order mark, so Excel reads "Perera – Kandy" as written, not as mojibake.
      return '\uFEFF' + [head, ...body].map(csvLine).join('\r\n') + '\r\n';
    });
  }

  private async timezoneOf(tx: Tx, propertyId: string): Promise<string> {
    const [p] = await tx
      .select({ tz: properties.timezone })
      .from(properties)
      .where(eq(properties.id, propertyId));
    if (!p) throw new NotFoundException('Property not found');
    return p.tz;
  }

  /** The filters every tab shares: property, search, and the dropdowns. */
  private filtersFor(q: ListFilters): SQL | undefined {
    const term = q.q?.trim();
    // A phone number is matched on digits alone, and on the part that survives every format, so
    // "0771234567" finds a booking stored as "+94 77 123 4567" (UX-2).
    const digits = term ? phoneNeedle(term) : null;
    // Search spans what a guest can quote at the desk: their reference (a master reference finds
    // every room of the reservation), voucher, name, email or phone.
    const searchFilter = term
      ? or(
          sql`${bookings.reference} ilike ${`%${term}%`}`,
          sql`${bookings.voucherNo} ilike ${`%${term}%`}`,
          sql`${customers.name} ilike ${`%${term}%`}`,
          sql`${customers.email} ilike ${`%${term}%`}`,
          sql`${customers.phone} ilike ${`%${term}%`}`,
          digits
            ? sql`regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
            : undefined,
          digits
            ? sql`regexp_replace(coalesce(${customers.mobileE164}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
            : undefined,
        )
      : undefined;

    const kindFilter =
      q.kind === 'holds'
        ? inArray(bookings.reservationKind, ['hold_confirm', 'hold_unconfirm'])
        : q.kind
          ? eq(bookings.reservationKind, q.kind)
          : undefined;

    return and(
      eq(bookings.propertyId, q.propertyId),
      searchFilter,
      kindFilter,
      q.source ? eq(bookings.source, q.source) : undefined,
      q.origin ? eq(bookings.origin, q.origin) : undefined,
      q.businessSourceId ? eq(bookings.businessSourceId, q.businessSourceId) : undefined,
      q.marketSegmentId ? eq(bookings.marketSegmentId, q.marketSegmentId) : undefined,
      q.ledgerAccountId ? eq(bookings.ledgerAccountId, q.ledgerAccountId) : undefined,
      q.createdBy ? eq(bookings.createdByUserId, q.createdBy) : undefined,
      q.groupsOnly ? sql`${bookings.groupId} is not null` : undefined,
      q.groupId ? eq(bookings.groupId, q.groupId) : undefined,
    );
  }

  /** The predicate that defines each tab. Kept in one place so counts and rows cannot diverge. */
  private tabFilter(tab: ReservationTab, date: string, tz: string): SQL | undefined {
    switch (tab) {
      case 'upcoming':
        // Everything still to come from this day on: the forward book, holds and inquiries too.
        return and(gte(bookings.checkin, date), sql`${bookings.status} in ('Pending', 'Approved')`);
      case 'booked':
        // Taken on this day, in the hotel's own time: Yanolja's first tab.
        return sql`yhb_local_date(${bookings.createdAt}, ${tz}) = ${date}::date`;
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

  /** Every tab's count, in one pass over the property's bookings. */
  private async countsFor(tx: Tx, q: ListFilters, tz: string) {
    const [row] = await tx
      .select(
        Object.fromEntries(
          RESERVATION_TABS.map((tab) => [
            tab,
            sql<number>`(count(*) filter (where ${this.tabFilter(tab, q.date, tz)}))::int`,
          ]),
        ) as Record<ReservationTab, SQL<number>>,
      )
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(this.filtersFor(q));
    return Object.fromEntries(RESERVATION_TABS.map((t) => [t, row?.[t] ?? 0])) as Record<
      ReservationTab,
      number
    >;
  }

  private rowsFor(tx: Tx, where: SQL | undefined, tab: ReservationTab) {
    const order =
      tab === 'booked'
        ? [desc(bookings.createdAt)]
        : tab === 'cancelled'
          ? [desc(bookings.updatedAt)]
          : [asc(bookings.checkin), asc(bookings.arrivalTime), asc(bookings.reference)];

    return tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        reservationKind: bookings.reservationKind,
        inventoryHeld: bookings.inventoryHeld,
        holdUntil: bookings.holdUntil,
        origin: bookings.origin,
        voucherNo: bookings.voucherNo,
        siblingIndex: bookings.siblingIndex,
        businessSourceId: bookings.businessSourceId,
        sourceName: businessSources.name,
        sourceCode: businessSources.shortCode,
        sourceColor: businessSources.palette,
        marketSegmentId: bookings.marketSegmentId,
        segmentName: marketSegments.name,
        segmentCode: marketSegments.code,
        source: bookings.source,
        channel: otaReservations.channel,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        arrivalTime: bookings.arrivalTime,
        departureTime: bookings.departureTime,
        nights: bookings.nights,
        rooms: bookings.rooms,
        roomId: bookings.roomId,
        roomTypeName: rooms.name,
        rateCode: rateCodes.code,
        amount: bookings.amount,
        discount: bookings.discount,
        currency: bookings.currency,
        groupId: bookings.groupId,
        groupCode: bookingGroups.code,
        groupName: bookingGroups.name,
        customerId: customers.id,
        guestName: customers.name,
        guestTitle: customers.title,
        guestEmail: customers.email,
        guestPhone: customers.phone,
        vip: customers.vip,
        createdAt: bookings.createdAt,
        createdByUserId: bookings.createdByUserId,
        createdByName: users.name,
        // Paid is what came in, less anything given back.
        paid: sql<string>`coalesce((
          select sum(case when p.direction = 'received' then p.amount else -p.amount end)
          from payments p
          where p.booking_id = ${bookings.id}
        ), 0)::text`,
        // Anything on the bill besides the room: minibar, laundry, a restaurant ticket.
        extras: sql<string>`coalesce((
          select sum(fc.total)
          from folio_charges fc
          join folios f on f.id = fc.folio_id
          where f.booking_id = ${bookings.id} and fc.voided_at is null and fc.source <> 'room'
        ), 0)::text`,
        adults: sql<number>`coalesce((
          select sum(br.adults) from booking_rooms br
          where br.booking_id = ${bookings.id} and br.released_at is null
        ), 0)::int`,
        children: sql<number>`coalesce((
          select sum(br.children) from booking_rooms br
          where br.booking_id = ${bookings.id} and br.released_at is null
        ), 0)::int`,
        extraGuests: sql<number>`(
          select count(*) from booking_guests bg where bg.booking_id = ${bookings.id}
        )::int`,
        remarks: sql<number>`(
          select count(*) from booking_remarks rm where rm.booking_id = ${bookings.id}
        )::int`,
        roomCodes: sql<string[]>`coalesce((
          select array_agg(ru.code order by ru.display_order)
          from booking_rooms br
          join room_units ru on ru.id = br.room_unit_id
          where br.booking_id = ${bookings.id} and br.released_at is null
        ), '{}')`,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .leftJoin(rooms, eq(rooms.id, bookings.roomId))
      .leftJoin(occupancies, eq(occupancies.id, bookings.occupancyId))
      .leftJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
      .leftJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
      .leftJoin(bookingGroups, eq(bookingGroups.id, bookings.groupId))
      .leftJoin(otaReservations, eq(otaReservations.bookingId, bookings.id))
      .leftJoin(businessSources, eq(businessSources.id, bookings.businessSourceId))
      .leftJoin(marketSegments, eq(marketSegments.id, bookings.marketSegmentId))
      .leftJoin(users, eq(users.id, bookings.createdByUserId))
      .where(where)
      .orderBy(...order)
      .$dynamic();
  }

  // --- Group cards -------------------------------------------------------------

  /**
   * Yanolja's group view: one card per group, its rooms added up.
   *
   * Totals are the sum of independent bookings — grouping never merges the money. Cancelled,
   * rejected and no-show rooms show in the room count ("2 (3)") but not in the money.
   *
   * Raw SQL, and every correlated subquery names its own tables: Drizzle's column interpolation
   * would render `"bookings"."id"` and silently bind to the wrong table in a nested select.
   */
  async groups(tenantId: string, q: ReservationGroupQueryDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.timezoneOf(tx, q.propertyId);
      const term = q.q?.trim();
      const like = term ? `%${term}%` : null;
      const search = like
        ? sql`and (g.code ilike ${like} or g.name ilike ${like} or owner.name ilike ${like}
            or exists (
              select 1 from bookings sb join customers sc on sc.id = sb.customer_id
              where sb.group_id = g.id
                and (sb.reference ilike ${like} or sb.voucher_no ilike ${like} or sc.name ilike ${like})
            ))`
        : sql``;
      const tab =
        q.tab === 'inhouse'
          ? sql`a.in_house > 0`
          : q.tab === 'departed'
            ? sql`a.in_house = 0 and a.to_come = 0 and a.departed > 0`
            : sql`a.in_house = 0 and a.departed = 0 and a.to_come > 0`;
      const order =
        q.tab === 'departed' ? sql`a.last_checkout desc, g.code` : sql`a.first_checkin, g.code`;

      const base = sql`
        from booking_groups g
        left join customers owner on owner.id = g.owner_customer_id
        cross join lateral (
          select
            min(b.checkin) as first_checkin,
            max(b.checkout) as last_checkout,
            max(b.nights) as nights,
            min(b.created_at) as booked_at,
            count(*)::int as rooms_total,
            (count(*) filter (where b.status not in ('Cancelled', 'Rejected', 'NoShow')))::int as rooms_live,
            (count(*) filter (where b.status = 'CheckedIn'))::int as in_house,
            (count(*) filter (where b.status = 'CheckedOut'))::int as departed,
            (count(*) filter (where b.status in ('Pending', 'Approved')))::int as to_come,
            coalesce(sum(b.nights) filter (where b.status not in ('Cancelled', 'Rejected', 'NoShow')), 0)::int as room_nights,
            coalesce(sum(b.amount - b.discount) filter (where b.status not in ('Cancelled', 'Rejected', 'NoShow')), 0) as room_total,
            min(b.currency) as currency,
            min(b.voucher_no) as voucher_no,
            bool_or(b.reservation_kind in ('hold_confirm', 'hold_unconfirm')
              and b.status not in ('Cancelled', 'Rejected')) as has_hold
          from bookings b
          where b.group_id = g.id
        ) a
        left join lateral (
          select bs.short_code, bs.palette, bs.name
          from bookings b join business_sources bs on bs.id = b.business_source_id
          where b.group_id = g.id
          order by b.checkin, b.reference
          limit 1
        ) src on true
        where g.property_id = ${q.propertyId} and a.rooms_total > 0 and ${tab} ${search}`;

      const [countRow] = (await tx.execute(
        sql`select count(*)::int as n ${base}`,
      )) as unknown as Array<{
        n: number;
      }>;

      const rows = (await tx.execute(sql`
        select g.id, g.code, g.name, g.kind, g.bill_to as "billTo",
          coalesce(owner.name, (
            select c.name from bookings b join customers c on c.id = b.customer_id
            where b.group_id = g.id order by b.checkin, b.reference limit 1
          )) as "ownerName",
          a.first_checkin::text as checkin, a.last_checkout::text as checkout, a.nights,
          a.booked_at as "bookedAt", a.rooms_total as "roomsTotal", a.rooms_live as "roomsLive",
          a.in_house as "inHouse", a.departed, a.to_come as "toCome", a.room_nights as "roomNights",
          a.room_total::text as "roomTotal", a.currency, a.voucher_no as "voucherNo",
          a.has_hold as "hasHold",
          coalesce((
            select sum(fc.total) from folio_charges fc
            join folios f on f.id = fc.folio_id
            join bookings b on b.id = f.booking_id
            where b.group_id = g.id and fc.voided_at is null and fc.source <> 'room'
              and b.status not in ('Cancelled', 'Rejected', 'NoShow')
          ), 0)::text as extras,
          coalesce((
            select sum(case when p.direction = 'received' then p.amount else -p.amount end)
            from payments p join bookings b on b.id = p.booking_id
            where b.group_id = g.id
          ), 0)::text as paid,
          coalesce((
            select sum(br.adults) from booking_rooms br join bookings b on b.id = br.booking_id
            where b.group_id = g.id and br.released_at is null
              and b.status not in ('Cancelled', 'Rejected', 'NoShow')
          ), 0)::int as adults,
          coalesce((
            select sum(br.children) from booking_rooms br join bookings b on b.id = br.booking_id
            where b.group_id = g.id and br.released_at is null
              and b.status not in ('Cancelled', 'Rejected', 'NoShow')
          ), 0)::int as children,
          src.short_code as "sourceCode", src.palette as "sourceColor", src.name as "sourceName"
        ${base}
        order by ${order}
        limit ${q.limit} offset ${q.offset}
      `)) as unknown as GroupCardRow[];

      return {
        date: q.date,
        tab: q.tab,
        total: countRow?.n ?? 0,
        limit: q.limit,
        offset: q.offset,
        rows: rows.map((r) => {
          const total = Number(r.roomTotal) + Number(r.extras);
          return {
            ...r,
            total: total.toFixed(2),
            balance: (total - Number(r.paid)).toFixed(2),
            // Per room per night, the way a group is quoted.
            averageRate:
              r.roomNights > 0 ? (Number(r.roomTotal) / r.roomNights).toFixed(2) : '0.00',
          };
        }),
      };
    });
  }

  /**
   * Merge whole groups into one — Yanolja's Merge Group. The kept group's owner stays the owner,
   * and so the paymaster; the emptied groups are removed.
   *
   * Only before anyone has arrived: an occupied room's bill already has a payer, and moving it
   * under a new paymaster mid-stay would change who owes what.
   */
  async mergeGroups(tenantId: string, dto: MergeGroupsDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const ids = [dto.targetGroupId, ...new Set(dto.groupIds)];
      const groups = await tx
        .select({ id: bookingGroups.id, propertyId: bookingGroups.propertyId })
        .from(bookingGroups)
        .where(inArray(bookingGroups.id, ids))
        .for('update');
      if (groups.length !== ids.length) throw new NotFoundException('Group not found');
      const target = groups.find((g) => g.id === dto.targetGroupId)!;
      if (groups.some((g) => g.propertyId !== target.propertyId)) {
        throw new BadRequestException('Only groups of the same property can be merged');
      }
      const [arrived] = await tx
        .select({ reference: bookings.reference })
        .from(bookings)
        .where(
          and(
            inArray(bookings.groupId, ids),
            sql`${bookings.status} in ('CheckedIn', 'CheckedOut')`,
          ),
        )
        .limit(1);
      if (arrived) {
        throw new ConflictException({
          reason: 'group_arrived',
          message: `${arrived.reference} has already checked in. Groups can only be merged before arrival.`,
        });
      }
      const moving = ids.slice(1);
      await tx
        .update(bookings)
        .set({ groupId: dto.targetGroupId, updatedAt: new Date() })
        .where(inArray(bookings.groupId, moving));
      await tx.delete(bookingGroups).where(inArray(bookingGroups.id, moving));
      return this.groupWithin(tx, dto.targetGroupId);
    });
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
        reservationKind: bookings.reservationKind,
        holdUntil: bookings.holdUntil,
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

      // What the stay includes, for the card (Development Phase 02, Sprint 6); prices only when
      // the reservation shows its rate.
      const [opts] = await tx
        .select({ options: bookings.options })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      const options = resolveReservationOptions(opts?.options);
      const inclusions = await tx
        .select({
          name: bookingInclusions.name,
          rhythm: bookingInclusions.rhythm,
          unitPrice: bookingInclusions.unitPrice,
          includedInRate: bookingInclusions.includedInRate,
          itemize: bookingInclusions.itemize,
        })
        .from(bookingInclusions)
        .where(eq(bookingInclusions.bookingId, bookingId))
        .orderBy(asc(bookingInclusions.createdAt));

      const hide = options.suppressRateOnGrCard;
      return {
        ...row,
        amount: hide ? null : row.amount,
        taxes: hide ? null : row.taxes,
        rateSuppressed: hide,
        legs,
        inclusions: inclusions
          .filter((i) => i.itemize || !i.includedInRate)
          .map((i) => ({ ...i, unitPrice: hide ? null : i.unitPrice })),
      };
    });
  }
}

/** The money columns a list row carries, worked out once for the screen and the export alike. */
function shapeRow<T extends { amount: string; discount: string; paid: string; extras: string }>(
  r: T,
) {
  // The room at its sold price (after any coupon), plus anything else on the bill.
  const total = Number(r.amount) - Number(r.discount) + Number(r.extras);
  const balance = total - Number(r.paid);
  return {
    ...r,
    total: total.toFixed(2),
    balance: balance.toFixed(2),
    balanceDue: balance > 0.004,
  };
}

/** `2026-09-17 14:05` in the hotel's time — sortable in a spreadsheet, unlike dd/mm/yyyy. */
function localStamp(at: Date, tz: string): string {
  const format = (timeZone: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  };
  try {
    return format(tz);
  } catch {
    // A timezone an owner mistyped must not break the export.
    return format('UTC');
  }
}

/**
 * One CSV line. A text cell starting with = + - @ is prefixed with an apostrophe, so a guest
 * called "=HYPERLINK(...)" is shown as text in Excel instead of being run as a formula.
 */
function csvLine(cells: Array<string | number>): string {
  return cells
    .map((c) => {
      let v = String(c);
      if (typeof c === 'string' && /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) {
        v = `'${v}`;
      }
      return `"${v.replace(/"/g, '""')}"`;
    })
    .join(',');
}

interface GroupCardRow {
  id: string;
  code: string;
  name: string | null;
  kind: string;
  billTo: string | null;
  ownerName: string | null;
  checkin: string;
  checkout: string;
  nights: number;
  bookedAt: string;
  roomsTotal: number;
  roomsLive: number;
  inHouse: number;
  departed: number;
  toCome: number;
  roomNights: number;
  roomTotal: string;
  currency: string;
  voucherNo: string | null;
  hasHold: boolean;
  extras: string;
  paid: string;
  adults: number;
  children: number;
  sourceCode: string | null;
  sourceColor: string | null;
  sourceName: string | null;
}
