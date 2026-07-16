import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, between, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  promotions,
  coupons,
  referralPartners,
  referralCommissions,
  properties,
  occupancies,
  ratePlans,
  rooms,
  rateCalendar,
  bookings,
  enqueueOutbox,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { CreatePromotionDto, CreateCouponDto, CreateReferralPartnerDto } from './dto';

/**
 * Commercial management (Compartment D): promotions, coupons, and referral partners. Redemption
 * of coupons / recording of referral commissions happens at booking time in BookingService; this
 * service owns the CRUD + applying a promotion's discount onto the rate calendar.
 */
@Injectable()
export class CommercialService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Promotions ------------------------------------------------------------
  listPromotions(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(promotions)
        .where(eq(promotions.propertyId, propertyId))
        .orderBy(desc(promotions.createdAt)),
    );
  }

  createPromotion(tenantId: string, propertyId: string, dto: CreatePromotionDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [prop] = await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!prop) throw new NotFoundException('Property not found');
      const [p] = await tx
        .insert(promotions)
        .values({
          tenantId,
          propertyId,
          name: dto.name,
          discountPct: dto.discountPct.toFixed(2),
          startDate: dto.from,
          endDate: dto.to,
          minNights: dto.minNights,
        })
        .returning();
      return p;
    });
  }

  deletePromotion(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const res = await tx
        .delete(promotions)
        .where(eq(promotions.id, id))
        .returning({ id: promotions.id });
      if (!res.length) throw new NotFoundException('Promotion not found');
      return { deleted: true };
    });
  }

  /** Push a promotion's discount onto the rate calendar for every occupancy of its property. */
  applyPromotion(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [promo] = await tx.select().from(promotions).where(eq(promotions.id, id));
      if (!promo) throw new NotFoundException('Promotion not found');

      const occRows = await tx
        .select({ id: occupancies.id, roomId: rooms.id })
        .from(occupancies)
        .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
        .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
        .where(eq(rooms.propertyId, promo.propertyId));
      const occIds = occRows.map((o) => o.id);

      let updated = 0;
      if (occIds.length) {
        const res = await tx
          .update(rateCalendar)
          .set({ lastMinuteDropPct: promo.discountPct, updatedAt: sql`now()` })
          .where(
            and(
              inArray(rateCalendar.occupancyId, occIds),
              between(rateCalendar.date, promo.startDate, promo.endDate),
            ),
          )
          .returning({ id: rateCalendar.id });
        updated = res.length;
        for (const occ of occRows) {
          await enqueueOutbox(tx, {
            tenantId,
            aggregate: 'rate',
            aggregateId: occ.id,
            eventType: 'ari.rate',
            payload: {
              propertyId: promo.propertyId,
              roomId: occ.roomId,
              occupancyId: occ.id,
              from: promo.startDate,
              to: promo.endDate,
              promotion: promo.name,
              discountPct: Number(promo.discountPct),
            },
          });
        }
      }
      return {
        promotion: promo.name,
        discountPct: Number(promo.discountPct),
        from: promo.startDate,
        to: promo.endDate,
        ratesUpdated: updated,
        occupancies: occIds.length,
      };
    });
  }

  // --- Coupons ---------------------------------------------------------------
  listCoupons(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(coupons).orderBy(desc(coupons.createdAt)),
    );
  }

  createCoupon(tenantId: string, dto: CreateCouponDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const code = dto.code.trim().toUpperCase();
      const [dupe] = await tx
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(coupons.code, code));
      if (dupe) throw new BadRequestException('A coupon with that code already exists');
      const [c] = await tx
        .insert(coupons)
        .values({
          tenantId,
          propertyId: dto.propertyId ?? null,
          code,
          type: dto.type,
          value: dto.value.toFixed(2),
          startDate: dto.from,
          endDate: dto.to,
          maxUses: dto.maxUses ?? 0,
        })
        .returning();
      return c;
    });
  }

  deleteCoupon(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const res = await tx.delete(coupons).where(eq(coupons.id, id)).returning({ id: coupons.id });
      if (!res.length) throw new NotFoundException('Coupon not found');
      return { deleted: true };
    });
  }

  // --- Referral partners -----------------------------------------------------
  listReferralPartners(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(referralPartners).orderBy(desc(referralPartners.createdAt)),
    );
  }

  createReferralPartner(tenantId: string, dto: CreateReferralPartnerDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const code = dto.code.trim().toUpperCase();
      const [dupe] = await tx
        .select({ id: referralPartners.id })
        .from(referralPartners)
        .where(eq(referralPartners.code, code));
      if (dupe) throw new BadRequestException('A referral partner with that code already exists');
      const [p] = await tx
        .insert(referralPartners)
        .values({ tenantId, name: dto.name, code, commissionPct: dto.commissionPct.toFixed(2) })
        .returning();
      return p;
    });
  }

  deleteReferralPartner(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const res = await tx
        .delete(referralPartners)
        .where(eq(referralPartners.id, id))
        .returning({ id: referralPartners.id });
      if (!res.length) throw new NotFoundException('Referral partner not found');
      return { deleted: true };
    });
  }

  /** Recorded referral commissions, joined to partner + booking, for the finance view. */
  listReferralCommissions(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: referralCommissions.id,
          amount: referralCommissions.amount,
          status: referralCommissions.status,
          createdAt: referralCommissions.createdAt,
          partnerName: referralPartners.name,
          bookingReference: bookings.reference,
        })
        .from(referralCommissions)
        .innerJoin(referralPartners, eq(referralPartners.id, referralCommissions.referralPartnerId))
        .innerJoin(bookings, eq(bookings.id, referralCommissions.bookingId))
        .orderBy(desc(referralCommissions.createdAt)),
    );
  }
}
