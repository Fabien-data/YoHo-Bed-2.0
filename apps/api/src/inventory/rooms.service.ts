import { Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { properties, rooms, roomtypes, availabilityCalendar } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { dateRangeInclusive } from '../common/dates';
import type { CreateRoomDto, OpenAvailabilityDto, RoomtypeDto, UpdateRoomDto } from './dto';

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
  openAvailability(tenantId: string, roomId: string, dto: OpenAvailabilityDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
      if (!room) throw new NotFoundException('Room not found');

      const roomsToSell = Math.min(dto.roomsToSell, room.quantity);
      const dates = dateRangeInclusive(dto.from, dto.to);
      for (const date of dates) {
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
      return { opened: dates.length, from: dto.from, to: dto.to, roomsToSell };
    });
  }
}
