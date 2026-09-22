import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { Subject } from 'rxjs';
import {
  bookingRooms,
  bookingGroups,
  bookings,
  customers,
  housekeepingStatus,
  housekeepingTasks,
  floorLayouts,
  roomStaySignals,
  maintenanceBlocks,
  roomUnits,
  roomMoves,
  rooms,
  users,
  memberships,
  workOrders,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { propertyToday } from '../common/local-date';
import type {
  SetHousekeepingDto,
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  FloorLayoutDto,
  UpdateTaskDto,
  RoomSignalsDto,
} from './dto';

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
  mapX: number | null;
  mapY: number | null;
  smokingPolicy: string;
  wheelchairAccessible: boolean;
  connectedRoomUnitId: string | null;
  unitStatus: 'active' | 'inactive';
  state: RoomState;
  frontDeskLabel: string;
  housekeeping: 'dirty' | 'clean' | 'inspected' | 'out_of_order';
  remarks: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  /** The stay occupying the room today, if any. */
  guestName: string | null;
  guestEmail: string | null;
  bookingId: string | null;
  legId: string | null;
  bookingStatus: string | null;
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
  doNotDisturb: boolean;
  requestedSafetyFlag: boolean;
  groupBooking: boolean;
  groupOwner: boolean;
  splitReservation: boolean;
  plannedMove: boolean;
  dayUse: boolean;
  mealPlan: string | null;
  nextReservation: { guestName: string; checkin: string } | null;
  cleaningTask: { id: string; status: string; rush: boolean; kind: string } | null;
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
  readonly updates = new Subject<{ tenantId: string; propertyId: string; date?: string }>();

  constructor(private readonly dbs: DatabaseService) {}

  publishUpdate(tenantId: string, propertyId: string, date?: string) {
    this.updates.next({ tenantId, propertyId, date });
  }

  /** The property's own calendar today — what a screen means when it asks without a date. */
  todayFor(tenantId: string, propertyId: string): Promise<string> {
    return this.dbs.withTenant(tenantId, (tx) => propertyToday(tx, propertyId));
  }

  /**
   * The Room View card grid and the House Status grid share one query — they are the same data
   * rendered two ways, and keeping them on one code path means the two screens can never disagree
   * about whether room 05 is dirty.
   */
  async roomCards(
    tenantId: string,
    propertyId: string,
    date: string,
    canSeeSafety = false,
  ): Promise<RoomCard[]> {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const units = await tx
        .select({
          unitId: roomUnits.id,
          code: roomUnits.code,
          roomId: roomUnits.roomId,
          roomName: rooms.name,
          floor: roomUnits.floor,
          mapX: roomUnits.mapX,
          mapY: roomUnits.mapY,
          smokingPolicy: roomUnits.smokingPolicy,
          wheelchairAccessible: roomUnits.wheelchairAccessible,
          connectedRoomUnitId: roomUnits.connectedRoomUnitId,
          unitStatus: roomUnits.status,
        })
        .from(roomUnits)
        .innerJoin(rooms, eq(rooms.id, roomUnits.roomId))
        .where(eq(roomUnits.propertyId, propertyId))
        .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code));

      const [stays, hk, blocks, orders, tasks, signals, upcoming, assignees, plannedMoves] =
        await Promise.all([
          // The stay that covers `date`, plus arrivals on `date` for rooms that are otherwise free.
          tx
            .select({
              roomUnitId: bookingRooms.roomUnitId,
              checkin: bookingRooms.checkin,
              checkout: bookingRooms.checkout,
              adults: bookingRooms.adults,
              children: bookingRooms.children,
              bookingId: bookings.id,
              legId: bookingRooms.id,
              reference: bookings.reference,
              status: bookings.status,
              source: bookings.source,
              amount: bookings.amount,
              guestName: customers.name,
              guestEmail: customers.email,
              vip: customers.vip,
              groupId: bookings.groupId,
              groupOwnerCustomerId: bookingGroups.ownerCustomerId,
              siblingIndex: bookings.siblingIndex,
              customerId: bookings.customerId,
              nights: bookings.nights,
              mealPlan: sql<
                string | null
              >`(select rc.code from occupancies o join rate_plans rp on rp.id = o.rate_plan_id join rate_codes rc on rc.id = rp.rate_code_id where o.id = ${bookings.occupancyId} limit 1)`,
              paid: sql<string>`coalesce((
              select sum(p.amount) from payments p
              where p.booking_id = ${bookings.id} and p.direction = 'received'
            ), 0)`,
            })
            .from(bookingRooms)
            .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
            .innerJoin(customers, eq(customers.id, bookings.customerId))
            .leftJoin(bookingGroups, eq(bookingGroups.id, bookings.groupId))
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
          tx
            .select()
            .from(housekeepingTasks)
            .where(
              and(eq(housekeepingTasks.propertyId, propertyId), eq(housekeepingTasks.date, date)),
            ),
          tx
            .select({
              bookingId: roomStaySignals.bookingId,
              doNotDisturb: roomStaySignals.doNotDisturb,
              requestedSafetyFlag: roomStaySignals.requestedSafetyFlag,
            })
            .from(roomStaySignals),
          tx
            .select({
              roomUnitId: bookingRooms.roomUnitId,
              checkin: bookingRooms.checkin,
              guestName: customers.name,
            })
            .from(bookingRooms)
            .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
            .innerJoin(customers, eq(customers.id, bookings.customerId))
            .where(
              and(
                eq(bookings.propertyId, propertyId),
                isNull(bookingRooms.releasedAt),
                gt(bookingRooms.checkin, date),
                sql`${bookings.status} in ('Pending', 'Approved')`,
              ),
            )
            .orderBy(asc(bookingRooms.checkin)),
          tx
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(eq(users.tenantId, tenantId)),
          tx
            .select({ fromRoomUnitId: roomMoves.fromRoomUnitId })
            .from(roomMoves)
            .where(and(eq(roomMoves.propertyId, propertyId), eq(roomMoves.status, 'planned'))),
        ]);

      // A guest departing TODAY is excluded by the half-open overlap above (checkout is
      // exclusive) but is still physically in the room until they leave — that is precisely the
      // "pending checkout" the desk chases at 11am, so it needs its own query.
      const departures = await tx
        .select({
          roomUnitId: bookingRooms.roomUnitId,
          legId: bookingRooms.id,
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
          guestEmail: customers.email,
          vip: customers.vip,
          groupId: bookings.groupId,
          groupOwnerCustomerId: bookingGroups.ownerCustomerId,
          siblingIndex: bookings.siblingIndex,
          customerId: bookings.customerId,
          nights: bookings.nights,
          paid: sql<string>`coalesce((select sum(p.amount) from payments p where p.booking_id = ${bookings.id} and p.direction = 'received'), 0)`,
        })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .leftJoin(bookingGroups, eq(bookingGroups.id, bookings.groupId))
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
      const taskBy = new Map<string, (typeof tasks)[number]>();
      const taskPriority = (task: (typeof tasks)[number]) =>
        (task.status === 'in_progress' ? 100 : task.status === 'queued' ? 50 : 0) +
        (task.rush ? 20 : 0) +
        (task.kind === 'departure' ? 3 : task.kind === 'arrival_prep' ? 2 : 1);
      for (const task of tasks) {
        const current = taskBy.get(task.roomUnitId);
        if (!current || taskPriority(task) > taskPriority(current))
          taskBy.set(task.roomUnitId, task);
      }
      const signalBy = new Map(signals.map((s) => [s.bookingId, s]));
      const assigneeBy = new Map(assignees.map((u) => [u.id, u.name]));
      const plannedFrom = new Set(plannedMoves.map((m) => m.fromRoomUnitId));
      const nextBy = new Map<string, { guestName: string; checkin: string }>();
      for (const n of upcoming)
        if (n.roomUnitId && !nextBy.has(n.roomUnitId))
          nextBy.set(n.roomUnitId, { guestName: n.guestName, checkin: n.checkin });
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
        const active = stay ?? departing;

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
          frontDeskLabel: block
            ? 'Maintenance block'
            : u.unitStatus === 'inactive'
              ? 'Out of service'
              : departing
                ? 'Due out'
                : stay?.status === 'CheckedIn'
                  ? stay.checkin === date
                    ? 'Arrived'
                    : 'Stayover'
                  : stay?.nights === 0
                    ? 'Dayuse reservation'
                    : stay?.status === 'Approved'
                      ? 'Confirmed reservation'
                      : stay
                        ? 'Expected arrival'
                        : 'Vacant',
          housekeeping,
          remarks: hkBy.get(u.unitId)?.remarks ?? null,
          assignedTo:
            taskBy.get(u.unitId)?.assignedToUserId ?? hkBy.get(u.unitId)?.assignedToUserId ?? null,
          assignedToName:
            (taskBy.get(u.unitId)?.assignedToUserId ?? hkBy.get(u.unitId)?.assignedToUserId)
              ? (assigneeBy.get(
                  (taskBy.get(u.unitId)?.assignedToUserId ?? hkBy.get(u.unitId)?.assignedToUserId)!,
                ) ?? null)
              : null,
          guestName: active?.guestName ?? null,
          guestEmail: active?.guestEmail ?? null,
          bookingId: active?.bookingId ?? null,
          legId: active?.legId ?? null,
          bookingStatus: active?.status ?? null,
          reference: active?.reference ?? null,
          checkin: active?.checkin ?? null,
          checkout: active?.checkout ?? null,
          vip: active?.vip ?? false,
          balanceDue: active ? Number(active.amount) > Number(active.paid ?? 0) : false,
          adults: active?.adults ?? null,
          children: active?.children ?? null,
          source: active?.source ?? null,
          blockReason: block?.reason ?? null,
          openWorkOrders: ordersBy.get(u.unitId) ?? 0,
          doNotDisturb: active ? (signalBy.get(active.bookingId)?.doNotDisturb ?? false) : false,
          requestedSafetyFlag:
            canSeeSafety && active
              ? (signalBy.get(active.bookingId)?.requestedSafetyFlag ?? false)
              : false,
          groupBooking: Boolean(active?.groupId),
          groupOwner: Boolean(active?.groupId && active.groupOwnerCustomerId === active.customerId),
          splitReservation: active?.siblingIndex != null,
          plannedMove: plannedFrom.has(u.unitId),
          dayUse: active?.nights === 0,
          mealPlan: stay?.mealPlan ?? null,
          nextReservation: nextBy.get(u.unitId) ?? null,
          cleaningTask: taskBy.has(u.unitId)
            ? {
                id: taskBy.get(u.unitId)!.id,
                status: taskBy.get(u.unitId)!.status,
                rush: taskBy.get(u.unitId)!.rush,
                kind: taskBy.get(u.unitId)!.kind,
              }
            : null,
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
    role?: string,
  ) {
    const result = await this.dbs.withTenant(tenantId, async (tx) => {
      const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, dto.roomUnitId));
      if (!unit || unit.propertyId !== propertyId) {
        throw new NotFoundException('Room not found in this property');
      }
      const [previous] = await tx
        .select({ status: housekeepingStatus.status })
        .from(housekeepingStatus)
        .where(
          and(
            eq(housekeepingStatus.roomUnitId, dto.roomUnitId),
            eq(housekeepingStatus.date, dto.date),
          ),
        )
        .for('update');
      if (dto.status === 'inspected' && (previous?.status ?? 'clean') !== 'clean') {
        throw new ConflictException('A room must be submitted as clean before inspection');
      }
      if (role === 'HOUSEKEEPING_ATTENDANT') {
        const [assigned] = await tx
          .select({ id: housekeepingTasks.id })
          .from(housekeepingTasks)
          .where(
            and(
              eq(housekeepingTasks.roomUnitId, dto.roomUnitId),
              eq(housekeepingTasks.date, dto.date),
              eq(housekeepingTasks.assignedToUserId, userId!),
            ),
          )
          .limit(1);
        if (!assigned) throw new ForbiddenException('This room is not assigned to you');
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
    this.publishUpdate(tenantId, propertyId, dto.date);
    return result;
  }

  listFloorLayouts(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(floorLayouts).where(eq(floorLayouts.propertyId, propertyId)),
    );
  }

  saveFloorLayout(tenantId: string, propertyId: string, dto: FloorLayoutDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(floorLayouts)
        .where(and(eq(floorLayouts.propertyId, propertyId), eq(floorLayouts.floor, dto.floor)))
        .for('update');
      if ((existing?.version ?? null) !== dto.expectedVersion)
        throw new ConflictException('Floor layout changed; reload before saving');
      const units = await tx
        .select({ id: roomUnits.id })
        .from(roomUnits)
        .where(and(eq(roomUnits.propertyId, propertyId), eq(roomUnits.floor, dto.floor)));
      const allowed = new Set(units.map((u) => u.id));
      if (
        dto.rooms.some((r) => !allowed.has(r.unitId)) ||
        new Set(dto.rooms.map((r) => r.unitId)).size !== dto.rooms.length
      ) {
        throw new ConflictException('Layout includes a duplicate or a room from another floor');
      }
      await tx
        .update(roomUnits)
        .set({ mapX: null, mapY: null })
        .where(and(eq(roomUnits.propertyId, propertyId), eq(roomUnits.floor, dto.floor)));
      for (const room of dto.rooms)
        await tx
          .update(roomUnits)
          .set({ mapX: room.x, mapY: room.y })
          .where(eq(roomUnits.id, room.unitId));
      const [saved] = existing
        ? await tx
            .update(floorLayouts)
            .set({ landmarks: dto.landmarks, version: existing.version + 1, updatedAt: new Date() })
            .where(eq(floorLayouts.id, existing.id))
            .returning()
        : await tx
            .insert(floorLayouts)
            .values({ tenantId, propertyId, floor: dto.floor, landmarks: dto.landmarks })
            .returning();
      return saved;
    });
  }

  listTasks(tenantId: string, propertyId: string, date: string, role: string, userId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: housekeepingTasks.id,
          roomUnitId: housekeepingTasks.roomUnitId,
          code: roomUnits.code,
          kind: housekeepingTasks.kind,
          status: housekeepingTasks.status,
          rush: housekeepingTasks.rush,
          assignedToUserId: housekeepingTasks.assignedToUserId,
          notes: housekeepingTasks.notes,
          guestName: customers.name,
        })
        .from(housekeepingTasks)
        .innerJoin(roomUnits, eq(roomUnits.id, housekeepingTasks.roomUnitId))
        .leftJoin(bookings, eq(bookings.id, housekeepingTasks.bookingId))
        .leftJoin(customers, eq(customers.id, bookings.customerId))
        .where(
          and(
            eq(housekeepingTasks.propertyId, propertyId),
            eq(housekeepingTasks.date, date),
            role === 'HOUSEKEEPING_ATTENDANT'
              ? eq(housekeepingTasks.assignedToUserId, userId)
              : sql`true`,
          ),
        )
        .orderBy(desc(housekeepingTasks.rush), asc(roomUnits.code)),
    );
  }

  async updateTask(tenantId: string, id: string, dto: UpdateTaskDto, role: string, userId: string) {
    const saved = await this.dbs.withTenant(tenantId, async (tx) => {
      const [task] = await tx
        .select()
        .from(housekeepingTasks)
        .where(eq(housekeepingTasks.id, id))
        .for('update');
      if (!task) throw new NotFoundException('Cleaning task not found');
      const manager = role === 'OWNER' || role === 'HOUSEKEEPING_SUPERVISOR';
      if (
        !manager &&
        (role !== 'HOUSEKEEPING_ATTENDANT' ||
          task.assignedToUserId !== userId ||
          dto.rush !== undefined ||
          dto.assignedToUserId !== undefined ||
          dto.status === 'cancelled')
      ) {
        throw new ForbiddenException('Only a supervisor can assign, rush or cancel cleaning');
      }
      if (dto.assignedToUserId) {
        const [assignee] = await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(
            memberships,
            and(eq(memberships.userId, users.id), eq(memberships.tenantId, tenantId)),
          )
          .where(
            and(
              eq(users.id, dto.assignedToUserId),
              eq(users.tenantId, tenantId),
              sql`${memberships.role} in ('HOUSEKEEPING_ATTENDANT', 'HOUSEKEEPING_SUPERVISOR')`,
            ),
          );
        if (!assignee) throw new NotFoundException('Housekeeper not found in this tenant');
      }
      if (task.status === 'done' && dto.status && dto.status !== 'done')
        throw new ConflictException('Completed cleaning cannot be reopened');
      const [saved] = await tx
        .update(housekeepingTasks)
        .set({
          ...dto,
          completedAt: dto.status === 'done' ? new Date() : task.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(housekeepingTasks.id, id))
        .returning();
      if (dto.status === 'done') {
        await tx
          .insert(housekeepingStatus)
          .values({
            tenantId,
            propertyId: task.propertyId,
            roomUnitId: task.roomUnitId,
            date: task.date,
            status: 'clean',
            changedByUserId: userId,
          })
          .onConflictDoUpdate({
            target: [housekeepingStatus.roomUnitId, housekeepingStatus.date],
            set: {
              status: 'clean',
              changedAt: new Date(),
              changedByUserId: userId,
              updatedAt: new Date(),
            },
          });
      }
      return saved;
    });
    this.publishUpdate(tenantId, saved.propertyId, saved.date);
    return saved;
  }

  updateSignals(tenantId: string, bookingId: string, dto: RoomSignalsDto, userId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [booking] = await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, bookingId));
      if (!booking) throw new NotFoundException('Reservation not found');
      const [saved] = await tx
        .insert(roomStaySignals)
        .values({ tenantId, bookingId, ...dto, updatedByUserId: userId })
        .onConflictDoUpdate({
          target: roomStaySignals.bookingId,
          set: { ...dto, updatedByUserId: userId, updatedAt: new Date() },
        })
        .returning();
      return saved;
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
