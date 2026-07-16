import { ConflictException, Injectable } from '@nestjs/common';
import { and, between, eq } from 'drizzle-orm';
import {
  availabilityCalendar,
  reserveStay,
  releaseStay,
  enqueueOutbox,
  InsufficientAvailabilityError,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { eachNight } from '../common/dates';

@Injectable()
export class InventoryService {
  constructor(private readonly dbs: DatabaseService) {}

  getAvailability(tenantId: string, roomId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(availabilityCalendar)
        .where(
          and(
            eq(availabilityCalendar.roomId, roomId),
            between(availabilityCalendar.date, from, to),
          ),
        )
        .orderBy(availabilityCalendar.date),
    );
  }

  async reserve(
    tenantId: string,
    roomId: string,
    checkin: string,
    checkout: string,
    rooms: number,
  ) {
    const nights = eachNight(checkin, checkout);
    try {
      await this.dbs.withTenant(tenantId, async (tx) => {
        await reserveStay(tx, roomId, nights, rooms);
        await enqueueOutbox(tx, {
          tenantId,
          aggregate: 'availability',
          aggregateId: roomId,
          eventType: 'ari.availability',
          payload: { roomId, nights, rooms, action: 'reserve' },
        });
      });
      return { reserved: true, roomId, checkin, checkout, rooms, nights };
    } catch (err) {
      if (err instanceof InsufficientAvailabilityError) {
        throw new ConflictException({
          reserved: false,
          reason: 'insufficient_availability',
          date: err.date,
        });
      }
      throw err;
    }
  }

  async release(
    tenantId: string,
    roomId: string,
    checkin: string,
    checkout: string,
    rooms: number,
  ) {
    const nights = eachNight(checkin, checkout);
    await this.dbs.withTenant(tenantId, async (tx) => {
      await releaseStay(tx, roomId, nights, rooms);
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'availability',
        aggregateId: roomId,
        eventType: 'ari.availability',
        payload: { roomId, nights, rooms, action: 'release' },
      });
    });
    return { released: true, roomId, checkin, checkout, rooms, nights };
  }
}
