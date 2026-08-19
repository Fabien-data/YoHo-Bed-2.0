import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { bookingRooms, bookings, maintenanceBlocks, roomUnits, rooms, type Tx } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { AssignRoomsDto, CreateRoomUnitDto, UpdateRoomUnitDto } from './dto';

/** Postgres raises this when the anti-double-booking exclusion constraint refuses a row. */
const EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === EXCLUSION_VIOLATION;
}

@Injectable()
export class RoomUnitsService {
  constructor(private readonly dbs: DatabaseService) {}

  /** Every physical room in a property, with the bucket it belongs to. */
  listByProperty(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: roomUnits.id,
          propertyId: roomUnits.propertyId,
          roomId: roomUnits.roomId,
          roomName: rooms.name,
          code: roomUnits.code,
          displayOrder: roomUnits.displayOrder,
          floor: roomUnits.floor,
          notes: roomUnits.notes,
          status: roomUnits.status,
        })
        .from(roomUnits)
        .innerJoin(rooms, eq(rooms.id, roomUnits.roomId))
        .where(eq(roomUnits.propertyId, propertyId))
        .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code)),
    );
  }

  async create(tenantId: string, propertyId: string, dto: CreateRoomUnitDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, dto.roomId));
      if (!room || room.propertyId !== propertyId) {
        throw new NotFoundException('Room not found in this property');
      }

      // Default the sort position to the numeric part of the code, so "07" lands between 06 and
      // 08 without the caller having to think about ordering.
      const displayOrder =
        dto.displayOrder ?? (Number.parseInt(dto.code.replace(/\D/g, ''), 10) || 0);

      try {
        const [created] = await tx
          .insert(roomUnits)
          .values({
            tenantId,
            propertyId,
            roomId: dto.roomId,
            code: dto.code,
            displayOrder,
            floor: dto.floor ?? null,
            notes: dto.notes ?? null,
          })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`Room "${dto.code}" already exists in this property`);
        }
        throw e;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRoomUnitDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, id));
      if (!unit) throw new NotFoundException('Room not found');

      // Taking a unit out of service must not silently strand a guest who is in it.
      if (dto.status === 'inactive' && unit.status === 'active') {
        const [occupied] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(bookingRooms)
          .where(
            and(
              eq(bookingRooms.roomUnitId, id),
              isNull(bookingRooms.releasedAt),
              sql`${bookingRooms.checkout} > current_date`,
            ),
          );
        if ((occupied?.n ?? 0) > 0) {
          throw new ConflictException(
            'This room has current or future reservations. Move them before deactivating it.',
          );
        }
      }

      try {
        const [updated] = await tx
          .update(roomUnits)
          .set({ ...dto, updatedAt: new Date() })
          .where(eq(roomUnits.id, id))
          .returning();
        return updated;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`Room "${dto.code}" already exists in this property`);
        }
        throw e;
      }
    });
  }

  /** The legs of a booking — one per physical room — with the unit each is assigned to. */
  listLegs(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.legsOf(tx, bookingId));
  }

  private legsOf(tx: Tx, bookingId: string) {
    return tx
      .select({
        id: bookingRooms.id,
        legIndex: bookingRooms.legIndex,
        roomUnitId: bookingRooms.roomUnitId,
        code: roomUnits.code,
        checkin: bookingRooms.checkin,
        checkout: bookingRooms.checkout,
        adults: bookingRooms.adults,
        children: bookingRooms.children,
        releasedAt: bookingRooms.releasedAt,
      })
      .from(bookingRooms)
      .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
      .where(eq(bookingRooms.bookingId, bookingId))
      .orderBy(asc(bookingRooms.legIndex));
  }

  /**
   * Assign specific units to specific legs.
   *
   * The database is the arbiter: the exclusion constraint on `booking_rooms` makes an overlapping
   * assignment impossible, so we do not pre-check and hope. That closes the same race the
   * `rooms_to_sell >= 0` check closes for buckets — two agents assigning the last free room at the
   * same moment cannot both win.
   */
  async assign(tenantId: string, bookingId: string, dto: AssignRoomsDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadAssignable(tx, bookingId);

      for (const a of dto.assignments) {
        const [leg] = await tx
          .select()
          .from(bookingRooms)
          .where(and(eq(bookingRooms.id, a.legId), eq(bookingRooms.bookingId, bookingId)));
        if (!leg) throw new NotFoundException(`Leg ${a.legId} is not part of this booking`);

        if (a.roomUnitId === null) {
          await tx
            .update(bookingRooms)
            .set({ roomUnitId: null, updatedAt: new Date() })
            .where(eq(bookingRooms.id, a.legId));
          continue;
        }

        const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, a.roomUnitId));
        if (!unit) throw new NotFoundException('Room not found');
        if (unit.roomId !== booking.roomId) {
          throw new BadRequestException(
            `Room ${unit.code} is not part of the room type this booking was made on`,
          );
        }
        if (unit.status !== 'active') {
          throw new BadRequestException(`Room ${unit.code} is out of service`);
        }
        await this.assertNotBlocked(tx, a.roomUnitId, leg.checkin, leg.checkout, unit.code);

        try {
          await tx
            .update(bookingRooms)
            .set({ roomUnitId: a.roomUnitId, updatedAt: new Date() })
            .where(eq(bookingRooms.id, a.legId));
        } catch (e) {
          if (isExclusionViolation(e)) {
            throw new ConflictException(`Room ${unit.code} is already occupied for those dates`);
          }
          throw e;
        }
      }

      return this.legsOf(tx, bookingId);
    });
  }

  /**
   * Fill every unassigned leg with the lowest-numbered free room — the same first-fit rule the
   * back-fill migration used, and the order a front-desk agent would work in.
   *
   * Partial success is deliberate: assigning three of four rooms and reporting the shortfall is
   * more useful at a front desk than refusing to assign any.
   */
  async autoAssign(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadAssignable(tx, bookingId);

      const legs = await tx
        .select()
        .from(bookingRooms)
        .where(
          and(
            eq(bookingRooms.bookingId, bookingId),
            isNull(bookingRooms.roomUnitId),
            isNull(bookingRooms.releasedAt),
          ),
        )
        .orderBy(asc(bookingRooms.legIndex));

      let assigned = 0;
      for (const leg of legs) {
        const free = await this.firstFreeUnit(tx, booking.roomId, leg.checkin, leg.checkout);
        if (!free) break;
        try {
          await tx
            .update(bookingRooms)
            .set({ roomUnitId: free, updatedAt: new Date() })
            .where(eq(bookingRooms.id, leg.id));
          assigned += 1;
        } catch (e) {
          // Lost a race for that unit; stop rather than spin.
          if (!isExclusionViolation(e)) throw e;
          break;
        }
      }

      return {
        assigned,
        unassigned: legs.length - assigned,
        legs: await this.legsOf(tx, bookingId),
      };
    });
  }

  /** The booking, if it is in a state where a room may be assigned to it. */
  private async loadAssignable(tx: Tx, bookingId: string) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!b) throw new NotFoundException('Booking not found');
    if (b.status === 'Cancelled' || b.status === 'Rejected') {
      throw new BadRequestException(`Cannot assign a room to a ${b.status} booking`);
    }
    return b;
  }

  /** Lowest-numbered active unit of the bucket that is free, and not blocked, for the range. */
  private async firstFreeUnit(
    tx: Tx,
    roomId: string,
    checkin: string,
    checkout: string,
  ): Promise<string | null> {
    const [row] = await tx
      .select({ id: roomUnits.id })
      .from(roomUnits)
      .where(
        and(
          eq(roomUnits.roomId, roomId),
          eq(roomUnits.status, 'active'),
          sql`not exists (
            select 1 from ${bookingRooms} x
            where x.room_unit_id = ${roomUnits.id}
              and x.released_at is null
              and daterange(x.checkin, x.checkout, '[)')
                  && daterange(${checkin}::date, ${checkout}::date, '[)')
          )`,
          sql`not exists (
            select 1 from ${maintenanceBlocks} m
            where m.room_unit_id = ${roomUnits.id}
              and m.released_at is null
              and daterange(m.block_from, m.block_to, '[)')
                  && daterange(${checkin}::date, ${checkout}::date, '[)')
          )`,
        ),
      )
      .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code))
      .limit(1);
    return row?.id ?? null;
  }

  private async assertNotBlocked(
    tx: Tx,
    roomUnitId: string,
    checkin: string,
    checkout: string,
    code: string,
  ) {
    const [blocked] = await tx
      .select({ reason: maintenanceBlocks.reason })
      .from(maintenanceBlocks)
      .where(
        and(
          eq(maintenanceBlocks.roomUnitId, roomUnitId),
          isNull(maintenanceBlocks.releasedAt),
          sql`daterange(${maintenanceBlocks.blockFrom}, ${maintenanceBlocks.blockTo}, '[)')
              && daterange(${checkin}::date, ${checkout}::date, '[)')`,
        ),
      )
      .limit(1);
    if (blocked) {
      throw new ConflictException(`Room ${code} is blocked for those dates: ${blocked.reason}`);
    }
  }

  /**
   * Setup health: where the physical rooms and the sellable bucket disagree.
   *
   * Deliberately a warning rather than a constraint — a unit out of service legitimately makes
   * the two differ — but a property that is selling 10 rooms while owning 8 needs to know.
   */
  countsByRoom(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          roomId: rooms.id,
          roomName: rooms.name,
          quantity: rooms.quantity,
          activeUnits: sql<number>`count(*) filter (where ${roomUnits.status} = 'active')::int`,
          totalUnits: sql<number>`count(${roomUnits.id})::int`,
        })
        .from(rooms)
        .leftJoin(roomUnits, eq(roomUnits.roomId, rooms.id))
        .where(eq(rooms.propertyId, propertyId))
        .groupBy(rooms.id, rooms.name, rooms.quantity)
        .orderBy(asc(rooms.name)),
    );
  }
}

/**
 * Leg lifecycle helpers.
 *
 * Plain functions rather than methods: the booking service calls them inside its own
 * already-open tenant transaction, and injecting a whole provider just to reach two statements
 * would couple the two modules for no benefit.
 */

/** Create the per-room legs for a new booking. Units are assigned separately. */
export async function createLegs(
  tx: Tx,
  args: {
    tenantId: string;
    bookingId: string;
    rooms: number;
    checkin: string;
    checkout: string;
    adults?: number;
    children?: number;
  },
): Promise<void> {
  const legs = Array.from({ length: Math.max(args.rooms, 1) }, (_, i) => ({
    tenantId: args.tenantId,
    bookingId: args.bookingId,
    legIndex: i,
    checkin: args.checkin,
    checkout: args.checkout,
    adults: args.adults ?? 1,
    children: args.children ?? 0,
  }));
  await tx.insert(bookingRooms).values(legs);
}

/**
 * Free the units a booking held, without forgetting which they were.
 *
 * Stamping `released_at` rather than nulling `room_unit_id` is what lets the exclusion constraint
 * ignore the row while the history survives — so "which room was that cancellation in?" stays
 * answerable.
 */
export async function releaseLegs(tx: Tx, bookingId: string): Promise<void> {
  await tx
    .update(bookingRooms)
    .set({ releasedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)));
}

/** Drop every unit assignment on a booking, freeing the rooms but keeping the legs. */
export async function unassignLegs(tx: Tx, bookingId: string): Promise<void> {
  await tx
    .update(bookingRooms)
    .set({ roomUnitId: null, updatedAt: new Date() })
    .where(eq(bookingRooms.bookingId, bookingId));
}

/**
 * Re-shape a booking's legs after an amendment: new dates, and possibly a different number of
 * rooms. Surplus legs are removed highest-index-first so the remaining ones stay 0..n-1.
 *
 * Call `unassignLegs` first. Stretching a leg into dates its current room is not free for would
 * be refused by the exclusion constraint, which would fail the whole amendment — freeing the
 * rooms and re-assigning afterwards is the behaviour a front desk expects.
 */
export async function resizeLegs(
  tx: Tx,
  args: {
    tenantId: string;
    bookingId: string;
    rooms: number;
    checkin: string;
    checkout: string;
    adults?: number;
  },
): Promise<void> {
  const target = Math.max(args.rooms, 1);

  const existing = await tx
    .select({ id: bookingRooms.id, legIndex: bookingRooms.legIndex })
    .from(bookingRooms)
    .where(eq(bookingRooms.bookingId, args.bookingId))
    .orderBy(asc(bookingRooms.legIndex));

  if (existing.length > target) {
    const surplus = existing.slice(target).map((l) => l.id);
    await tx.delete(bookingRooms).where(inArray(bookingRooms.id, surplus));
  } else if (existing.length < target) {
    const additions = Array.from({ length: target - existing.length }, (_, i) => ({
      tenantId: args.tenantId,
      bookingId: args.bookingId,
      legIndex: existing.length + i,
      checkin: args.checkin,
      checkout: args.checkout,
      adults: args.adults ?? 1,
      children: 0,
    }));
    await tx.insert(bookingRooms).values(additions);
  }

  await tx
    .update(bookingRooms)
    .set({ checkin: args.checkin, checkout: args.checkout, updatedAt: new Date() })
    .where(eq(bookingRooms.bookingId, args.bookingId));
}
