import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { bookings, bookingDays, customers, rooms, properties } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { resolveAggCurrency } from '../common/currency';
import { CONFIRMED_STATUSES } from '../common/booking-status';
import { propertyToday } from '../common/local-date';

/**
 * The owner's morning screen (Compartment G): who arrives, who leaves, who is in-house,
 * what needs approving, how full tonight is, and how the month is doing.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly dbs: DatabaseService) {}

  /** `requestedDate` defaults to the property's own today (or the tenant's first property's). */
  overview(tenantId: string, requestedDate: string | undefined, propertyId?: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const date = requestedDate ?? (await propertyToday(tx, propertyId));
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
        currency: bookings.currency,
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
        inProperty(
          and(eq(bookings.checkin, date), inArray(bookings.status, ['Approved', 'CheckedIn'])),
        ),
      );
      const departures = await fromBookings().where(
        inProperty(
          and(eq(bookings.checkout, date), inArray(bookings.status, ['CheckedIn', 'CheckedOut'])),
        ),
      );

      const [inHouse] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(inProperty(eq(bookings.status, 'CheckedIn')));
      // "Pending" is three different things since Development Phase 02: an inquiry (no rooms
      // taken), an unconfirmed hold (rooms taken, awaiting confirmation) and a failed online
      // booking. The total stays for compatibility; the split is what the desk acts on.
      const pendingRows = await tx
        .select({ kind: bookings.reservationKind, count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(inProperty(eq(bookings.status, 'Pending')))
        .groupBy(bookings.reservationKind);
      const pendingByKind = {
        inquiry: 0,
        hold_unconfirm: 0,
        online_failed: 0,
        ...Object.fromEntries(pendingRows.map((r) => [r.kind, r.count])),
      } as Record<'inquiry' | 'hold_unconfirm' | 'online_failed', number>;
      const pending = { count: pendingRows.reduce((s, r) => s + r.count, 0) };
      // Holds that release their rooms within the next day.
      const [holdsDue] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(bookings)
        .where(
          inProperty(
            and(
              sql`${bookings.holdUntil} is not null`,
              sql`${bookings.holdUntil} <= now() + interval '24 hours'`,
              inArray(bookings.status, ['Pending', 'Approved']),
            ),
          ),
        );

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
      const revRows = await tx
        .select({
          currency: bookings.currency,
          gross: sql<string>`coalesce(sum(${bookingDays.sellingPrice} * ${bookings.rooms}), 0)`,
          grossLkr: sql<string>`coalesce(sum(${bookingDays.sellingPrice} * ${bookings.rooms} * ${bookings.fxRateToLkr}), 0)`,
          nights: sql<number>`count(*)::int`,
        })
        .from(bookingDays)
        .innerJoin(bookings, eq(bookings.id, bookingDays.bookingId))
        .where(
          inProperty(
            and(
              gte(bookingDays.date, monthStart),
              sql`${bookingDays.date} < ${monthEnd}`,
              inArray(bookings.status, [...CONFIRMED_STATUSES]),
            ),
          ),
        )
        .groupBy(bookings.currency);

      const recent = await fromBookings().orderBy(desc(bookings.createdAt)).limit(5);

      // Scoped to one property the month gross is exact in that property's currency; across all
      // properties it may span currencies, so it folds to LKR via each booking's snapshotted rate
      // and is flagged approximate. Grouping by currency is what makes the distinction automatic.
      const monthAgg = resolveAggCurrency(revRows.map((r) => r.currency));
      let monthGross = 0;
      let nightsSold = 0;
      for (const r of revRows) {
        monthGross += Number(monthAgg.approximate ? r.grossLkr : r.gross);
        nightsSold += r.nights;
      }

      // With no bookings yet there is nothing to infer a currency from, so fall back to the
      // property's own base currency rather than reporting a bare LKR zero for a USD property.
      let monthCurrency = monthAgg.currency;
      if (propertyId && revRows.length === 0) {
        const [p] = await tx
          .select({ currency: properties.currency })
          .from(properties)
          .where(eq(properties.id, propertyId));
        monthCurrency = (p?.currency as typeof monthCurrency) ?? 'LKR';
      }

      return {
        date,
        arrivals,
        departures,
        inHouse: inHouse!.count,
        pendingApprovals: pending.count,
        pendingByKind,
        holdsReleasingSoon: holdsDue?.count ?? 0,
        occupancy: {
          totalRooms,
          occupied,
          pct: totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0,
        },
        month: {
          from: monthStart,
          gross: monthGross,
          nightsSold,
          currency: monthCurrency,
          approximate: monthAgg.approximate,
        },
        recent,
      };
    });
  }
}
