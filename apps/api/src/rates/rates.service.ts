import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, eq, sql } from 'drizzle-orm';
import { priceDay, type CommissionStructure } from '@yohobed/domain';
import {
  properties,
  rooms,
  ratePlans,
  occupancies,
  rateCalendar,
  rateCodes,
  enqueueOutbox,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { dateRangeInclusive } from '../common/dates';

/** OTA commission percentage (legacy OTA_COMMISSION_RATE). Config-driven later. */
const OTA_RATE = 18;

@Injectable()
export class RatesService {
  constructor(private readonly dbs: DatabaseService) {}

  /** The per-date selling prices for a room (joined rate plan → occupancy → calendar). */
  getRoomRates(tenantId: string, roomId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          date: rateCalendar.date,
          occupancyId: rateCalendar.occupancyId,
          basePrice: rateCalendar.basePrice,
          commission: rateCalendar.commission,
          sellingPrice: rateCalendar.sellingPrice,
          rateCode: rateCodes.code,
          accommodates: occupancies.accommodates,
        })
        .from(rateCalendar)
        .innerJoin(occupancies, eq(occupancies.id, rateCalendar.occupancyId))
        .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
        .innerJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
        .where(and(eq(ratePlans.roomId, roomId), between(rateCalendar.date, from, to)))
        .orderBy(rateCalendar.date),
    );
  }

  /**
   * Set the base price for an occupancy across a date range; the selling price is derived by the
   * parity-tested domain engine (commission + OTA gross-up), never entered by hand.
   */
  setPriceRange(tenantId: string, occupancyId: string, from: string, to: string, base: number) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [ctx] = await tx
        .select({
          commissionType: properties.commissionType,
          commissionPercentage: properties.commissionPercentage,
        })
        .from(occupancies)
        .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
        .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
        .innerJoin(properties, eq(properties.id, rooms.propertyId))
        .where(eq(occupancies.id, occupancyId));
      if (!ctx) throw new NotFoundException('Occupancy not found');

      if (ctx.commissionType === 'slab') {
        throw new BadRequestException('Slab commission is not configured for this property yet');
      }
      const structure: CommissionStructure = {
        type: 'percentage',
        percentage: Number(ctx.commissionPercentage),
      };

      const priced = priceDay(base, structure, OTA_RATE);
      const values = {
        basePrice: base.toFixed(2),
        commission: priced.commission.toFixed(2),
        sellingPrice: priced.selling.toFixed(2),
      };

      const dates = dateRangeInclusive(from, to);
      for (const date of dates) {
        await tx
          .insert(rateCalendar)
          .values({ tenantId, occupancyId, date, ...values })
          .onConflictDoUpdate({
            target: [rateCalendar.occupancyId, rateCalendar.date],
            set: { ...values, updatedAt: sql`now()` },
          });
      }
      // Transactional outbox: schedule a channel-manager rate push atomically with the change.
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'rate',
        aggregateId: occupancyId,
        eventType: 'ari.rate',
        payload: { occupancyId, from, to, base },
      });
      return { updated: dates.length, base, selling: priced.selling, commission: priced.commission };
    });
  }
}
