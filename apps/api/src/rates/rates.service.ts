import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, eq, sql } from 'drizzle-orm';
import {
  computeCommission,
  sellingPrice,
  sellingFromCommissionable,
  applyLastMinuteDrop,
  type CommissionStructure,
} from '@yohobed/domain';
import {
  properties,
  rooms,
  ratePlans,
  occupancies,
  rateCalendar,
  rateCodes,
  seasons,
  commissionSlabs,
  ariHistory,
  enqueueOutbox,
  resolveTaxRatesForDates,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { dateRangeInclusive } from '../common/dates';

/** OTA commission percentage (legacy OTA_COMMISSION_RATE). Config-driven later. */
const OTA_RATE = 18;

@Injectable()
export class RatesService {
  constructor(private readonly dbs: DatabaseService) {}

  /** The per-date prices for a room, with the effective charged price after any last-minute drop. */
  async getRoomRates(tenantId: string, roomId: string, from: string, to: string) {
    const rows = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          date: rateCalendar.date,
          occupancyId: rateCalendar.occupancyId,
          basePrice: rateCalendar.basePrice,
          commission: rateCalendar.commission,
          sellingPrice: rateCalendar.sellingPrice,
          lastMinuteDropPct: rateCalendar.lastMinuteDropPct,
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
    return rows.map((r) => ({
      ...r,
      effectiveSelling: applyLastMinuteDrop(
        Number(r.sellingPrice),
        Number(r.lastMinuteDropPct),
      ).toFixed(2),
    }));
  }

  /**
   * Set the base price for an occupancy across a date range; the selling price is derived by the
   * parity-tested domain engine, never entered by hand:
   *   base → Yoho commission (slab or percentage) → OTA gross-up (÷0.82) → per-day tax gross-up.
   * Tax rates can vary by date, so the selling price is computed per day; base and commission are
   * date-independent. Untaxed properties gross up by ×1, so their stored numbers are unchanged.
   */
  setPriceRange(
    tenantId: string,
    occupancyId: string,
    from: string,
    to: string,
    base: number,
    actorEmail?: string,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [ctx] = await tx
        .select({
          propertyId: properties.id,
          roomId: rooms.id,
          commissionType: properties.commissionType,
          commissionPercentage: properties.commissionPercentage,
        })
        .from(occupancies)
        .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
        .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
        .innerJoin(properties, eq(properties.id, rooms.propertyId))
        .where(eq(occupancies.id, occupancyId));
      if (!ctx) throw new NotFoundException('Occupancy not found');

      // Resolve the property's Yoho commission model (percentage or slab-based).
      let structure: CommissionStructure;
      if (ctx.commissionType === 'slab') {
        const slabs = await tx
          .select()
          .from(commissionSlabs)
          .where(eq(commissionSlabs.propertyId, ctx.propertyId));
        if (slabs.length === 0) {
          throw new BadRequestException(
            'Property uses slab commission but has no commission slabs configured',
          );
        }
        structure = {
          type: 'slab',
          slabs: slabs.map((s) => ({
            slabStart: Number(s.slabStart),
            slabEnd: Number(s.slabEnd),
            commission: Number(s.commission),
          })),
        };
      } else {
        structure = { type: 'percentage', percentage: Number(ctx.commissionPercentage) };
      }

      // Commission and the tax-exclusive commissionable are date-independent; tax may vary per day.
      const commission = computeCommission(base, structure);
      const commissionable = sellingPrice(base, commission, OTA_RATE);

      const dates = dateRangeInclusive(from, to);
      const taxByDate = await resolveTaxRatesForDates(tx, ctx.propertyId, dates);

      let firstSelling = commissionable;
      for (const date of dates) {
        const selling = sellingFromCommissionable(commissionable, taxByDate.get(date)!);
        if (date === dates[0]) firstSelling = selling;
        const values = {
          basePrice: base.toFixed(2),
          commission: commission.toFixed(2),
          sellingPrice: selling.toFixed(2),
        };
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
        // propertyId/roomId are what the channel manager keys on — carry them so the adapter
        // can map the event without a database round-trip.
        payload: { propertyId: ctx.propertyId, roomId: ctx.roomId, occupancyId, from, to, base },
      });
      await tx.insert(ariHistory).values({
        tenantId,
        propertyId: ctx.propertyId,
        roomId: ctx.roomId,
        kind: 'price',
        fromDate: from,
        toDate: to,
        detail: { occupancyId, base, commission, selling: firstSelling },
        actorEmail: actorEmail ?? null,
      });
      return { updated: dates.length, base, selling: firstSelling, commission };
    });
  }

  // --- Rate plans / occupancies / seasons / last-minute drops (Compartment B) ------

  /** The global meal-plan lookup (RO/BB/HB/FB/AI) for building rate plans. */
  listRateCodes() {
    return this.dbs.db.select().from(rateCodes).orderBy(rateCodes.sortOrder);
  }

  /** Rate plans (room × meal plan) for a room. */
  listRatePlans(tenantId: string, roomId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: ratePlans.id,
          roomId: ratePlans.roomId,
          rateCodeId: ratePlans.rateCodeId,
          code: rateCodes.code,
          name: rateCodes.name,
          status: ratePlans.status,
        })
        .from(ratePlans)
        .innerJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
        .where(eq(ratePlans.roomId, roomId))
        .orderBy(rateCodes.sortOrder),
    );
  }

  createRatePlan(tenantId: string, roomId: string, rateCodeId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [room] = await tx
        .select({ propertyId: rooms.propertyId })
        .from(rooms)
        .where(eq(rooms.id, roomId));
      if (!room) throw new NotFoundException('Room not found');
      const [dupe] = await tx
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(and(eq(ratePlans.roomId, roomId), eq(ratePlans.rateCodeId, rateCodeId)));
      if (dupe) throw new BadRequestException('That meal plan already exists for this room');
      const [rp] = await tx
        .insert(ratePlans)
        .values({ tenantId, propertyId: room.propertyId, roomId, rateCodeId })
        .returning();
      return rp;
    });
  }

  /** Occupancies (guest configurations) for a rate plan. */
  listOccupancies(tenantId: string, ratePlanId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(occupancies)
        .where(eq(occupancies.ratePlanId, ratePlanId))
        .orderBy(occupancies.accommodates),
    );
  }

  createOccupancy(tenantId: string, ratePlanId: string, label: string, accommodates: number) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [rp] = await tx
        .select({ id: ratePlans.id })
        .from(ratePlans)
        .where(eq(ratePlans.id, ratePlanId));
      if (!rp) throw new NotFoundException('Rate plan not found');
      const [occ] = await tx
        .insert(occupancies)
        .values({ tenantId, ratePlanId, label, accommodates })
        .returning();
      return occ;
    });
  }

  /** Named seasonal ranges for a property (an authoring overlay for the calendar). */
  listSeasons(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(seasons)
        .where(eq(seasons.propertyId, propertyId))
        .orderBy(seasons.startDate),
    );
  }

  createSeason(tenantId: string, propertyId: string, name: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [prop] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!prop) throw new NotFoundException('Property not found');
      const [s] = await tx
        .insert(seasons)
        .values({ tenantId, propertyId, name, startDate: from, endDate: to })
        .returning();
      return s;
    });
  }

  /** Paint a base price across a season's range for one or more occupancies (reuses setPriceRange). */
  async applySeason(
    tenantId: string,
    seasonId: string,
    prices: { occupancyId: string; base: number }[],
  ) {
    const [season] = await this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(seasons).where(eq(seasons.id, seasonId)),
    );
    if (!season) throw new NotFoundException('Season not found');
    for (const p of prices) {
      await this.setPriceRange(tenantId, p.occupancyId, season.startDate, season.endDate, p.base);
    }
    return {
      season: season.name,
      from: season.startDate,
      to: season.endDate,
      occupancies: prices.length,
    };
  }

  /** Set a last-minute discount % across a date range for an occupancy; queues a rate push. */
  setLastMinuteDrop(
    tenantId: string,
    occupancyId: string,
    from: string,
    to: string,
    dropPct: number,
    actorEmail?: string,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const updated = await tx
        .update(rateCalendar)
        .set({ lastMinuteDropPct: dropPct.toFixed(2), updatedAt: sql`now()` })
        .where(and(eq(rateCalendar.occupancyId, occupancyId), between(rateCalendar.date, from, to)))
        .returning({ id: rateCalendar.id });
      const [ctx] = await tx
        .select({ propertyId: rooms.propertyId, roomId: rooms.id })
        .from(occupancies)
        .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
        .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
        .where(eq(occupancies.id, occupancyId));
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'rate',
        aggregateId: occupancyId,
        eventType: 'ari.rate',
        payload: {
          propertyId: ctx?.propertyId,
          roomId: ctx?.roomId,
          occupancyId,
          from,
          to,
          lastMinuteDropPct: dropPct,
        },
      });
      if (ctx) {
        await tx.insert(ariHistory).values({
          tenantId,
          propertyId: ctx.propertyId,
          roomId: ctx.roomId,
          kind: 'drop',
          fromDate: from,
          toDate: to,
          detail: { occupancyId, dropPct },
          actorEmail: actorEmail ?? null,
        });
      }
      return { updated: updated.length, occupancyId, from, to, dropPct };
    });
  }
}
