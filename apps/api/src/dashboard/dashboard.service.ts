import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { bookings, bookingDays, customers, rooms } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';

/** Statuses that represent confirmed, revenue-bearing business. */
const CONFIRMED = ['Approved', 'CheckedIn', 'CheckedOut'] as const;

/**
 * The owner's morning screen (Compartment G): who arrives, who leaves, who is in-house,
 * what needs approving, how full tonight is, and how the month is doing.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dbs: DatabaseService) {}

  overview(tenantId: string, date: string, propertyId?: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const inProperty = (extra: SQL | undefined) =>
        propertyId ? and(eq(bookings.propertyId, propertyId), extra) : extra;

      const bookingRow = {
        id: bookings.id,
        reference: bookings.reference,
        status: bookings.status,
        source: bookings.source,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        nights: bookings.nights,
        rooms: bookings.rooms,
        amount: bookings.amount,
        customerName: customers.name,
        roomName: rooms.name,
      };
      const fromBookings = () =>
        tx
          .select(bookingRow)
          .from(bookings)
          .innerJoin(customers, eq(customers.id, bookings.customerId))
          .innerJoin(rooms, eq(rooms.id, bookings.roomId));

      // Today's movements. Arrivals due show as Approved; already-arrived show as CheckedIn.
      const arrivals = await fromBookings().where(
        inProperty(and(eq(bookings.checkin, date), inArray(bookings.status, ['Approved', 'CheckedIn']))),
      );
      const departures = await fromBookings().where(
        inProperty(and(eq(bookings.checkout, date), inArray(bookings.status, ['CheckedIn', 'CheckedOut']))),
      );

      const [inHouse] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(inProperty(eq(bookings.status, 'CheckedIn')));
      const [pending] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(inProperty(eq(bookings.status, 'Pending')));

      // Tonight's occupancy = confirmed rooms staying the night ÷ physical rooms.
      const roomFilter = propertyId ? eq(rooms.propertyId, propertyId) : undefined;
      const [cap] = await tx
        .select({ total: sql<number>`coalesce(sum(${rooms.quantity}), 0)::int` })
        .from(rooms)
        .where(roomFilter);
      const [occ] = await tx
        .select({ occupied: sql<number>`coalesce(sum(${bookings.rooms}), 0)::int` })
        .from(bookings)
        .where(
          inProperty(
            and(
              lte(bookings.checkin, date),
              gt(bookings.checkout, date),
              inArray(bookings.status, ['Approved', 'CheckedIn']),
            ),
          ),
        );
      const totalRooms = cap!.total;
      const occupied = Math.min(occ!.occupied, totalRooms || occ!.occupied);

      // Month-to-view revenue: night-by-night confirmed selling, so multi-month stays land
      // in the right month (booking_days is the source of truth, as in settlement).
      const monthStart = `${date.slice(0, 7)}-01`;
      const nextMonth = new Date(`${monthStart}T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const monthEnd = nextMonth.toISOString().slice(0, 10);
      const [rev] = await tx
        .select({
          gross: sql<string>`coalesce(sum(${bookingDays.sellingPrice} * ${bookings.rooms}), 0)`,
          nights: sql<number>`count(*)::int`,
        })
        .from(bookingDays)
        .innerJoin(bookings, eq(bookings.id, bookingDays.bookingId))
        .where(
          inProperty(
            and(
              gte(bookingDays.date, monthStart),
              sql`${bookingDays.date} < ${monthEnd}`,
              inArray(bookings.status, [...CONFIRMED]),
            ),
          ),
        );

      const recent = await fromBookings().orderBy(desc(bookings.createdAt)).limit(5);

      return {
        date,
        arrivals,
        departures,
        inHouse: inHouse!.count,
        pendingApprovals: pending!.count,
        occupancy: {
          totalRooms,
          occupied,
          pct: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0,
        },
        month: { from: monthStart, gross: Number(rev!.gross), nightsSold: rev!.nights },
        recent,
      };
    });
  }
}
