import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookingApprovals,
  bookingRooms,
  bookings,
  housekeepingAsOf,
  maintenanceBlocks,
  markRoomVacated,
  properties,
  roomMoves,
  roomUnits,
  rooms,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type {
  AssignRoomsDto,
  BulkRoomUnitsDto,
  CreateRoomUnitDto,
  UpdateRoomUnitDto,
  MoveRoomDto,
  ExchangeRoomsDto,
} from './dto';
import { localToday } from '../common/local-date';
import { assertRoomsReadyForCheckIn } from '../housekeeping/readiness';
import { runBulk } from '../bookings/bulk';

/** Postgres raises this when the anti-double-booking exclusion constraint refuses a row. */
const EXCLUSION_VIOLATION = '23P01';

function isExclusionViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === EXCLUSION_VIOLATION;
}

/** Who is changing a room assignment, for the reservation's trail. */
export interface DeskActor {
  userId: string | null;
  ip: string | null;
}
const NO_ACTOR: DeskActor = { userId: null, ip: null };

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
          displayName: roomUnits.displayName,
          displayOrder: roomUnits.displayOrder,
          floor: roomUnits.floor,
          notes: roomUnits.notes,
          smokingPolicy: roomUnits.smokingPolicy,
          wheelchairAccessible: roomUnits.wheelchairAccessible,
          connectedRoomUnitId: roomUnits.connectedRoomUnitId,
          mapX: roomUnits.mapX,
          mapY: roomUnits.mapY,
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
      const [property] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .for('update');
      if (!property) throw new NotFoundException('Property not found');
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, dto.roomId));
      if (!room || room.propertyId !== propertyId) {
        throw new NotFoundException('Room not found in this property');
      }
      const [duplicate] = await tx
        .select({ id: roomUnits.id })
        .from(roomUnits)
        .where(
          and(
            eq(roomUnits.propertyId, propertyId),
            sql`lower(trim(${roomUnits.code})) = lower(trim(${dto.code}))`,
          ),
        );
      if (duplicate)
        throw new ConflictException(`Room "${dto.code}" already exists in this property`);
      if (dto.connectedRoomUnitId) {
        const [connected] = await tx
          .select({ id: roomUnits.id })
          .from(roomUnits)
          .where(
            and(eq(roomUnits.id, dto.connectedRoomUnitId), eq(roomUnits.propertyId, propertyId)),
          );
        if (!connected) throw new BadRequestException('Connected room must be in this property');
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
            code: dto.code.trim(),
            displayName: dto.displayName?.trim() || null,
            displayOrder,
            floor: dto.floor ?? null,
            notes: dto.notes ?? null,
            smokingPolicy: dto.smokingPolicy ?? 'unspecified',
            wheelchairAccessible: dto.wheelchairAccessible ?? false,
            connectedRoomUnitId: dto.connectedRoomUnitId ?? null,
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

  /** Review and save use the same checks; save repeats them under a property row lock. */
  private async bulkIssues(tx: Tx, propertyId: string, dto: BulkRoomUnitsDto) {
    const categoryRows = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.propertyId, propertyId));
    const categories = new Set(categoryRows.map((row) => row.id));
    const existingRows = await tx
      .select({ code: roomUnits.code })
      .from(roomUnits)
      .where(eq(roomUnits.propertyId, propertyId));
    const connectedIds = [
      ...new Set(
        dto.units.map((unit) => unit.connectedRoomUnitId).filter((id): id is string => !!id),
      ),
    ];
    const validConnected = new Set(
      connectedIds.length
        ? (
            await tx
              .select({ id: roomUnits.id })
              .from(roomUnits)
              .where(and(eq(roomUnits.propertyId, propertyId), inArray(roomUnits.id, connectedIds)))
          ).map((row) => row.id)
        : [],
    );
    const seen = new Set(existingRows.map((row) => row.code.trim().toLocaleLowerCase()));
    const issues: { index: number; field: string; message: string }[] = [];
    dto.units.forEach((unit, index) => {
      if (!categories.has(unit.roomId))
        issues.push({ index, field: 'roomId', message: 'Choose a category in this property.' });
      if (unit.connectedRoomUnitId && !validConnected.has(unit.connectedRoomUnitId))
        issues.push({
          index,
          field: 'connectedRoomUnitId',
          message: 'Connected room must already exist in this property.',
        });
      const code = unit.code.trim().toLocaleLowerCase();
      if (seen.has(code))
        issues.push({
          index,
          field: 'code',
          message: 'This room code already exists in the property or batch.',
        });
      if (!code) issues.push({ index, field: 'code', message: 'Enter a room code.' });
      seen.add(code);
    });
    return issues;
  }

  async previewBulk(tenantId: string, propertyId: string, dto: BulkRoomUnitsDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [property] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!property) throw new NotFoundException('Property not found');
      const issues = await this.bulkIssues(tx, propertyId, dto);
      return { valid: issues.length === 0, issues, count: dto.units.length };
    });
  }

  async createBulk(tenantId: string, propertyId: string, dto: BulkRoomUnitsDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      // Every bulk writer locks the property so two concurrent batches cannot pass review together.
      const [property] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .for('update');
      if (!property) throw new NotFoundException('Property not found');
      const issues = await this.bulkIssues(tx, propertyId, dto);
      if (issues.length)
        throw new BadRequestException({ message: 'Resolve room issues before saving.', issues });
      try {
        return await tx
          .insert(roomUnits)
          .values(
            dto.units.map((unit) => ({
              tenantId,
              propertyId,
              roomId: unit.roomId,
              code: unit.code.trim(),
              displayName: unit.displayName?.trim() || null,
              displayOrder:
                unit.displayOrder ?? (Number.parseInt(unit.code.replace(/\D/g, ''), 10) || 0),
              floor: unit.floor?.trim() || null,
              notes: unit.notes?.trim() || null,
              smokingPolicy: unit.smokingPolicy ?? 'unspecified',
              wheelchairAccessible: unit.wheelchairAccessible ?? false,
              connectedRoomUnitId: unit.connectedRoomUnitId ?? null,
            })),
          )
          .returning();
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('A room code was created concurrently. Review and retry.');
        throw error;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateRoomUnitDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, id));
      if (!unit) throw new NotFoundException('Room not found');
      await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, unit.propertyId))
        .for('update');
      if (dto.code) {
        const [duplicate] = await tx
          .select({ id: roomUnits.id })
          .from(roomUnits)
          .where(
            and(
              eq(roomUnits.propertyId, unit.propertyId),
              sql`${roomUnits.id} <> ${id}`,
              sql`lower(trim(${roomUnits.code})) = lower(trim(${dto.code}))`,
            ),
          );
        if (duplicate)
          throw new ConflictException(`Room "${dto.code}" already exists in this property`);
      }

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

      if (dto.connectedRoomUnitId) {
        const [connected] = await tx
          .select()
          .from(roomUnits)
          .where(eq(roomUnits.id, dto.connectedRoomUnitId));
        if (!connected || connected.propertyId !== unit.propertyId || connected.id === id) {
          throw new BadRequestException('Connected room must be another room in this property');
        }
      }

      try {
        const [updated] = await tx
          .update(roomUnits)
          .set({ ...dto, code: dto.code?.trim(), updatedAt: new Date() })
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
        displayName: roomUnits.displayName,
        checkin: bookingRooms.checkin,
        checkout: bookingRooms.checkout,
        adults: bookingRooms.adults,
        children: bookingRooms.children,
        updatedAt: bookingRooms.updatedAt,
        releasedAt: bookingRooms.releasedAt,
      })
      .from(bookingRooms)
      .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
      .where(eq(bookingRooms.bookingId, bookingId))
      .orderBy(asc(bookingRooms.legIndex), asc(bookingRooms.checkin));
  }

  /**
   * Assign specific units to specific legs.
   *
   * The database is the arbiter: the exclusion constraint on `booking_rooms` makes an overlapping
   * assignment impossible, so we do not pre-check and hope. That closes the same race the
   * `rooms_to_sell >= 0` check closes for buckets — two agents assigning the last free room at the
   * same moment cannot both win.
   */
  async assign(
    tenantId: string,
    bookingId: string,
    dto: AssignRoomsDto,
    actor: DeskActor = NO_ACTOR,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadAssignable(tx, bookingId);
      const codeOf = async (id: string) =>
        (await tx.select({ code: roomUnits.code }).from(roomUnits).where(eq(roomUnits.id, id)))[0]
          ?.code ?? 'another room';

      for (const a of dto.assignments) {
        const [leg] = await tx
          .select()
          .from(bookingRooms)
          .where(and(eq(bookingRooms.id, a.legId), eq(bookingRooms.bookingId, bookingId)))
          .for('update');
        if (!leg) throw new NotFoundException(`Leg ${a.legId} is not part of this booking`);
        if (a.expectedUpdatedAt && leg.updatedAt.toISOString() !== a.expectedUpdatedAt)
          throw new ConflictException(
            'The room assignment changed. Refresh the review before saving.',
          );
        if (booking.status === 'CheckedIn' && leg.roomUnitId && leg.roomUnitId !== a.roomUnitId)
          throw new ConflictException('Use the room-move workflow for an in-house guest.');

        if (a.roomUnitId === null) {
          if (
            booking.status === 'CheckedIn' ||
            leg.checkin <=
              localToday(
                (
                  await tx
                    .select({ timezone: properties.timezone })
                    .from(properties)
                    .where(eq(properties.id, booking.propertyId))
                )[0]?.timezone,
              )
          ) {
            throw new ConflictException('A room can only be unassigned before check-in');
          }
          await tx
            .update(bookingRooms)
            .set({ roomUnitId: null, updatedAt: new Date() })
            .where(eq(bookingRooms.id, a.legId));
          if (leg.roomUnitId)
            await this.trail(
              tx,
              tenantId,
              bookingId,
              'room_assigned',
              `Room ${await codeOf(leg.roomUnitId)} unassigned`,
              actor,
            );
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
        await this.assertDestinationFree(
          tx,
          a.roomUnitId,
          leg.checkin,
          leg.checkout,
          leg.id,
          unit.code,
        );

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
        if (leg.roomUnitId !== a.roomUnitId)
          await this.trail(
            tx,
            tenantId,
            bookingId,
            'room_assigned',
            leg.roomUnitId
              ? `Room ${await codeOf(leg.roomUnitId)} → ${unit.code}`
              : `Room ${unit.code} assigned`,
            actor,
          );
      }

      return this.legsOf(tx, bookingId);
    });
  }

  listMoves(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: roomMoves.id,
          bookingId: roomMoves.bookingId,
          legId: roomMoves.legId,
          fromRoomUnitId: roomMoves.fromRoomUnitId,
          toRoomUnitId: roomMoves.toRoomUnitId,
          effectiveDate: roomMoves.effectiveDate,
          status: roomMoves.status,
          createdAt: roomMoves.createdAt,
        })
        .from(roomMoves)
        .where(eq(roomMoves.bookingId, bookingId))
        .orderBy(desc(roomMoves.createdAt)),
    );
  }

  move(tenantId: string, bookingId: string, actor: DeskActor, dto: MoveRoomDto) {
    const userId = actor.userId;
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadAssignable(tx, bookingId);
      const [leg] = await tx
        .select()
        .from(bookingRooms)
        .where(and(eq(bookingRooms.id, dto.legId), eq(bookingRooms.bookingId, bookingId)))
        .for('update');
      if (!leg?.roomUnitId)
        throw new ConflictException('This reservation has no assigned room to move');
      if (dto.expectedUpdatedAt && leg.updatedAt.toISOString() !== dto.expectedUpdatedAt)
        throw new ConflictException(
          'The room assignment changed. Refresh the review before saving.',
        );
      const [from] = await tx.select().from(roomUnits).where(eq(roomUnits.id, leg.roomUnitId));
      const [to] = await tx.select().from(roomUnits).where(eq(roomUnits.id, dto.toRoomUnitId));
      if (
        !from ||
        !to ||
        to.propertyId !== booking.propertyId ||
        to.roomId !== booking.roomId ||
        to.status !== 'active'
      ) {
        throw new ConflictException('Destination must be an active room of the booked room type');
      }
      const [property] = await tx
        .select({ timezone: properties.timezone })
        .from(properties)
        .where(eq(properties.id, booking.propertyId));
      const today = localToday(property?.timezone);
      const inHouse = booking.status === 'CheckedIn';
      // A guest who has not arrived has slept in no room yet, so nothing stays behind: the whole
      // stay moves. Splitting at today (the in-house rule) would leave nights the guest never
      // stayed on the old room's record, so an overdue arrival would read as a stay in two rooms.
      const wholeStay = !inHouse && !dto.effectiveDate;
      const effectiveDate = wholeStay
        ? leg.checkin
        : (dto.effectiveDate ?? (leg.checkin > today ? leg.checkin : today));
      if (
        !wholeStay &&
        (effectiveDate < today || effectiveDate < leg.checkin || effectiveDate >= leg.checkout)
      )
        throw new ConflictException('Move date must be an affected stay date');
      if (inHouse && effectiveDate === today)
        await assertRoomsReadyForCheckIn(tx, booking.propertyId, [to.id], today);
      await this.assertNotBlocked(tx, to.id, effectiveDate, leg.checkout, to.code);
      await this.assertDestinationFree(tx, to.id, effectiveDate, leg.checkout, leg.id, to.code);
      if (dto.effectiveDate && effectiveDate > today) {
        const [planned] = await tx
          .insert(roomMoves)
          .values({
            tenantId,
            propertyId: booking.propertyId,
            bookingId,
            legId: leg.id,
            fromRoomUnitId: from.id,
            toRoomUnitId: to.id,
            effectiveDate,
            createdByUserId: userId,
          })
          .returning();
        await this.trail(
          tx,
          tenantId,
          bookingId,
          'room_moved',
          `Move planned: room ${from.code} → ${to.code} from ${effectiveDate}`,
          actor,
        );
        return planned;
      }
      let destinationLegId: string | null = null;
      try {
        if (effectiveDate > leg.checkin) {
          await tx
            .update(bookingRooms)
            .set({ checkout: effectiveDate, updatedAt: new Date() })
            .where(eq(bookingRooms.id, leg.id));
          const [destination] = await tx
            .insert(bookingRooms)
            .values({
              tenantId,
              bookingId,
              roomUnitId: to.id,
              legIndex: leg.legIndex,
              checkin: effectiveDate,
              checkout: leg.checkout,
              adults: leg.adults,
              children: leg.children,
              childAges: leg.childAges,
              extraBeds: leg.extraBeds,
            })
            .returning({ id: bookingRooms.id });
          destinationLegId = destination!.id;
        } else {
          await tx
            .update(bookingRooms)
            .set({ roomUnitId: to.id, updatedAt: new Date() })
            .where(eq(bookingRooms.id, leg.id));
        }
      } catch (error) {
        if (isExclusionViolation(error))
          throw new ConflictException(`Room ${to.code} is occupied over the affected dates`);
        throw error;
      }
      // The guest has walked out of the old room today, so housekeeping has to turn it over.
      if (inHouse)
        await markRoomVacated(tx, {
          tenantId,
          propertyId: booking.propertyId,
          roomUnitId: from.id,
          date: today,
          bookingId,
        });
      await this.trail(
        tx,
        tenantId,
        bookingId,
        'room_moved',
        effectiveDate > leg.checkin
          ? `Room ${from.code} → ${to.code} from ${effectiveDate}; earlier nights stay in ${from.code}`
          : `Room ${from.code} → ${to.code}`,
        actor,
      );
      const [completed] = await tx
        .insert(roomMoves)
        .values({
          tenantId,
          propertyId: booking.propertyId,
          bookingId,
          legId: leg.id,
          destinationLegId,
          fromRoomUnitId: from.id,
          toRoomUnitId: to.id,
          effectiveDate,
          status: 'completed',
          appliedAt: new Date(),
          createdByUserId: userId,
        })
        .returning();
      return completed;
    });
  }

  exchange(tenantId: string, actor: DeskActor, dto: ExchangeRoomsDto) {
    const userId = actor.userId;
    return this.dbs.withTenant(tenantId, async (tx) => {
      const ids = [dto.legId, dto.otherLegId].sort();
      const legs = await tx
        .select({ leg: bookingRooms, booking: bookings })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookings.id, bookingRooms.bookingId))
        .where(inArray(bookingRooms.id, ids))
        .orderBy(asc(bookingRooms.id))
        .for('update');
      if (legs.length !== 2 || legs.some((x) => !x.leg.roomUnitId || x.leg.releasedAt))
        throw new ConflictException('Both reservations need active room assignments');
      const [a, b] = legs;
      if (
        a!.booking.propertyId !== b!.booking.propertyId ||
        a!.booking.roomId !== b!.booking.roomId
      )
        throw new ConflictException(
          'Rooms can only be exchanged within the same property and room type',
        );
      if (a!.leg.checkin !== b!.leg.checkin || a!.leg.checkout !== b!.leg.checkout)
        throw new ConflictException(
          'Room exchange requires matching stay dates; use Room Move for different dates',
        );
      const [roomA, roomB] = await tx
        .select()
        .from(roomUnits)
        .where(inArray(roomUnits.id, [a!.leg.roomUnitId!, b!.leg.roomUnitId!]));
      const byId = new Map([roomA, roomB].filter(Boolean).map((r) => [r!.id, r!]));
      await this.assertNotBlocked(
        tx,
        b!.leg.roomUnitId!,
        a!.leg.checkin,
        a!.leg.checkout,
        byId.get(b!.leg.roomUnitId!)?.code ?? 'destination',
      );
      await this.assertNotBlocked(
        tx,
        a!.leg.roomUnitId!,
        b!.leg.checkin,
        b!.leg.checkout,
        byId.get(a!.leg.roomUnitId!)?.code ?? 'destination',
      );
      await tx
        .update(bookingRooms)
        .set({ roomUnitId: null, updatedAt: new Date() })
        .where(inArray(bookingRooms.id, ids));
      await tx
        .update(bookingRooms)
        .set({ roomUnitId: b!.leg.roomUnitId, updatedAt: new Date() })
        .where(eq(bookingRooms.id, a!.leg.id));
      await tx
        .update(bookingRooms)
        .set({ roomUnitId: a!.leg.roomUnitId, updatedAt: new Date() })
        .where(eq(bookingRooms.id, b!.leg.id));
      const date = localToday(
        (
          await tx
            .select({ timezone: properties.timezone })
            .from(properties)
            .where(eq(properties.id, a!.booking.propertyId))
        )[0]?.timezone,
      );
      const codeA = byId.get(a!.leg.roomUnitId!)?.code ?? 'room';
      const codeB = byId.get(b!.leg.roomUnitId!)?.code ?? 'room';
      await this.trail(
        tx,
        tenantId,
        a!.booking.id,
        'room_moved',
        `Rooms exchanged: ${codeA} → ${codeB}`,
        actor,
      );
      await this.trail(
        tx,
        tenantId,
        b!.booking.id,
        'room_moved',
        `Rooms exchanged: ${codeB} → ${codeA}`,
        actor,
      );
      return tx
        .insert(roomMoves)
        .values([
          {
            tenantId,
            propertyId: a!.booking.propertyId,
            bookingId: a!.booking.id,
            legId: a!.leg.id,
            destinationLegId: b!.leg.id,
            fromRoomUnitId: a!.leg.roomUnitId!,
            toRoomUnitId: b!.leg.roomUnitId!,
            effectiveDate: date,
            status: 'completed',
            appliedAt: new Date(),
            createdByUserId: userId,
          },
          {
            tenantId,
            propertyId: b!.booking.propertyId,
            bookingId: b!.booking.id,
            legId: b!.leg.id,
            destinationLegId: a!.leg.id,
            fromRoomUnitId: b!.leg.roomUnitId!,
            toRoomUnitId: a!.leg.roomUnitId!,
            effectiveDate: date,
            status: 'completed',
            appliedAt: new Date(),
            createdByUserId: userId,
          },
        ])
        .returning();
    });
  }

  stopMove(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [move] = await tx.select().from(roomMoves).where(eq(roomMoves.id, id)).for('update');
      if (!move) throw new NotFoundException('Room move not found');
      if (move.status !== 'planned')
        throw new ConflictException('Only a planned move can be stopped');
      const [stopped] = await tx
        .update(roomMoves)
        .set({ status: 'stopped', stoppedAt: new Date() })
        .where(eq(roomMoves.id, id))
        .returning();
      return stopped;
    });
  }

  private async assertDestinationFree(
    tx: Tx,
    roomUnitId: string,
    from: string,
    to: string,
    exceptLegId: string,
    code: string,
  ) {
    const [clash] = await tx
      .select({ id: bookingRooms.id })
      .from(bookingRooms)
      .where(
        and(
          eq(bookingRooms.roomUnitId, roomUnitId),
          isNull(bookingRooms.releasedAt),
          sql`${bookingRooms.id} <> ${exceptLegId}`,
          sql`daterange(${bookingRooms.checkin}, ${bookingRooms.checkout}, '[)') && daterange(${from}::date, ${to}::date, '[)')`,
        ),
      )
      .limit(1);
    const [planned] = await tx
      .select({ id: roomMoves.id })
      .from(roomMoves)
      .innerJoin(bookingRooms, eq(bookingRooms.id, roomMoves.legId))
      .where(
        and(
          eq(roomMoves.toRoomUnitId, roomUnitId),
          eq(roomMoves.status, 'planned'),
          sql`daterange(${roomMoves.effectiveDate}, ${bookingRooms.checkout}, '[)') && daterange(${from}::date, ${to}::date, '[)')`,
        ),
      )
      .limit(1);
    if (clash || planned)
      throw new ConflictException(`Room ${code} is already occupied or reserved over those dates`);
  }

  /**
   * Fill every unassigned leg with the lowest-numbered free room — the same first-fit rule the
   * back-fill migration used, and the order a front-desk agent would work in.
   *
   * Partial success is deliberate: assigning three of four rooms and reporting the shortfall is
   * more useful at a front desk than refusing to assign any.
   */
  /** Auto-assign rooms to a selection of stays (UX-2); each one stands or falls on its own. */
  bulkAutoAssign(tenantId: string, bookingIds: string[], actor: DeskActor = NO_ACTOR) {
    return runBulk(bookingIds, (id) => this.autoAssign(tenantId, id, actor));
  }

  async autoAssign(tenantId: string, bookingId: string, actor: DeskActor = NO_ACTOR) {
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
      const given: string[] = [];
      for (const leg of legs) {
        const free = await this.firstFreeUnit(tx, booking.roomId, leg.checkin, leg.checkout);
        if (!free) break;
        try {
          // Savepoint per attempt: in Postgres a constraint violation aborts the WHOLE
          // transaction, so without the nested scope the "partial success" below would run its
          // remaining statements on an aborted transaction and 500, rolling back every room
          // assigned earlier in the loop.
          await tx.transaction(async (sp) => {
            await sp
              .update(bookingRooms)
              .set({ roomUnitId: free, updatedAt: new Date() })
              .where(eq(bookingRooms.id, leg.id));
          });
          assigned += 1;
          given.push(free);
        } catch (e) {
          // Lost a race for that unit; stop rather than spin.
          if (!isExclusionViolation(e)) throw e;
          break;
        }
      }
      if (given.length) {
        const codes = await tx
          .select({ code: roomUnits.code })
          .from(roomUnits)
          .where(inArray(roomUnits.id, given));
        await this.trail(
          tx,
          tenantId,
          bookingId,
          'room_assigned',
          `Auto-assigned room ${codes.map((c) => c.code).join(', ')}`,
          actor,
        );
      }

      return {
        assigned,
        unassigned: legs.length - assigned,
        legs: await this.legsOf(tx, bookingId),
      };
    });
  }

  /** A room change on the reservation's own trail, beside check-in and check-out (Stay View). */
  private async trail(
    tx: Tx,
    tenantId: string,
    bookingId: string,
    action: 'room_assigned' | 'room_moved',
    reason: string,
    actor: DeskActor,
  ) {
    await tx.insert(bookingApprovals).values({
      tenantId,
      bookingId,
      action,
      reason,
      actorUserId: actor.userId,
      ip: actor.ip,
    });
  }

  /** The booking, if it is in a state where a room may be assigned to it. */
  private async loadAssignable(tx: Tx, bookingId: string) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    if (!b) throw new NotFoundException('Booking not found');
    if (
      b.status === 'Cancelled' ||
      b.status === 'Rejected' ||
      b.status === 'CheckedOut' ||
      b.status === 'NoShow'
    ) {
      throw new BadRequestException(`Cannot assign a room to a ${b.status} booking`);
    }
    // An inquiry has taken no room out of inventory, so it cannot occupy a physical one either:
    // assigning it would block a room the hotel is still selling. Confirm or hold it first.
    if (!b.inventoryHeld) {
      throw new BadRequestException(
        `${b.reference} does not hold rooms yet. Confirm it or put it on hold before assigning a room.`,
      );
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
    return (await freeUnits(tx, roomId, checkin, checkout, 1))[0] ?? null;
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

/**
 * Active units of a bucket that are free, unblocked and not promised to a planned move for the
 * whole range, lowest-numbered first — the order a front-desk agent works in.
 */
export async function freeUnits(
  tx: Tx,
  roomId: string,
  checkin: string,
  checkout: string,
  limit = 100,
): Promise<string[]> {
  const rows = await tx
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
        sql`not exists (
          select 1 from ${roomMoves} rm
          join ${bookingRooms} rb on rb.id = rm.leg_id
          where rm.to_room_unit_id = ${roomUnits.id}
            and rm.status = 'planned'
            and daterange(rm.effective_date, rb.checkout, '[)')
                && daterange(${checkin}::date, ${checkout}::date, '[)')
        )`,
      ),
    )
    .orderBy(asc(roomUnits.displayOrder), asc(roomUnits.code))
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Give every unassigned leg a room at check-in (UX-1a): the lowest-numbered free room of the
 * booking's type, a CLEAN one first — nobody should be handed a dirty room because it happened to
 * have the lower number. Returns how many legs are still without a room.
 *
 * A room type with no numbered rooms at all is a hotel that sells by type and does not track
 * individual rooms (yet): nothing can be assigned there, and nothing is required — 0.
 */
export async function assignRoomsForCheckIn(
  tx: Tx,
  booking: { id: string; roomId: string; propertyId: string },
  today: string,
): Promise<number> {
  const [numbered] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(roomUnits)
    .where(and(eq(roomUnits.roomId, booking.roomId), eq(roomUnits.status, 'active')));
  if ((numbered?.n ?? 0) === 0) return 0;

  const legs = await tx
    .select()
    .from(bookingRooms)
    .where(
      and(
        eq(bookingRooms.bookingId, booking.id),
        isNull(bookingRooms.roomUnitId),
        isNull(bookingRooms.releasedAt),
      ),
    )
    .orderBy(asc(bookingRooms.legIndex));
  if (legs.length === 0) return 0;

  const asOf = await housekeepingAsOf(tx, booking.propertyId, today);
  const usable = (id: string) => {
    const s = asOf.get(id)?.status;
    return s !== 'out_of_order';
  };
  let missing = 0;
  for (const leg of legs) {
    const candidates = (await freeUnits(tx, booking.roomId, leg.checkin, leg.checkout)).filter(
      usable,
    );
    const clean = candidates.filter((id) => asOf.get(id)?.status !== 'dirty');
    const pick = clean[0] ?? candidates[0];
    if (!pick) {
      missing += 1;
      continue;
    }
    try {
      await tx.transaction(async (sp) => {
        await sp
          .update(bookingRooms)
          .set({ roomUnitId: pick, updatedAt: new Date() })
          .where(eq(bookingRooms.id, leg.id));
      });
    } catch (e) {
      if (!isExclusionViolation(e)) throw e;
      missing += 1;
    }
  }
  return missing;
}

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

/**
 * Bring back the legs a booking's last release freed — reinstating a cancellation, or undoing a
 * check-out on the arrival day (UX-1a). Each leg keeps its room if the room is still free for its
 * dates; one that has since been given to someone else comes back unassigned. Returns how many
 * came back without a room.
 */
export async function restoreReleasedLegs(tx: Tx, bookingId: string): Promise<number> {
  const legs = await tx
    .select({ id: bookingRooms.id })
    .from(bookingRooms)
    .where(
      and(
        eq(bookingRooms.bookingId, bookingId),
        sql`${bookingRooms.releasedAt} = (
          select max(x.released_at) from booking_rooms x where x.booking_id = ${bookingId}
        )`,
      ),
    );
  let unassigned = 0;
  for (const leg of legs) {
    try {
      await tx.transaction(async (sp) => {
        await sp
          .update(bookingRooms)
          .set({ releasedAt: null, updatedAt: new Date() })
          .where(eq(bookingRooms.id, leg.id));
      });
    } catch (e) {
      if (!isExclusionViolation(e)) throw e;
      await tx
        .update(bookingRooms)
        .set({ releasedAt: null, roomUnitId: null, updatedAt: new Date() })
        .where(eq(bookingRooms.id, leg.id));
      unassigned += 1;
    }
  }
  return unassigned;
}

/**
 * Drop every LIVE unit assignment on a booking, freeing the rooms but keeping the legs.
 * Released legs are history — nulling their unit would erase "which room was that cancellation
 * in?", the exact record `releaseLegs` exists to preserve.
 */
export async function unassignLegs(tx: Tx, bookingId: string): Promise<void> {
  await tx
    .update(bookingRooms)
    .set({ roomUnitId: null, updatedAt: new Date() })
    .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)));
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

  // Only live legs are re-shaped; released ones are the cancellation history and keep their dates.
  const existing = await tx
    .select({ id: bookingRooms.id, legIndex: bookingRooms.legIndex })
    .from(bookingRooms)
    .where(and(eq(bookingRooms.bookingId, args.bookingId), isNull(bookingRooms.releasedAt)))
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
    .where(and(eq(bookingRooms.bookingId, args.bookingId), isNull(bookingRooms.releasedAt)));
}
