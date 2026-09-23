import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  bookingRooms,
  bookings,
  customers,
  properties,
  roomUnits,
  type Tx,
} from '@yohobed/db';
import { phoneNeedle } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { propertyBusinessDate } from '../common/local-date';
import type { SearchQueryDto } from './dto';

/**
 * One search for the whole desk (UX Excellence Program, UX-2).
 *
 * A guest at the counter quotes whatever they have: a reference, the name on the booking, the
 * phone number they booked with, an OTA voucher number, or their room number. The Reservations
 * list can only search inside one tab and one date; this searches the hotel — every date, every
 * status — so Ctrl+K finds a stay in one keystroke and one word.
 *
 * Phone numbers are matched on digits alone, both sides: a guest says "0771234567" and the
 * booking may hold "+94 77 123 4567".
 */
@Injectable()
export class SearchService {
  constructor(private readonly dbs: DatabaseService) {}

  search(tenantId: string, q: SearchQueryDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const term = q.q.trim();
      if (term.length < 2) return { query: term, today: null, reservations: [], guests: [], rooms: [] };
      const [property] = await tx
        .select({ id: properties.id, timezone: properties.timezone })
        .from(properties)
        .where(eq(properties.id, q.propertyId));
      if (!property) throw new NotFoundException('Property not found');
      const today = (await propertyBusinessDate(tx, property.id, property.timezone)).date;

      const [reservations, guests, rooms] = await Promise.all([
        this.reservations(tx, q.propertyId, term, today, q.limit),
        this.guests(tx, term, q.limit),
        this.rooms(tx, q.propertyId, term, today),
      ]);
      return { query: term, today, reservations, guests, rooms };
    });
  }

  /**
   * Stays matching the term, whatever their dates: the ones happening now first (in house, then
   * arriving, then leaving), then the nearest by arrival date.
   */
  private reservations(tx: Tx, propertyId: string, term: string, today: string, limit: number) {
    const like = `%${term}%`;
    const digits = phoneNeedle(term);
    return tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        rooms: bookings.rooms,
        currency: bookings.currency,
        amount: bookings.amount,
        guestName: customers.name,
        guestPhone: customers.phone,
        vip: customers.vip,
        roomCodes: sql<string | null>`(
          select string_agg(ru.code, ', ' order by ru.code)
          from booking_rooms br join room_units ru on ru.id = br.room_unit_id
          where br.booking_id = bookings.id and br.released_at is null
        )`,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          sql`(
            ${bookings.reference} ilike ${like}
            or ${bookings.voucherNo} ilike ${like}
            or ${customers.name} ilike ${like}
            or ${customers.email} ilike ${like}
            or ${customers.companyName} ilike ${like}
            ${
              digits
                ? sql`or regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}
                     or regexp_replace(coalesce(${customers.mobileE164}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
                : sql``
            }
            or exists (
              select 1 from booking_rooms br join room_units ru on ru.id = br.room_unit_id
              where br.booking_id = bookings.id and br.released_at is null and ru.code ilike ${like}
                and bookings.status = 'CheckedIn'
            )
          )`,
        ),
      )
      // What the desk means by "find this booking" is almost always the stay in front of them.
      .orderBy(
        sql`case ${bookings.status}
              when 'CheckedIn' then 0
              when 'Approved' then 1
              when 'Pending' then 2
              when 'CheckedOut' then 3
              else 4 end`,
        sql`abs(${bookings.checkin} - ${today}::date)`,
        desc(bookings.createdAt),
      )
      .limit(limit);
  }

  /** Guests matching the term, with how many stays they have had. */
  private guests(tx: Tx, term: string, limit: number) {
    const like = `%${term}%`;
    const digits = phoneNeedle(term);
    return tx
      .select({
        id: customers.id,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        vip: customers.vip,
        companyName: customers.companyName,
        stays: sql<number>`(
          select count(*)::int from bookings b where b.customer_id = customers.id
        )`,
        lastStay: sql<string | null>`(
          select max(b.checkout)::text from bookings b where b.customer_id = customers.id
        )`,
      })
      .from(customers)
      .where(
        sql`(
          ${customers.name} ilike ${like}
          or ${customers.email} ilike ${like}
          or ${customers.companyName} ilike ${like}
          ${
            digits
              ? sql`or regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}
                   or regexp_replace(coalesce(${customers.mobileE164}, ''), '[^0-9]', '', 'g') like ${`%${digits}%`}`
              : sql``
          }
        )`,
      )
      .orderBy(desc(customers.vip), customers.name)
      .limit(limit);
  }

  /** Rooms whose number matches, with whoever is in them tonight. */
  private rooms(tx: Tx, propertyId: string, term: string, today: string) {
    return tx
      .select({
        id: roomUnits.id,
        code: roomUnits.code,
        floor: roomUnits.floor,
        status: roomUnits.status,
        bookingId: bookings.id,
        reference: bookings.reference,
        guestName: customers.name,
      })
      .from(roomUnits)
      .leftJoin(
        bookingRooms,
        and(
          eq(bookingRooms.roomUnitId, roomUnits.id),
          sql`${bookingRooms.releasedAt} is null`,
          sql`${bookingRooms.checkin} <= ${today}::date and ${bookingRooms.checkout} > ${today}::date`,
        ),
      )
      .leftJoin(
        bookings,
        and(eq(bookings.id, bookingRooms.bookingId), sql`${bookings.status} = 'CheckedIn'`),
      )
      .leftJoin(customers, eq(customers.id, bookings.customerId))
      .where(and(eq(roomUnits.propertyId, propertyId), sql`${roomUnits.code} ilike ${`%${term}%`}`))
      .orderBy(roomUnits.displayOrder, roomUnits.code)
      .limit(8);
  }
}
