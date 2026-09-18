import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import {
  bookingRooms,
  bookings,
  customers,
  housekeepingStatus,
  maintenanceBlocks,
  roomUnits,
  rooms,
  users,
  workOrders,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { propertyToday } from '../common/local-date';
import type { SetHousekeepingDto, CreateWorkOrderDto, UpdateWorkOrderDto } from './dto';

/**
 * What the front desk calls the room's state, derived rather than stored.
 *
 * Yanolja shows this on every room card and it is *always* a function of the reservations and the
 * housekeeping flag — storing it would mean a second source of truth that drifts the moment a
 * booking is amended.
 */
export type RoomState = 'OutOfOrder' | 'Occupied' | 'PendingCheckout' | 'ArrivingToday' | 'Vacant';

export interface RoomCard {
  unitId: string;
  code: string;
  roomId: string;
  roomName: string;
  floor: string | null;
  unitStatus: 'active' | 'inactive';
  state: RoomState;
  housekeeping: 'dirty' | 'clean' | 'inspected' | 'out_of_order';
  remarks: string | null;
  assignedTo: string | null;
  /** The stay occupying the room today, if any. */
  guestName: string | null;
  bookingId: string | null;
  reference: string | null;
  checkin: string | null;
  checkout: string | null;
  vip: boolean;
  balanceDue: boolean;
  adults: number | null;
  children: number | null;
  source: string | null;
  blockReason: string | null;
  openWorkOrders: number;
}

/**
 * Whether a work order is due: straight away, or its reservation has reached the moment the task
 * waits for (check-in, check-out). Named tables, not column interpolation: this runs inside
 * queries that also join `bookings`.
 */
const taskIsDue = sql`(work_orders.trigger = 'instant' or exists (
  select 1 from bookings tb
  where tb.id = work_orders.booking_id
    and (
      (work_orders.trigger = 'checkin' and tb.status in ('CheckedIn', 'CheckedOut'))
      or (work_orders.trigger = 'checkout' and tb.status = 'CheckedOut')
    )
))`;

@Injectable()
export class HousekeepingService {
  constructor(private readonly dbs: DatabaseService) {}

  /** The property's own calendar today — what a screen means when it asks without a date. */
  todayFor(tenantId: string, propertyId: string): Promise<string> {
    return this.dbs.withTenant(tenantId, (tx) => propertyToday(tx, propertyId));
  }

  /**
   * The Room View card grid and the House Status grid share one query — they are the same data
   * rendered two ways, and keeping them on one code path means the two screens can never disagree
   * about whether room 05 is dirty.
   */
  async roomCards(tenantId: string, propertyId: string, date: string): Promise<RoomCard[]> {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const units = await tx
        .select({
          unitId: roomUnits.id,
          code: roomUnits.code,
          roomId: roomUnits.roomId,
          roomName: rooms.name,
          floor: roomUnits.floor,
          unitStatus: roomUnits.status,
        })
        .from(roomUnits)
        .innerJoin(rooms, eq(rooms.id, roomUnits.roomId))
        .where(eq(roomUnits.propertyId, propertyId))
        .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code));

      const [stays, hk, blocks, orders] = await Promise.all([
        // The stay that covers `date`, plus arrivals on `date` for rooms that are otherwise free.
        tx
          .select({
            roomUnitId: bookingRooms.roomUnitId,
            checkin: bookingRooms.checkin,
            checkout: bookingRooms.checkout,
            adults: bookingRooms.adults,
            children: bookingRooms.children,
            bookingId: bookings.id,
            reference: bookings.reference,
            status: bookings.status,
            source: bookings.source,
            amount: bookings.amount,
            guestName: customers.name,
            vip: customers.vip,
            paid: sql<string>`coalesce((
              select sum(p.amount) from payments p
              where p.booking_id = ${bookings.id} and p.direction = 'received'
            ), 0)`,
          })
          .from(bookingRooms)
          .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
          .innerJoin(customers, eq(customers.id, bookings.customerId))
          .where(
            and(
              eq(bookings.propertyId, propertyId),
              isNull(bookingRooms.releasedAt),
              lte(bookingRooms.checkin, date),
              gt(bookingRooms.checkout, date),
            ),
          ),
        tx
          .select()
          .from(housekeepingStatus)
          .where(
            and(eq(housekeepingStatus.propertyId, propertyId), eq(housekeepingStatus.date, date)),
          ),
        tx
          .select()
          .from(maintenanceBlocks)
          .where(
            and(
              eq(maintenanceBlocks.propertyId, propertyId),
              isNull(maintenanceBlocks.releasedAt),
              lte(maintenanceBlocks.blockFrom, date),
              gt(maintenanceBlocks.blockTo, date),
            ),
          ),
        tx
          .select({
            roomUnitId: workOrders.roomUnitId,
            n: sql<number>`count(*)::int`,
          })
          .from(workOrders)
          .where(
            and(
              eq(workOrders.propertyId, propertyId),
              sql`${workOrders.status} in ('open', 'in_progress')`,
              taskIsDue,
            ),
          )
          .groupBy(workOrders.roomUnitId),
      ]);

      // A guest departing TODAY is excluded by the half-open overlap above (checkout is
      // exclusive) but is still physically in the room until they leave — that is precisely the
      // "pending checkout" the desk chases at 11am, so it needs its own query.
      const departures = await tx
        .select({ roomUnitId: bookingRooms.roomUnitId, guestName: customers.name })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .where(
          and(
            eq(bookings.propertyId, propertyId),
            isNull(bookingRooms.releasedAt),
            eq(bookingRooms.checkout, date),
            eq(bookings.status, 'CheckedIn'),
          ),
        );

      // Arrivals today that have a room but whose stay starts today — needed to tell
      // "ArrivingToday" from "Vacant".
      const arrivals = await tx
        .select({ roomUnitId: bookingRooms.roomUnitId, guestName: customers.name })
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

      const stayBy = new Map(stays.filter((s) => s.roomUnitId).map((s) => [s.roomUnitId!, s]));
      const hkBy = new Map(hk.map((h) => [h.roomUnitId, h]));
      const blockBy = new Map(blocks.map((b) => [b.roomUnitId, b]));
      const ordersBy = new Map(orders.filter((o) => o.roomUnitId).map((o) => [o.roomUnitId!, o.n]));
      const arrivingBy = new Set(arrivals.map((a) => a.roomUnitId).filter(Boolean) as string[]);
      const departingBy = new Map(
        departures.filter((d) => d.roomUnitId).map((d) => [d.roomUnitId!, d]),
      );

      return units.map((u) => {
        const stay = stayBy.get(u.unitId);
        const block = blockBy.get(u.unitId);
        // A missing row means clean: a room nobody has touched is not dirty.
        const housekeeping = hkBy.get(u.unitId)?.status ?? 'clean';

        const departing = departingBy.get(u.unitId);

        let state: RoomState;
        if (u.unitStatus === 'inactive' || housekeeping === 'out_of_order' || block) {
          state = 'OutOfOrder';
        } else if (departing) {
          state = 'PendingCheckout';
        } else if (stay?.status === 'CheckedIn') {
          state = 'Occupied';
        } else if (stay || arrivingBy.has(u.unitId)) {
          state = 'ArrivingToday';
        } else {
          state = 'Vacant';
        }

        return {
          ...u,
          state,
          housekeeping,
          remarks: hkBy.get(u.unitId)?.remarks ?? null,
          assignedTo: hkBy.get(u.unitId)?.assignedToUserId ?? null,
          guestName: stay?.guestName ?? departing?.guestName ?? null,
          bookingId: stay?.bookingId ?? null,
          reference: stay?.reference ?? null,
          checkin: stay?.checkin ?? null,
          checkout: stay?.checkout ?? null,
          vip: stay?.vip ?? false,
          balanceDue: stay ? Number(stay.amount) > Number(stay.paid ?? 0) : false,
          adults: stay?.adults ?? null,
          children: stay?.children ?? null,
          source: stay?.source ?? null,
          blockReason: block?.reason ?? null,
          openWorkOrders: ordersBy.get(u.unitId) ?? 0,
        };
      });
    });
  }

  /** Set a room's housekeeping state for a date. Upserts, because rows are created lazily. */
  async setStatus(
    tenantId: string,
    propertyId: string,
    userId: string | null,
    dto: SetHousekeepingDto,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, dto.roomUnitId));
      if (!unit || unit.propertyId !== propertyId) {
        throw new NotFoundException('Room not found in this property');
      }

      const [row] = await tx
        .insert(housekeepingStatus)
        .values({
          tenantId,
          propertyId,
          roomUnitId: dto.roomUnitId,
          date: dto.date,
          status: dto.status,
          remarks: dto.remarks ?? null,
          assignedToUserId: dto.assignedToUserId ?? null,
          changedByUserId: userId,
        })
        .onConflictDoUpdate({
          target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
          set: {
            status: dto.status,
            remarks: dto.remarks ?? null,
            assignedToUserId: dto.assignedToUserId ?? null,
            changedAt: new Date(),
            changedByUserId: userId,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    });
  }

  /**
   * Mark every room a guest departed from today as dirty.
   *
   * The button a supervisor presses each morning. Only rooms whose stay actually ended are
   * touched, so it never dirties an in-house guest's room.
   */
  async markDeparturesDirty(
    tenantId: string,
    propertyId: string,
    date: string,
    userId: string | null,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const departed = await tx
        .selectDistinct({ roomUnitId: bookingRooms.roomUnitId })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .where(
          and(
            eq(bookings.propertyId, propertyId),
            isNull(bookingRooms.releasedAt),
            eq(bookingRooms.checkout, date),
          ),
        );

      const ids = departed.map((d) => d.roomUnitId).filter(Boolean) as string[];
      for (const roomUnitId of ids) {
        await tx
          .insert(housekeepingStatus)
          .values({
            tenantId,
            propertyId,
            roomUnitId,
            date,
            status: 'dirty',
            changedByUserId: userId,
          })
          .onConflictDoUpdate({
            target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
            set: { status: 'dirty', changedAt: new Date(), changedByUserId: userId },
          });
      }
      return { marked: ids.length };
    });
  }

  // --- Work orders -----------------------------------------------------------

  listWorkOrders(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: workOrders.id,
          roomUnitId: workOrders.roomUnitId,
          code: roomUnits.code,
          title: workOrders.title,
          description: workOrders.description,
          priority: workOrders.priority,
          status: workOrders.status,
          department: workOrders.department,
          trigger: workOrders.trigger,
          bookingId: workOrders.bookingId,
          bookingReference: bookings.reference,
          // A task raised on a reservation for check-in (say, flowers in the room) is not due
          // until the guest arrives; the list shows it, flagged, rather than as open work.
          waiting: sql<boolean>`not ${taskIsDue}`,
          assignedToUserId: workOrders.assignedToUserId,
          assignedToName: users.name,
          deadline: workOrders.deadline,
          completedAt: workOrders.completedAt,
          createdAt: workOrders.createdAt,
        })
        .from(workOrders)
        .leftJoin(roomUnits, eq(roomUnits.id, workOrders.roomUnitId))
        .leftJoin(users, eq(users.id, workOrders.assignedToUserId))
        .leftJoin(bookings, eq(bookings.id, workOrders.bookingId))
        .where(eq(workOrders.propertyId, propertyId))
        .orderBy(desc(workOrders.createdAt)),
    );
  }

  createWorkOrder(
    tenantId: string,
    propertyId: string,
    userId: string | null,
    dto: CreateWorkOrderDto,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      if (dto.roomUnitId) {
        const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, dto.roomUnitId));
        if (!unit || unit.propertyId !== propertyId) {
          throw new NotFoundException('Room not found in this property');
        }
      }
      const [created] = await tx
        .insert(workOrders)
        .values({ tenantId, propertyId, ...dto, createdByUserId: userId })
        .returning();
      return created;
    });
  }

  updateWorkOrder(tenantId: string, id: string, dto: UpdateWorkOrderDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [existing] = await tx.select().from(workOrders).where(eq(workOrders.id, id));
      if (!existing) throw new NotFoundException('Work order not found');
      if (existing.status === 'done' && dto.status && dto.status !== 'done') {
        throw new ConflictException('A completed work order cannot be reopened');
      }
      const [updated] = await tx
        .update(workOrders)
        .set({
          ...dto,
          completedAt: dto.status === 'done' ? new Date() : existing.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(workOrders.id, id))
        .returning();
      return updated;
    });
  }

  /** Counts for the House Status chips, derived from the same cards the grid renders. */
  async summary(tenantId: string, propertyId: string, date: string) {
    const cards = await this.roomCards(tenantId, propertyId, date);
    return {
      all: cards.length,
      vacant: cards.filter((c) => c.state === 'Vacant').length,
      occupied: cards.filter((c) => c.state === 'Occupied').length,
      arriving: cards.filter((c) => c.state === 'ArrivingToday').length,
      pendingCheckout: cards.filter((c) => c.state === 'PendingCheckout').length,
      outOfOrder: cards.filter((c) => c.state === 'OutOfOrder').length,
      dirty: cards.filter((c) => c.housekeeping === 'dirty').length,
      clean: cards.filter((c) => c.housekeeping === 'clean').length,
      inspected: cards.filter((c) => c.housekeeping === 'inspected').length,
    };
  }

  /** Dirty-room count for one date, used by Stay View's chip strip. */
  async dirtyCount(tx: Tx, propertyId: string, date: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(housekeepingStatus)
      .where(
        and(
          eq(housekeepingStatus.propertyId, propertyId),
          eq(housekeepingStatus.date, date),
          eq(housekeepingStatus.status, 'dirty'),
        ),
      );
    return row?.n ?? 0;
  }
}
