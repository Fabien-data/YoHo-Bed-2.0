import { Injectable, NotFoundException } from '@nestjs/common';
import { and, between, desc, eq, sql } from 'drizzle-orm';
import {
  properties,
  rooms,
  roomtypes,
  availabilityCalendar,
  ariHistory,
  enqueueOutbox,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { dateRangeInclusive } from '../common/dates';
import type {
  CreateRoomDto,
  OpenAvailabilityDto,
  RestrictionsDto,
  RoomtypeDto,
  UpdateRoomDto,
} from './dto';

@Injectable()
export class RoomsService {
  constructor(private readonly dbs: DatabaseService) {}

  listByProperty(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(rooms).where(eq(rooms.propertyId, propertyId)).orderBy(rooms.createdAt),
    );
  }

  createRoom(tenantId: string, propertyId: string, dto: CreateRoomDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [prop] = await tx.select().from(properties).where(eq(properties.id, propertyId));
      if (!prop) throw new NotFoundException('Property not found');
      const [room] = await tx
        .insert(rooms)
        .values({
          tenantId,
          propertyId,
          name: dto.name,
          quantity: dto.quantity,
          roomtypeId: dto.roomtypeId ?? null,
        })
        .returning();
      return room;
    });
  }

  async updateRoom(tenantId: string, id: string, dto: UpdateRoomDto) {
    const [room] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .update(rooms)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.roomtypeId !== undefined ? { roomtypeId: dto.roomtypeId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(rooms.id, id))
        .returning(),
    );
    if (!room) throw new NotFoundException('Room not found');
    return room;
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
      // requested sellable minus the rooms still held by non-terminal bookings on that night.
      const bookedRows = (await tx.execute(sql`
        SELECT d::date AS date, COALESCE(SUM(b.rooms), 0)::int AS booked
          FROM generate_series(${dto.from}::date, ${dto.to}::date, '1 day') AS d
          LEFT JOIN bookings b
            ON b.room_id = ${roomId}
           AND b.status NOT IN ('Cancelled', 'Rejected')
           AND b.checkin <= d::date
           AND b.checkout > d::date
         GROUP BY d
      `)) as unknown as Array<{ date: string | Date; booked: number }>;
      const bookedByDate = new Map(
        bookedRows.map((r) => [
          r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10),
          Number(r.booked),
        ]),
      );

      for (const date of dates) {
        const roomsToSell = Math.max(0, sellable - (bookedByDate.get(date) ?? 0));
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
