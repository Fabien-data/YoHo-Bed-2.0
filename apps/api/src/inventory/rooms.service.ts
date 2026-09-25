import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, between, desc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { cleanBedTypes, cleanRoomAmenities } from '@yohobed/domain';
import {
  properties,
  rooms,
  roomtypes,
  availabilityCalendar,
  ariHistory,
  maintenanceBlocks,
  roomUnits,
  enqueueOutbox,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { dateRangeInclusive } from '../common/dates';
import type {
  CreateRoomDto,
  OpenAvailabilityDto,
  RestrictionsDto,
  RoomOrderDto,
  RoomtypeDto,
  UpdateRoomDto,
} from './dto';

/** A duplicate short code, said plainly (the unique index is case-insensitive). */
function rethrowShortCode(e: unknown, code: string | null | undefined): never {
  const pgCode =
    (e as { code?: string; cause?: { code?: string } })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;
  if (pgCode === '23505')
    throw new ConflictException(`Another room type already uses the short code "${code}"`);
  if (pgCode === '23514')
    throw new BadRequestException('The base guests cannot be more than the maximum');
  throw e;
}

/** The Room Type fields a create or an update may set, cleaned. */
function roomTypeValues(dto: CreateRoomDto | UpdateRoomDto) {
  return {
    ...(dto.shortCode !== undefined && { shortCode: dto.shortCode?.toUpperCase() ?? null }),
    ...(dto.description !== undefined && { description: dto.description || null }),
    ...(dto.baseAdults !== undefined && { baseAdults: dto.baseAdults }),
    ...(dto.baseChildren !== undefined && { baseChildren: dto.baseChildren }),
    ...(dto.maxAdults !== undefined && { maxAdults: dto.maxAdults }),
    ...(dto.maxChildren !== undefined && { maxChildren: dto.maxChildren }),
    ...(dto.bedTypes !== undefined && { bedTypes: cleanBedTypes(dto.bedTypes) }),
    ...(dto.amenities !== undefined && { amenities: cleanRoomAmenities(dto.amenities) }),
    ...(dto.color !== undefined && { color: dto.color }),
    ...(dto.active !== undefined && { active: dto.active }),
  };
}

@Injectable()
export class RoomsService {
  constructor(private readonly dbs: DatabaseService) {}

  /**
   * The property's room types in the hotel's own order, with what the Room Type list shows beside
   * each: how many numbered rooms it has, how many rate plans sell it, and whether it has ever been
   * booked (only a type never booked can be deleted; any other is switched off instead).
   */
  listByProperty(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          ...getTableColumns(rooms),
          // Correlations spelled out in full: a single-table select would render a bare "id", which
          // Postgres resolves against the subquery's own table.
          units: sql<number>`(select count(*) from room_units u where u.room_id = rooms.id)::int`,
          ratePlans: sql<number>`(select count(*) from rate_plans p where p.room_id = rooms.id)::int`,
          booked: sql<boolean>`exists (select 1 from bookings b where b.room_id = rooms.id)`,
          photos: sql<number>`(select count(*) from media m where m.room_id = rooms.id)::int`,
        })
        .from(rooms)
        .where(eq(rooms.propertyId, propertyId))
        .orderBy(asc(rooms.sortOrder), asc(rooms.name)),
    );
  }

  createRoom(tenantId: string, propertyId: string, dto: CreateRoomDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [prop] = await tx.select().from(properties).where(eq(properties.id, propertyId));
      if (!prop) throw new NotFoundException('Property not found');
      // A new room type goes to the end of the hotel's list.
      const [last] = await tx
        .select({ max: sql<number>`coalesce(max(${rooms.sortOrder}), 0)::int` })
        .from(rooms)
        .where(eq(rooms.propertyId, propertyId));
      try {
        const [room] = await tx
          .insert(rooms)
          .values({
            tenantId,
            propertyId,
            name: dto.name,
            quantity: dto.quantity,
            roomtypeId: dto.roomtypeId ?? null,
            sortOrder: (last?.max ?? 0) + 10,
            ...roomTypeValues(dto),
          })
          .returning();
        return room;
      } catch (e) {
        rethrowShortCode(e, dto.shortCode);
      }
    });
  }

  async updateRoom(tenantId: string, id: string, dto: UpdateRoomDto) {
    const [room] = await this.dbs.withTenant(tenantId, async (tx) => {
      try {
        return await tx
          .update(rooms)
          .set({
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
            ...(dto.roomtypeId !== undefined ? { roomtypeId: dto.roomtypeId } : {}),
            ...roomTypeValues(dto),
            updatedAt: new Date(),
          })
          .where(eq(rooms.id, id))
          .returning();
      } catch (e) {
        rethrowShortCode(e, dto.shortCode);
      }
    });
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  /**
   * Delete a room type — only one that has never been booked, because a booking's history needs
   * its room type. Its rate plans, prices, availability, numbered rooms and photos go with it.
   * Anything that has been sold is switched off instead (`active`), which stops new sales.
   */
  deleteRoom(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, id)).for('update');
      if (!room) throw new NotFoundException('Room type not found');
      const [used] = (await tx.execute(
        sql`select exists (select 1 from bookings b where b.room_id = ${id}) as used`,
      )) as unknown as Array<{ used: boolean }>;
      if (used?.used)
        throw new ConflictException({
          reason: 'room_type_booked',
          message: `${room.name} has bookings, so it cannot be deleted. Switch it off to stop selling it.`,
        });
      await tx.delete(rooms).where(eq(rooms.id, id));
      return { deleted: true, id };
    });
  }

  /** Put the property's room types in the order given (Yanolja's drag handles). */
  reorderRooms(tenantId: string, propertyId: string, dto: RoomOrderDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const mine = await tx
        .select({ id: rooms.id })
        .from(rooms)
        .where(and(eq(rooms.propertyId, propertyId), inArray(rooms.id, dto.ids)));
      if (mine.length !== dto.ids.length)
        throw new BadRequestException('Every room type in the order must belong to this property');
      for (const [i, id] of dto.ids.entries())
        await tx
          .update(rooms)
          .set({ sortOrder: (i + 1) * 10, updatedAt: new Date() })
          .where(eq(rooms.id, id));
      return { ordered: dto.ids.length };
    });
  }

  listRoomtypes(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(roomtypes).orderBy(roomtypes.name),
    );
  }

  async createRoomtype(tenantId: string, dto: RoomtypeDto) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.insert(roomtypes).values({ tenantId, name: dto.name }).returning(),
    );
    return row;
  }

  async updateRoomtype(tenantId: string, id: string, dto: RoomtypeDto) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .update(roomtypes)
        .set({ name: dto.name, updatedAt: new Date() })
        .where(eq(roomtypes.id, id))
        .returning(),
    );
    if (!row) throw new NotFoundException('Room type not found');
    return row;
  }

  /** Open (or update) a room's availability for an inclusive date range. */
  openAvailability(
    tenantId: string,
    roomId: string,
    dto: OpenAvailabilityDto,
    actorEmail?: string,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
      if (!room) throw new NotFoundException('Room not found');

      const sellable = Math.min(dto.roomsToSell, room.quantity);
      const dates = dateRangeInclusive(dto.from, dto.to);

      // `rooms_to_sell` is a live counter that bookings have already decremented (reserveStay).
      // Writing the requested number absolutely would re-open rooms that are sold — the classic
      // "owner re-opens the month, hotel overbooks" path. So the counter is re-derived per date:
      // requested sellable minus the rooms still held on that night. "Held" is `inventory_held`
      // (an inquiry holds nothing) up to `inventory_released_from` (a no-show gave the rest back).
      const bookedRows = (await tx.execute(sql`
        SELECT d::date AS date, COALESCE(SUM(b.rooms), 0)::int AS booked
          FROM generate_series(${dto.from}::date, ${dto.to}::date, '1 day') AS d
          LEFT JOIN bookings b
            ON b.room_id = ${roomId}
           AND b.inventory_held
           AND b.checkin <= d::date
           AND COALESCE(b.inventory_released_from, b.checkout) > d::date
         GROUP BY d
      `)) as unknown as Array<{ date: string | Date; booked: number }>;
      const bookedByDate = new Map(
        bookedRows.map((r) => [
          r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
          Number(r.booked),
        ]),
      );

      const blockedRows = (await tx.execute(sql`
        SELECT d::date AS date, COUNT(m.id)::int AS blocked
          FROM generate_series(${dto.from}::date, ${dto.to}::date, '1 day') AS d
          LEFT JOIN ${roomUnits} u ON u.room_id = ${roomId}
          LEFT JOIN ${maintenanceBlocks} m
            ON m.room_unit_id = u.id
           AND m.released_at IS NULL
           AND m.block_from <= d::date
           AND m.block_to > d::date
         GROUP BY d
      `)) as unknown as Array<{ date: string | Date; blocked: number }>;
      const blockedByDate = new Map(
        blockedRows.map((row) => [
          row.date instanceof Date
            ? row.date.toISOString().slice(0, 10)
            : String(row.date).slice(0, 10),
          Number(row.blocked),
        ]),
      );

      for (const date of dates) {
        const roomsToSell = Math.max(
          0,
          sellable - (bookedByDate.get(date) ?? 0) - (blockedByDate.get(date) ?? 0),
        );
        await tx
          .insert(availabilityCalendar)
          .values({
            tenantId,
            propertyId: room.propertyId,
            roomId,
            date,
            physicalQuantity: room.quantity,
            roomsToSell,
            status: dto.status,
          })
          .onConflictDoUpdate({
            target: [availabilityCalendar.roomId, availabilityCalendar.date],
            set: {
              physicalQuantity: room.quantity,
              roomsToSell,
              status: dto.status,
              updatedAt: sql`now()`,
            },
          });
      }
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'availability',
        aggregateId: roomId,
        eventType: 'ari.availability',
        payload: {
          propertyId: room.propertyId,
          roomId,
          from: dto.from,
          to: dto.to,
          action: 'open',
        },
      });
      await tx.insert(ariHistory).values({
        tenantId,
        propertyId: room.propertyId,
        roomId,
        kind: 'availability',
        fromDate: dto.from,
        toDate: dto.to,
        detail: { roomsToSell: sellable, status: dto.status },
        actorEmail: actorEmail ?? null,
      });
      return { opened: dates.length, from: dto.from, to: dto.to, roomsToSell: sellable };
    });
  }

  /** Set arrival-based min/max-stay restrictions across a date range (legacy ARI parity). */
  setRestrictions(tenantId: string, roomId: string, dto: RestrictionsDto, actorEmail?: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
      if (!room) throw new NotFoundException('Room not found');

      const updated = await tx
        .update(availabilityCalendar)
        .set({ minStay: dto.minStay, maxStay: dto.maxStay, updatedAt: sql`now()` })
        .where(
          and(
            eq(availabilityCalendar.roomId, roomId),
            between(availabilityCalendar.date, dto.from, dto.to),
          ),
        )
        .returning({ id: availabilityCalendar.id });

      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'availability',
        aggregateId: roomId,
        eventType: 'ari.restriction',
        payload: {
          propertyId: room.propertyId,
          roomId,
          from: dto.from,
          to: dto.to,
          minStay: dto.minStay,
          maxStay: dto.maxStay,
        },
      });
      await tx.insert(ariHistory).values({
        tenantId,
        propertyId: room.propertyId,
        roomId,
        kind: 'restriction',
        fromDate: dto.from,
        toDate: dto.to,
        detail: { minStay: dto.minStay, maxStay: dto.maxStay },
        actorEmail: actorEmail ?? null,
      });
      return {
        updated: updated.length,
        from: dto.from,
        to: dto.to,
        minStay: dto.minStay,
        maxStay: dto.maxStay,
      };
    });
  }

  /** The owner-facing ARI change log for one room, newest first. */
  getAriHistory(tenantId: string, roomId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(ariHistory)
        .where(eq(ariHistory.roomId, roomId))
        .orderBy(desc(ariHistory.createdAt))
        .limit(100),
    );
  }
}
