import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bookings,
  bookingDays,
  bookingApprovals,
  customers,
  occupancies,
  ratePlans,
  rooms,
  rateCalendar,
  reserveStay,
  releaseStay,
  InsufficientAvailabilityError,
  nextBookingReference,
  resolveTaxRatesForDates,
  coupons,
  couponRedemptions,
  referralPartners,
  referralCommissions,
  notifications,
  messages,
  templates,
  type Tx,
} from '@yohobed/db';
import {
  taxFromSelling,
  applyLastMinuteDrop,
  couponDiscount,
  referralCommission,
  renderTemplate,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { eachNight } from '../common/dates';
import type { CreateBookingDto } from './dto';

type Transition = 'approve' | 'reject' | 'cancel' | 'no_show';

@Injectable()
export class BookingService {
  constructor(private readonly dbs: DatabaseService) {}

  list(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: bookings.id,
          reference: bookings.reference,
          status: bookings.status,
          source: bookings.source,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          nights: bookings.nights,
          rooms: bookings.rooms,
          amount: bookings.amount,
          roomId: bookings.roomId,
          customerName: customers.name,
        })
        .from(bookings)
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .orderBy(desc(bookings.createdAt)),
    );
  }

  get(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id));
      if (!booking) throw new NotFoundException('Booking not found');
      const days = await tx
        .select()
        .from(bookingDays)
        .where(eq(bookingDays.bookingId, id))
        .orderBy(bookingDays.date);
      const trail = await tx
        .select()
        .from(bookingApprovals)
        .where(eq(bookingApprovals.bookingId, id))
        .orderBy(bookingApprovals.createdAt);
      return { ...booking, days, trail };
    });
  }

  createWalkIn(tenantId: string, dto: CreateBookingDto) {
    return this.dbs.withTenant(tenantId, (tx) => this.create(tx, tenantId, dto));
  }

  /**
   * Create a booking inside an existing tenant transaction. Walk-ins use the defaults; OTA
   * imports (Compartment F) pass source 'OTA' + autoApprove (the guest already paid the OTA).
   */
  async create(
    tx: Tx,
    tenantId: string,
    dto: CreateBookingDto,
    opts: { source?: 'Extranet' | 'OTA'; autoApprove?: boolean; channelLabel?: string } = {},
  ) {
    // BUG #2: price on the EXPLICIT occupancy key, and verify it belongs to the room.
    const [occ] = await tx
      .select({ propertyId: rooms.propertyId, roomId: ratePlans.roomId })
      .from(occupancies)
      .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
      .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
      .where(eq(occupancies.id, dto.occupancyId));
    if (!occ) throw new NotFoundException('Occupancy not found');
    if (occ.roomId !== dto.roomId) {
      throw new BadRequestException('Occupancy does not belong to this room');
    }

    const nights = eachNight(dto.checkin, dto.checkout);

    // Price snapshot for the correct occupancy.
    const priceRows = await tx
      .select()
      .from(rateCalendar)
      .where(and(eq(rateCalendar.occupancyId, dto.occupancyId), inArray(rateCalendar.date, nights)));
    if (priceRows.length !== nights.length) {
      throw new BadRequestException('Prices are not set for all nights of this stay');
    }
    const byDate = new Map(priceRows.map((r) => [r.date, r]));

    // Charge the effective price (after any last-minute drop) and decompose tax out of it, for
    // settlement + parity. Untaxed properties resolve to zero rates, so taxes = 0.
    const taxByDate = await resolveTaxRatesForDates(tx, occ.propertyId, nights);
    const nightSelling = new Map<string, number>();
    const nightTax = new Map<string, number>();
    let amount = 0;
    let totalBase = 0;
    let taxes = 0;
    for (const d of nights) {
      const p = byDate.get(d)!;
      const selling = applyLastMinuteDrop(Number(p.sellingPrice), Number(p.lastMinuteDropPct));
      const t = taxFromSelling(selling, taxByDate.get(d)!);
      nightSelling.set(d, selling);
      nightTax.set(d, t);
      amount += selling * dto.rooms;
      totalBase += Number(p.basePrice) * dto.rooms;
      taxes += t * dto.rooms;
    }
    const commissionable = amount - taxes;

    // Optional coupon (marketing discount off the amount) and referral (partner commission).
    const bookingDate = new Date().toISOString().slice(0, 10);
    let discount = 0;
    let couponId: string | null = null;
    if (dto.couponCode) {
      const code = dto.couponCode.trim().toUpperCase();
      const [c] = await tx.select().from(coupons).where(eq(coupons.code, code));
      if (!c || !c.active) throw new BadRequestException('Invalid coupon code');
      if (bookingDate < c.startDate || bookingDate > c.endDate) {
        throw new BadRequestException('Coupon is not valid today');
      }
      if (c.maxUses > 0 && c.usedCount >= c.maxUses) {
        throw new BadRequestException('Coupon usage limit reached');
      }
      if (c.propertyId && c.propertyId !== occ.propertyId) {
        throw new BadRequestException('Coupon is not valid for this property');
      }
      discount = couponDiscount(amount, c.type, Number(c.value));
      couponId = c.id;
    }
    let referralPartnerId: string | null = null;
    let referralPct = 0;
    if (dto.referralCode) {
      const code = dto.referralCode.trim().toUpperCase();
      const [p] = await tx.select().from(referralPartners).where(eq(referralPartners.code, code));
      if (!p || !p.active) throw new BadRequestException('Invalid referral code');
      referralPartnerId = p.id;
      referralPct = Number(p.commissionPct);
    }

    // Reserve inventory atomically (BUG #1).
    try {
      await reserveStay(tx, dto.roomId, nights, dto.rooms);
    } catch (e) {
      if (e instanceof InsufficientAvailabilityError) {
        throw new ConflictException({ reason: 'insufficient_availability', date: e.date });
      }
      throw e;
    }

    // Customer (reuse by email, else create).
    let customerId: string | undefined;
    if (dto.customerEmail) {
      const [c] = await tx.select().from(customers).where(eq(customers.email, dto.customerEmail));
      customerId = c?.id;
    }
    if (!customerId) {
      const [c] = await tx
        .insert(customers)
        .values({
          tenantId,
          name: dto.customerName,
          email: dto.customerEmail ?? null,
          phone: dto.customerPhone ?? null,
        })
        .returning();
      customerId = c!.id;
    }

    // Safe reference (BUG #4).
    const today = new Date().toISOString().slice(0, 10);
    const reference = await nextBookingReference(tx, today);

    const [booking] = await tx
      .insert(bookings)
      .values({
        tenantId,
        propertyId: occ.propertyId,
        roomId: dto.roomId,
        occupancyId: dto.occupancyId,
        customerId,
        reference,
        checkin: dto.checkin,
        checkout: dto.checkout,
        nights: nights.length,
        rooms: dto.rooms,
        status: opts.autoApprove ? 'Approved' : 'Pending',
        source: opts.source ?? 'Extranet',
        amount: amount.toFixed(2),
        totalBasePrice: totalBase.toFixed(2),
        taxes: taxes.toFixed(2),
        commissionableAmount: commissionable.toFixed(2),
        discount: discount.toFixed(2),
      })
      .returning();

    await tx.insert(bookingDays).values(
      nights.map((d) => {
        const p = byDate.get(d)!;
        return {
          tenantId,
          bookingId: booking!.id,
          date: d,
          basePrice: p.basePrice,
          sellingPrice: (nightSelling.get(d) ?? Number(p.sellingPrice)).toFixed(2),
          commission: p.commission,
          tax: (nightTax.get(d) ?? 0).toFixed(2),
        };
      }),
    );
    await tx.insert(bookingApprovals).values({ tenantId, bookingId: booking!.id, action: 'created' });
    if (opts.autoApprove) {
      await tx.insert(bookingApprovals).values({
        tenantId,
        bookingId: booking!.id,
        action: 'approved',
        reason: opts.channelLabel ? `auto: confirmed by ${opts.channelLabel}` : 'auto: OTA confirmed',
      });
    }

    // Record the coupon redemption + referral commission (Compartment D).
    if (couponId) {
      await tx.insert(couponRedemptions).values({
        tenantId,
        couponId,
        bookingId: booking!.id,
        amount: discount.toFixed(2),
      });
      await tx
        .update(coupons)
        .set({ usedCount: sql`${coupons.usedCount} + 1` })
        .where(eq(coupons.id, couponId));
    }
    if (referralPartnerId) {
      await tx.insert(referralCommissions).values({
        tenantId,
        referralPartnerId,
        bookingId: booking!.id,
        amount: referralCommission(commissionable, referralPct).toFixed(2),
      });
    }

    // Notify the property + queue a guest confirmation from the template (Compartment E).
    await tx.insert(notifications).values({
      tenantId,
      type: opts.source === 'OTA' ? 'ota_booking' : 'booking_created',
      title:
        opts.source === 'OTA'
          ? `New OTA booking ${reference} via ${opts.channelLabel ?? 'channel manager'}`
          : `New booking ${reference}`,
      body: `${dto.customerName} · ${dto.checkin} → ${dto.checkout} · Rs ${amount.toFixed(2)}`,
      entity: 'booking',
      entityId: booking!.id,
    });
    const [tpl] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.key, 'booking_created'), eq(templates.language, 'en')));
    if (tpl) {
      const vars = {
        guestName: dto.customerName,
        reference,
        amount: amount.toFixed(2),
        checkin: dto.checkin,
        checkout: dto.checkout,
        nights: nights.length,
      };
      await tx.insert(messages).values({
        tenantId,
        bookingId: booking!.id,
        channel: 'email',
        toAddress: dto.customerEmail ?? '',
        templateKey: 'booking_created',
        language: 'en',
        subject: renderTemplate(tpl.subject, vars),
        body: renderTemplate(tpl.body, vars),
        status: 'sent',
        sentAt: new Date(),
      });
    }

    return booking;
  }

  approve(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'approve');
  }
  reject(tenantId: string, id: string, reason?: string) {
    return this.transition(tenantId, id, 'reject', reason);
  }
  cancel(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'cancel');
  }
  noShow(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'no_show');
  }

  private transition(tenantId: string, id: string, kind: Transition, reason?: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, id));
      if (!b) throw new NotFoundException('Booking not found');
      const nights = eachNight(b.checkin, b.checkout);

      let status: 'Approved' | 'Rejected' | 'Cancelled' | 'NoShow';
      let action: 'approved' | 'rejected' | 'cancelled' | 'no_show';

      if (kind === 'approve') {
        if (b.status !== 'Pending') throw new BadRequestException(`Cannot approve a ${b.status} booking`);
        status = 'Approved';
        action = 'approved';
      } else if (kind === 'reject') {
        if (b.status !== 'Pending') throw new BadRequestException(`Cannot reject a ${b.status} booking`);
        status = 'Rejected';
        action = 'rejected';
        await releaseStay(tx, b.roomId, nights, b.rooms);
      } else if (kind === 'cancel') {
        if (b.status !== 'Pending' && b.status !== 'Approved') {
          throw new BadRequestException(`Cannot cancel a ${b.status} booking`);
        }
        status = 'Cancelled';
        action = 'cancelled';
        await releaseStay(tx, b.roomId, nights, b.rooms);
      } else {
        if (b.status !== 'Approved') throw new BadRequestException(`Cannot no-show a ${b.status} booking`);
        status = 'NoShow';
        action = 'no_show';
      }

      const [updated] = await tx
        .update(bookings)
        .set({ status, updatedAt: new Date() })
        .where(eq(bookings.id, id))
        .returning();
      await tx.insert(bookingApprovals).values({ tenantId, bookingId: id, action, reason: reason ?? null });
      return updated;
    });
  }
}
