import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  bookings,
  bookingDays,
  bookingApprovals,
  bookingGuests,
  bookingRooms,
  customers,
  folioCharges,
  folios,
  guestDocuments,
  housekeepingAsOf,
  maintenanceBlocks,
  reclaimReleasedNights,
  roomUnits,
  properties,
  tenants,
  releaseStay,
  reserveStay,
  releaseBookingInventory,
  reserveBookingInventory,
  noShowReleaseFrom,
  InsufficientAvailabilityError,
  nextBookingReference,
  coupons,
  couponRedemptions,
  referralPartners,
  referralCommissions,
  notifications,
  payments,
  invoices,
  messages,
  templates,
  reviewInvites,
  enqueueOutbox,
  enqueueDepartureCleaning,
  type Tx,
} from '@yohobed/db';
import {
  couponDiscount,
  kindAfterApproval,
  referralCommission,
  renderTemplate,
  resolvePropertySettings,
  resolveReservationOptions,
  CURRENCY_META,
  isCurrencyCode,
  type ReservationKind,
} from '@yohobed/domain';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../billing/billing.service';
import { settleAtCheckout } from '../folio/settlement';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../email/mailer.service';
import {
  assignRoomsForCheckIn,
  createLegs,
  resizeLegs,
  restoreReleasedLegs,
  unassignLegs,
} from '../inventory/room-units.service';
import { eachNight } from '../common/dates';
import { localToday, propertyBusinessDate } from '../common/local-date';
import { resolveFxRateToLkr } from '../common/fx-rate';
import { ReservationPricer } from '../reservations/pricer';
import { policyForAmend, readPricingSnapshot } from '../reservations/pricing-snapshot';
import type { Env } from '../config/env';
import type { AmendBookingDto, CreateBookingDto } from './dto';

type Transition = 'approve' | 'reject' | 'cancel' | 'no_show' | 'check_in' | 'check_out';

/** Who is acting, and the deliberate overrides they chose (UX-1a). */
export interface TransitionContext {
  /** Every lifecycle action records who did it, and from where. */
  actorUserId?: string | null;
  ip?: string | null;
  /** The actor's role in the tenant; owner-only overrides check it. */
  role?: string;
  /** Check in to a room still marked dirty. Needs a reason. */
  overrideDirty?: boolean;
  /** Check out with the guest's balance unpaid. Owner only; needs a reason. */
  allowBalance?: boolean;
}

/** The calendar date an instant falls on in a timezone. */
function localDateOf(at: Date, timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'UTC' }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(at);
  }
}

@Injectable()
export class BookingService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly mailer: MailerService,
    private readonly config: ConfigService<Env, true>,
    private readonly pricer: ReservationPricer,
    private readonly billing: BillingService,
  ) {}

  list(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: bookings.id,
          reference: bookings.reference,
          status: bookings.status,
          reservationKind: bookings.reservationKind,
          source: bookings.source,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          nights: bookings.nights,
          rooms: bookings.rooms,
          amount: bookings.amount,
          currency: bookings.currency,
          roomId: bookings.roomId,
          customerName: customers.name,
          customerEmail: customers.email,
          customerPhone: customers.phone,
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

  async createWalkIn(tenantId: string, dto: CreateBookingDto) {
    const booking = await this.dbs.withTenant(tenantId, (tx) => this.create(tx, tenantId, dto));
    this.mailer.deliverQueuedSafe(tenantId); // after commit: send the queued confirmation
    return booking;
  }

  /**
   * Create a booking inside an existing tenant transaction. Walk-ins use the defaults; OTA
   * imports (Compartment F) pass source 'OTA' + autoApprove (the guest already paid the OTA).
   *
   * Priced by ReservationPricer on the legacy path — the same arithmetic this method did inline
   * before Development Phase 02, pinned by the golden test in reservation-create.e2e.
   */
  async create(
    tx: Tx,
    tenantId: string,
    dto: CreateBookingDto,
    opts: { source?: 'Extranet' | 'OTA'; autoApprove?: boolean; channelLabel?: string } = {},
  ) {
    const line = await this.pricer.priceLine(
      tx,
      {
        roomId: dto.roomId,
        occupancyId: dto.occupancyId,
        checkin: dto.checkin,
        checkout: dto.checkout,
        rooms: dto.rooms,
        checkRestrictions: true,
      },
      // Only a pricing policy reads the distribution mode; the calendar path never does.
      'yoho',
    );
    const nights = line.nights.map((n) => n.date);
    const { amount, commissionable } = line.raw;

    // Optional coupon (marketing discount off the amount) and referral (partner commission).
    // "Today" is the hotel's today: in UTC a Colombo booking made before 05:30 would be dated
    // yesterday, and a coupon ending yesterday would still be accepted.
    const bookingDate = localToday(line.timezone);
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
      if (c.propertyId && c.propertyId !== line.propertyId) {
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

    // Reserve inventory atomically (BUG #1) and tell the channel manager (same txn — BUG #3).
    try {
      await reserveStay(tx, dto.roomId, nights, dto.rooms);
    } catch (e) {
      if (e instanceof InsufficientAvailabilityError) {
        throw new ConflictException({ reason: 'insufficient_availability', date: e.date });
      }
      throw e;
    }
    await enqueueOutbox(tx, {
      tenantId,
      aggregate: 'availability',
      aggregateId: dto.roomId,
      eventType: 'ari.availability',
      payload: {
        propertyId: line.propertyId,
        roomId: dto.roomId,
        nights,
        rooms: dto.rooms,
        action: 'reserve',
        origin: 'booking',
      },
    });

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

    // Safe reference (BUG #4), dated by the property's calendar.
    const reference = await nextBookingReference(tx, bookingDate);

    // Denominate the booking in the property's base currency and freeze the LKR rate at creation
    // so the cross-property consolidated (LKR) view never drifts as live rates move.
    const currency = line.currency;
    const fxRateToLkr = await resolveFxRateToLkr(tx, currency);

    const [booking] = await tx
      .insert(bookings)
      .values({
        tenantId,
        propertyId: line.propertyId,
        roomId: dto.roomId,
        occupancyId: dto.occupancyId,
        customerId,
        reference,
        checkin: dto.checkin,
        checkout: dto.checkout,
        nights: nights.length,
        rooms: dto.rooms,
        status: opts.autoApprove ? 'Approved' : 'Pending',
        // A walk-in awaiting approval holds its rooms with no release time: an unconfirmed hold.
        reservationKind: opts.autoApprove ? 'confirm' : 'hold_unconfirm',
        source: opts.source ?? 'Extranet',
        origin: opts.source === 'OTA' ? 'ota' : 'direct',
        amount: line.amount,
        totalBasePrice: line.totalBase,
        taxes: line.taxes,
        commissionableAmount: line.commissionable,
        discount: discount.toFixed(2),
        currency,
        fxRateToLkr,
      })
      .returning();

    // One leg per physical room. Units are left unassigned: an OTA reservation has no opinion
    // about which room, and a walk-in is assigned at the desk. Auto-assign fills them on demand.
    await createLegs(tx, {
      tenantId,
      bookingId: booking!.id,
      rooms: dto.rooms,
      checkin: dto.checkin,
      checkout: dto.checkout,
      adults: line.accommodates ?? 1,
    });

    await tx.insert(bookingDays).values(
      line.nights.map((n) => ({
        tenantId,
        bookingId: booking!.id,
        date: n.date,
        basePrice: n.basePrice,
        sellingPrice: n.sellingPrice,
        commission: n.commission,
        tax: n.tax,
        listSellingPrice: n.listSellingPrice,
        rateSource: n.rateSource,
        taxLines: n.taxLines,
      })),
    );
    await tx
      .insert(bookingApprovals)
      .values({ tenantId, bookingId: booking!.id, action: 'created' });
    if (opts.autoApprove) {
      await tx.insert(bookingApprovals).values({
        tenantId,
        bookingId: booking!.id,
        action: 'approved',
        reason: opts.channelLabel
          ? `auto: confirmed by ${opts.channelLabel}`
          : 'auto: OTA confirmed',
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
      body: `${dto.customerName} · ${dto.checkin} → ${dto.checkout} · ${
        isCurrencyCode(currency) ? CURRENCY_META[currency].symbol : currency
      } ${line.amount}`,
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
        amount: line.amount,
        checkin: dto.checkin,
        checkout: dto.checkout,
        nights: nights.length,
      };
      // Queued in the same txn; the MailerService delivers it after commit (Compartment H).
      await tx.insert(messages).values({
        tenantId,
        bookingId: booking!.id,
        channel: 'email',
        toAddress: dto.customerEmail ?? '',
        templateKey: 'booking_created',
        language: 'en',
        subject: renderTemplate(tpl.subject, vars),
        body: renderTemplate(tpl.body, vars),
        status: 'queued',
      });
    }

    return booking;
  }

  approve(tenantId: string, id: string, ctx: TransitionContext = {}) {
    return this.transition(tenantId, id, 'approve', undefined, ctx);
  }
  reject(tenantId: string, id: string, reason?: string, ctx: TransitionContext = {}) {
    return this.transition(tenantId, id, 'reject', reason, ctx);
  }
  cancel(tenantId: string, id: string, reason?: string, ctx: TransitionContext = {}) {
    return this.transition(tenantId, id, 'cancel', reason, ctx);
  }
  noShow(tenantId: string, id: string, ctx: TransitionContext = {}) {
    return this.transition(tenantId, id, 'no_show', undefined, ctx);
  }
  checkIn(tenantId: string, id: string, reason?: string, ctx: TransitionContext = {}) {
    return this.transition(tenantId, id, 'check_in', reason, ctx);
  }
  async checkOut(tenantId: string, id: string, reason?: string, ctx: TransitionContext = {}) {
    const updated = await this.transition(tenantId, id, 'check_out', reason, ctx);
    this.mailer.deliverQueuedSafe(tenantId); // after commit: send the queued review invite
    return updated;
  }

  /**
   * Undo a check-in made by mistake (UX-1a) — the wrong booking, the wrong guest. Same day only,
   * and only before a night has been charged: after that the stay is real and the bill says so.
   */
  undoCheckIn(tenantId: string, id: string, reason: string, ctx: TransitionContext = {}) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      if (b.status !== 'CheckedIn') {
        throw new BadRequestException(`${b.reference} is not checked in`);
      }
      const property = await this.propertyOf(tx, b.propertyId);
      const today = localToday(property.timezone);
      if (!b.checkedInAt || localDateOf(b.checkedInAt, property.timezone) !== today) {
        throw new ConflictException({
          reason: 'too_late_to_undo',
          message: `A check-in can only be undone on the day it was made.`,
        });
      }
      const [posted] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(folioCharges)
        .innerJoin(folios, eq(folios.id, folioCharges.folioId))
        .where(
          and(
            eq(folios.bookingId, b.id),
            eq(folioCharges.source, 'room'),
            isNull(folioCharges.voidedAt),
            gte(folioCharges.createdAt, b.checkedInAt),
          ),
        );
      if ((posted?.n ?? 0) > 0) {
        throw new ConflictException({
          reason: 'charges_posted',
          message: `A night has already been charged to ${b.reference}. Void the room charge first.`,
        });
      }

      const [updated] = await tx
        .update(bookings)
        .set({ status: 'Approved', checkedInAt: null, updatedAt: new Date() })
        .where(eq(bookings.id, b.id))
        .returning();
      await this.record(tx, tenantId, b.id, 'check_in_undone', reason, ctx);
      return updated;
    });
  }

  /**
   * Undo a check-out made by mistake (UX-1a). Same day only, and not once the bill has moved to a
   * company's account — that reversal belongs on the city ledger, where it is visible. An early
   * check-out's released nights are taken back, if nobody has booked them since.
   */
  undoCheckOut(tenantId: string, id: string, reason: string, ctx: TransitionContext = {}) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      if (b.status !== 'CheckedOut') {
        throw new BadRequestException(`${b.reference} is not checked out`);
      }
      const property = await this.propertyOf(tx, b.propertyId);
      const today = localToday(property.timezone);
      if (!b.checkedOutAt || localDateOf(b.checkedOutAt, property.timezone) !== today) {
        throw new ConflictException({
          reason: 'too_late_to_undo',
          message: `A check-out can only be undone on the day it was made.`,
        });
      }
      const since = b.checkedOutAt;
      const [ledger] = await tx
        .select({
          n: sql<number>`(
            (select count(*) from payments p
              where p.booking_id = ${b.id} and p.ledger_account_id is not null
                and p.created_at >= ${since.toISOString()}::timestamptz)
            + (select count(*) from ledger_entries e
              where e.booking_id = ${b.id} and e.created_at >= ${since.toISOString()}::timestamptz)
          )::int`,
        })
        .from(bookings)
        .where(eq(bookings.id, b.id));
      if ((ledger?.n ?? 0) > 0) {
        throw new ConflictException({
          reason: 'settled_to_ledger',
          message: `${b.reference}'s bill was moved to a company or agent account at check-out. Reverse that on the city ledger first.`,
        });
      }

      await this.takeBackReleasedStay(tx, b, 'check_out_undone');
      const [updated] = await tx
        .update(bookings)
        .set({ status: 'CheckedIn', checkedOutAt: null, updatedAt: new Date() })
        .where(eq(bookings.id, b.id))
        .returning();
      await this.record(tx, tenantId, b.id, 'check_out_undone', reason, ctx);
      return updated;
    });
  }

  /**
   * Bring back a cancellation or a no-show (UX-1a) — the guest who arrives after the night audit
   * gave up on them, the booking cancelled against the wrong name. The rooms are taken again, so
   * this fails cleanly (409) if the nights have been sold since.
   */
  reinstate(tenantId: string, id: string, reason: string, ctx: TransitionContext = {}) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      const property = await this.propertyOf(tx, b.propertyId);
      const today = await this.operatingDate(tx, b.propertyId, property.timezone);
      if (b.checkout <= today) {
        throw new ConflictException({
          reason: 'stay_ended',
          message: `${b.reference}'s stay ended on ${b.checkout}; make a new reservation instead.`,
        });
      }
      if (b.status === 'Cancelled') {
        if (b.voidedAt) {
          throw new ConflictException({
            reason: 'voided',
            message: `${b.reference} was voided as a mistake; make a new reservation instead.`,
          });
        }
      } else if (b.status !== 'NoShow') {
        throw new BadRequestException('Only a cancelled or no-show booking can be reinstated');
      }

      const wasCancelled = b.status === 'Cancelled';
      const [updated] = await tx
        .update(bookings)
        .set({ status: 'Approved', updatedAt: new Date() })
        .where(eq(bookings.id, b.id))
        .returning();
      try {
        if (wasCancelled) {
          // Cancelling gave every night back and released the rooms; take both again.
          if (updated!.inventoryHeld) await reserveBookingInventory(tx, updated!, 'reinstated');
          await restoreReleasedLegs(tx, b.id);
        } else {
          // A no-show kept the night it missed; the rest went back on sale.
          await reclaimReleasedNights(tx, b, 'reinstated');
        }
      } catch (e) {
        if (e instanceof InsufficientAvailabilityError) {
          throw new ConflictException({
            reason: 'insufficient_availability',
            date: e.date,
            message: `The room type is sold out on ${e.date}, so ${b.reference} cannot come back as it was.`,
          });
        }
        throw e;
      }
      await this.record(tx, tenantId, b.id, 'reinstated', reason, ctx);
      const [fresh] = await tx.select().from(bookings).where(eq(bookings.id, b.id));
      return fresh;
    });
  }

  /**
   * Correct a reservation that should never have existed. This deliberately has a much narrower
   * gate than cancellation: once money or an issued fiscal document exists, the audit-safe
   * cancellation and credit flows must be used instead.
   */
  void(tenantId: string, id: string, actorUserId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
      if (!b) throw new NotFoundException('Booking not found');
      if (b.voidedAt) throw new ConflictException('This reservation is already voided');
      if (b.status !== 'Pending' && b.status !== 'Approved') {
        throw new ConflictException('Only a pre-arrival reservation can be voided');
      }

      const [money] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(payments)
        .where(eq(payments.bookingId, id));
      if ((money?.count ?? 0) > 0) {
        throw new ConflictException(
          'This reservation has a payment; cancel it and use the financial correction flow',
        );
      }

      const [document] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(invoices)
        .where(and(eq(invoices.bookingId, id), sql`${invoices.status} in ('issued', 'paid')`));
      if ((document?.count ?? 0) > 0) {
        throw new ConflictException(
          'This reservation has an issued invoice; cancel it and use a credit note',
        );
      }

      await this.giveRoomsBack(tx, b);
      const [updated] = await tx
        .update(bookings)
        .set({ status: 'Cancelled', voidedAt: new Date(), updatedAt: new Date() })
        .where(eq(bookings.id, id))
        .returning();
      await tx.insert(bookingApprovals).values({
        tenantId,
        bookingId: id,
        action: 'voided',
        reason: 'Owner correction: reservation voided before arrival',
        actorUserId,
      });
      return updated;
    });
  }

  private transition(
    tenantId: string,
    id: string,
    kind: Transition,
    reason?: string,
    ctx: TransitionContext = {},
  ) {
    return this.dbs.withTenant(tenantId, (tx) =>
      this.transitionWithin(tx, tenantId, id, kind, reason, ctx),
    );
  }

  /**
   * Move a booking through its lifecycle, inside the caller's transaction.
   *
   * The row is locked first: two desks cancelling the same booking at once must not both give its
   * rooms back. Inventory is only returned by a booking that holds it (`inventory_held`), so
   * cancelling an inquiry never releases rooms it never took.
   */
  async transitionWithin(
    tx: Tx,
    tenantId: string,
    id: string,
    kind: Transition,
    reason?: string,
    ctx: TransitionContext = {},
  ) {
    const b = await this.lockBooking(tx, id);

    let status: 'Approved' | 'Rejected' | 'Cancelled' | 'NoShow' | 'CheckedIn' | 'CheckedOut';
    let action: 'approved' | 'rejected' | 'cancelled' | 'no_show' | 'checked_in' | 'checked_out';
    const set: Partial<typeof bookings.$inferInsert> = { updatedAt: new Date() };

    if (kind === 'approve') {
      if (b.status !== 'Pending')
        throw new BadRequestException(`Cannot approve a ${b.status} booking`);
      status = 'Approved';
      action = 'approved';
      const next = kindAfterApproval(b.reservationKind as ReservationKind, b.holdUntil !== null);
      set.reservationKind = next;
      if (next === 'confirm') set.holdUntil = null;
      // An inquiry or a failed online booking took no rooms; approving it has to find some.
      if (!b.inventoryHeld) await this.takeRooms(tx, b);
    } else if (kind === 'reject') {
      if (b.status !== 'Pending')
        throw new BadRequestException(`Cannot reject a ${b.status} booking`);
      status = 'Rejected';
      action = 'rejected';
      await this.giveRoomsBack(tx, b);
    } else if (kind === 'cancel') {
      if (b.status !== 'Pending' && b.status !== 'Approved') {
        throw new BadRequestException(`Cannot cancel a ${b.status} booking`);
      }
      status = 'Cancelled';
      action = 'cancelled';
      await this.giveRoomsBack(tx, b);
    } else if (kind === 'no_show') {
      if (b.status !== 'Approved')
        throw new BadRequestException(`Cannot no-show a ${b.status} booking`);
      status = 'NoShow';
      action = 'no_show';
      await this.releaseNoShow(tx, tenantId, b);
    } else if (kind === 'check_in') {
      if (b.status === 'NoShow') {
        throw new ConflictException({
          reason: 'no_show',
          message: `${b.reference} was marked a no-show. Reinstate it first, then check the guest in.`,
        });
      }
      if (b.status !== 'Approved') {
        throw new BadRequestException(`Cannot check in a ${b.status} booking`);
      }
      await this.assertReadyForCheckIn(tx, b, reason, ctx);
      status = 'CheckedIn';
      action = 'checked_in';
      set.checkedInAt = new Date();
      // Checking a hold in confirms it: the guest is here, so there is nothing left to release.
      if (b.reservationKind === 'hold_confirm') {
        set.reservationKind = 'confirm';
        set.holdUntil = null;
      }
    } else {
      if (b.status !== 'CheckedIn') {
        throw new BadRequestException(`Cannot check out a ${b.status} booking`);
      }
      status = 'CheckedOut';
      action = 'checked_out';
      set.checkedOutAt = new Date();
    }

    const [updated] = await tx
      .update(bookings)
      .set({ ...set, status })
      .where(eq(bookings.id, id))
      .returning();
    await this.record(tx, tenantId, id, action, reason, ctx);

    // Check-out settles with the city ledger: a company's or travel agent's window moves to its
    // account and a travel agent's commission is accrued (Pro, Development Phase 02).
    if (kind === 'check_out') {
      const property = await this.propertyOf(tx, b.propertyId);
      await enqueueDepartureCleaning(
        tx,
        tenantId,
        b.propertyId,
        b.id,
        localToday(property.timezone),
      );

      // Leaving early gives the nights not stayed back for sale, and frees the room from tonight.
      // (What those nights cost is a price question: shorten the stay to re-price it.)
      const operating = await this.operatingDate(tx, b.propertyId, property.timezone);
      if (operating < b.checkout) {
        await releaseBookingInventory(tx, b, { from: operating, origin: 'early_checkout' });
      }

      const { features } = await this.billing.entitlements(tenantId, tx);
      if (features.cashiering)
        await settleAtCheckout(tx, tenantId, updated!, ctx.actorUserId ?? null);

      // A guest never leaves owing money by accident (UX-STANDARD §4). This runs AFTER the
      // city-ledger move, so what a company pays is not held against the guest; throwing here
      // rolls back the whole check-out, settlement included.
      const owed = await this.guestOwes(tx, b.id);
      if (owed > 0.004 && property.settings.checkoutBalancePolicy === 'block') {
        if (ctx.allowBalance && ctx.role !== 'OWNER') {
          throw new ForbiddenException(
            'Only the owner can check a guest out with a balance unpaid',
          );
        }
        if (!(ctx.allowBalance && reason?.trim())) {
          throw new ConflictException({
            reason: 'balance_open',
            balance: owed.toFixed(2),
            currency: b.currency,
            message: `${b.reference} still has ${b.currency} ${owed.toFixed(2)} to pay. Take the payment or move it to the city ledger; the owner can check out anyway with a reason.`,
          });
        }
      }
    }

    // Check-out opens the review window: mint a single-use invite + queue the guest email
    // (Compartment I). The invite row has no RLS — its unguessable token IS the authorization.
    if (kind === 'check_out') {
      await this.queueReviewInvite(tx, tenantId, b);
      await this.queueCheckoutEmail(tx, tenantId, b);
    }
    return updated;
  }

  private async lockBooking(tx: Tx, id: string) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  private async propertyOf(tx: Tx, propertyId: string) {
    const [p] = await tx
      .select({ timezone: properties.timezone, settings: properties.settings })
      .from(properties)
      .where(eq(properties.id, propertyId));
    return { timezone: p?.timezone ?? null, settings: resolvePropertySettings(p?.settings) };
  }

  /**
   * The day the front desk is working (UX-1a): the later of the night-audit business date and the
   * calendar today. A business date ahead of the calendar (the audit already closed tonight)
   * lets tomorrow's arrivals in; a stale one (the audit not run for days) must not lock today's
   * real arrivals out.
   */
  private async operatingDate(tx: Tx, propertyId: string, timezone: string | null) {
    const calendar = localToday(timezone);
    const { date } = await propertyBusinessDate(tx, propertyId, timezone);
    return date > calendar ? date : calendar;
  }

  /** Every lifecycle action on the record: what, why, who, and from where (UX-1a). */
  private async record(
    tx: Tx,
    tenantId: string,
    bookingId: string,
    action: (typeof bookingApprovals.$inferInsert)['action'],
    reason: string | undefined,
    ctx: TransitionContext,
  ) {
    await tx.insert(bookingApprovals).values({
      tenantId,
      bookingId,
      action,
      reason: reason?.trim() || null,
      actorUserId: ctx.actorUserId ?? null,
      ip: ctx.ip ?? null,
    });
  }

  /**
   * What must be true before a guest gets a key (UX-STANDARD §4). Each refusal says what to do
   * about it, because the person reading it has a guest standing in front of them.
   */
  private async assertReadyForCheckIn(
    tx: Tx,
    b: typeof bookings.$inferSelect,
    reason: string | undefined,
    ctx: TransitionContext,
  ) {
    const property = await this.propertyOf(tx, b.propertyId);
    const today = await this.operatingDate(tx, b.propertyId, property.timezone);

    // Checking in a future booking would put a guest in a room whose tonight is not held — the
    // road to an overbooking. An early guest's stay has to start today first.
    if (b.checkin > today) {
      throw new ConflictException({
        reason: 'not_arrival_day',
        checkin: b.checkin,
        message: `${b.reference} arrives on ${b.checkin}. To check the guest in today, change the stay to start today first.`,
      });
    }
    // A stay whose dates are already past may still be checked in: that is the desk recording a
    // stay after the fact, and it holds no inventory anyone else could want. Night audit lists it
    // as an overstay if it is left in house.

    const missing = await assignRoomsForCheckIn(tx, b, today);
    if (missing > 0) {
      throw new ConflictException({
        reason: 'room_not_assigned',
        message:
          missing === 1
            ? 'There is no free room of this type for the stay. Move another stay or assign a room by hand.'
            : `There are no free rooms of this type for ${missing} of the rooms. Move other stays or assign rooms by hand.`,
      });
    }

    const legs = await tx
      .select({ unitId: roomUnits.id, code: roomUnits.code })
      .from(bookingRooms)
      .innerJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
      .where(
        and(
          eq(bookingRooms.bookingId, b.id),
          isNull(bookingRooms.releasedAt),
          lte(bookingRooms.checkin, today),
          gt(bookingRooms.checkout, today),
        ),
      );
    const [blocked] = await tx
      .select({ code: roomUnits.code, reason: maintenanceBlocks.reason })
      .from(maintenanceBlocks)
      .innerJoin(roomUnits, eq(roomUnits.id, maintenanceBlocks.roomUnitId))
      .where(
        and(
          inArray(
            maintenanceBlocks.roomUnitId,
            legs.map((l) => l.unitId),
          ),
          isNull(maintenanceBlocks.releasedAt),
          lte(maintenanceBlocks.blockFrom, today),
          gt(maintenanceBlocks.blockTo, today),
        ),
      )
      .limit(1);
    if (blocked) {
      throw new ConflictException({
        reason: 'room_blocked',
        rooms: [blocked.code],
        message: `Room ${blocked.code} is blocked (${blocked.reason}). Move the guest to another room first.`,
      });
    }

    const asOf = await housekeepingAsOf(tx, b.propertyId, today);
    const outOfOrder = legs.filter((l) => asOf.get(l.unitId)?.status === 'out_of_order');
    if (outOfOrder.length) {
      const codes = outOfOrder.map((l) => l.code).join(', ');
      throw new ConflictException({
        reason: 'room_out_of_order',
        rooms: outOfOrder.map((l) => l.code),
        message: `Room ${codes} is out of order. Move the guest to another room first.`,
      });
    }
    const dirty = legs.filter((l) => asOf.get(l.unitId)?.status === 'dirty');
    if (dirty.length && !(ctx.overrideDirty && reason?.trim())) {
      const codes = dirty.map((l) => l.code).join(', ');
      throw new ConflictException({
        reason: 'room_dirty',
        rooms: dirty.map((l) => l.code),
        message: `Room ${codes} is not clean yet. Choose a clean room, have it cleaned, or check in anyway with a reason.`,
      });
    }

    // The setting existed before it was enforced; now it means what it says.
    if (property.settings.requireDocumentsAtCheckin) {
      const [doc] = await tx
        .select({ id: guestDocuments.id })
        .from(guestDocuments)
        .where(
          or(
            eq(guestDocuments.customerId, b.customerId),
            inArray(
              guestDocuments.customerId,
              tx
                .select({ id: bookingGuests.customerId })
                .from(bookingGuests)
                .where(eq(bookingGuests.bookingId, b.id)),
            ),
          ),
        )
        .limit(1);
      if (!doc) {
        throw new ConflictException({
          reason: 'documents_required',
          message: `This hotel records the guest's ID before check-in. Add the ID document to ${b.reference}, then check in.`,
        });
      }
    }
  }

  /**
   * What the GUEST still owes — the same Total − Paid the reservations list shows the desk: the
   * room at its sold price, plus extras on the bill, less everything paid (a city-ledger charge
   * counts as paid). When window 1 is billed to a company, room nights not yet posted are the
   * company's to pay, not the guest's.
   *
   * The correlations are written out in full (`= bookings.id`): in a single-table select Drizzle
   * would emit a bare "id" that Postgres resolves against the inner table.
   */
  private async guestOwes(tx: Tx, bookingId: string): Promise<number> {
    const [r] = await tx
      .select({
        amount: bookings.amount,
        discount: bookings.discount,
        extras: sql<string>`coalesce((
          select sum(fc.total) from folio_charges fc join folios f on f.id = fc.folio_id
          where f.booking_id = bookings.id and fc.voided_at is null and fc.source <> 'room'
        ), 0)::text`,
        postedRoom: sql<string>`coalesce((
          select sum(fc.total) from folio_charges fc join folios f on f.id = fc.folio_id
          where f.booking_id = bookings.id and fc.voided_at is null and fc.source = 'room'
        ), 0)::text`,
        paid: sql<string>`coalesce((
          select sum(case when p.direction = 'received' then p.amount else -p.amount end)
          from payments p where p.booking_id = bookings.id
        ), 0)::text`,
        companyPaysRoom: sql<boolean>`exists (
          select 1 from folios f
          where f.booking_id = bookings.id and f.window = 1 and f.payer_ledger_account_id is not null
        )`,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!r) return 0;
    const total = Number(r.amount) - Number(r.discount) + Number(r.extras);
    const companyShare = r.companyPaysRoom
      ? Math.max(0, Number(r.amount) - Number(r.postedRoom))
      : 0;
    return Number((total - Number(r.paid) - companyShare).toFixed(2));
  }

  /**
   * Take back what an early check-out released: the unstayed nights (and the legs over them), or —
   * for a guest who checked out on the day they arrived — the whole stay. 409 if resold since.
   */
  private async takeBackReleasedStay(tx: Tx, b: typeof bookings.$inferSelect, origin: string) {
    try {
      if (b.inventoryReleasedFrom) {
        await reclaimReleasedNights(tx, b, origin);
        return;
      }
      const [live] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(bookingRooms)
        .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
      if ((live?.n ?? 0) === 0) {
        await reserveBookingInventory(tx, b, origin);
        await restoreReleasedLegs(tx, b.id);
      }
    } catch (e) {
      if (e instanceof InsufficientAvailabilityError) {
        throw new ConflictException({
          reason: 'insufficient_availability',
          date: e.date,
          message: `The room type has been sold on ${e.date} since, so ${b.reference} cannot come back as it was.`,
        });
      }
      throw e;
    }
  }

  /** Take rooms for a booking that holds none yet; a full night becomes a 409. */
  private async takeRooms(tx: Tx, b: typeof bookings.$inferSelect) {
    try {
      await reserveBookingInventory(tx, b, 'confirm');
    } catch (e) {
      if (e instanceof InsufficientAvailabilityError) {
        throw new ConflictException({ reason: 'insufficient_availability', date: e.date });
      }
      throw e;
    }
  }

  /**
   * Give a booking's rooms back when it ends before arrival. A booking that held nothing (an
   * inquiry) only has its legs closed.
   */
  private async giveRoomsBack(tx: Tx, b: typeof bookings.$inferSelect) {
    if (b.inventoryHeld) {
      await releaseBookingInventory(tx, b, { origin: 'booking' });
      return;
    }
    await tx
      .update(bookingRooms)
      .set({ releasedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
  }

  /**
   * A no-show keeps the night it failed to arrive for — the tape chart shows it, and the hotel
   * may charge it — and gives the rest of the stay back for resale. An OTA booking also tells the
   * channel, so the guest's OTA record is marked too.
   */
  async releaseNoShow(
    tx: Tx,
    tenantId: string,
    b: typeof bookings.$inferSelect,
    markedOn?: string,
  ) {
    let date = markedOn;
    if (!date) {
      const [p] = await tx
        .select({ timezone: properties.timezone })
        .from(properties)
        .where(eq(properties.id, b.propertyId));
      date = (await propertyBusinessDate(tx, b.propertyId, p?.timezone)).date;
    }
    const from = noShowReleaseFrom(b.checkin, b.checkout, date);
    if (from) await releaseBookingInventory(tx, b, { from, origin: 'no_show' });
    if (b.source === 'OTA') {
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'booking',
        aggregateId: b.id,
        eventType: 'booking.no_show',
        payload: { propertyId: b.propertyId, bookingId: b.id, reference: b.reference },
      });
    }
  }

  /**
   * "Send email at check-out" (Development Phase 02): a thank-you from the reservation's chosen
   * template, or the starter one, to the guest.
   */
  private async queueCheckoutEmail(tx: Tx, tenantId: string, b: typeof bookings.$inferSelect) {
    const options = resolveReservationOptions(b.options);
    if (!options.sendCheckoutEmail) return;
    const [cust] = await tx.select().from(customers).where(eq(customers.id, b.customerId));
    if (!cust?.email) return;
    const key = options.checkoutTemplate ?? 'checkout_thank_you';
    const [tpl] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.key, key), eq(templates.language, 'en')));
    if (!tpl) return;
    const [prop] = await tx
      .select({ name: properties.name })
      .from(properties)
      .where(eq(properties.id, b.propertyId));
    const vars = {
      guestName: cust.name,
      propertyName: prop?.name ?? '',
      reference: b.reference,
      checkin: b.checkin,
      checkout: b.checkout,
    };
    await tx.insert(messages).values({
      tenantId,
      bookingId: b.id,
      channel: 'email',
      toAddress: cust.email,
      templateKey: key,
      language: 'en',
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      status: 'queued',
    });
  }

  private async queueReviewInvite(tx: Tx, tenantId: string, b: typeof bookings.$inferSelect) {
    const [cust] = await tx.select().from(customers).where(eq(customers.id, b.customerId));
    const [prop] = await tx
      .select({ name: properties.name })
      .from(properties)
      .where(eq(properties.id, b.propertyId));
    const [invite] = await tx
      .insert(reviewInvites)
      .values({
        tenantId,
        propertyId: b.propertyId,
        bookingId: b.id,
        guestName: cust?.name ?? 'Guest',
        propertyName: prop?.name ?? 'your property',
        checkin: b.checkin,
        checkout: b.checkout,
      })
      .onConflictDoNothing({ target: reviewInvites.bookingId })
      .returning();
    if (!invite || !cust?.email) return;
    const [tpl] = await tx
      .select()
      .from(templates)
      .where(and(eq(templates.key, 'review_invite'), eq(templates.language, 'en')));
    if (!tpl) return;
    const vars = {
      guestName: invite.guestName,
      propertyName: invite.propertyName,
      reference: b.reference,
      checkin: b.checkin,
      checkout: b.checkout,
      link: `${this.config.get('WEB_URL', { infer: true })}/review/${invite.token}`,
    };
    await tx.insert(messages).values({
      tenantId,
      bookingId: b.id,
      channel: 'email',
      toAddress: cust.email,
      templateKey: 'review_invite',
      language: 'en',
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      status: 'queued',
    });
  }

  /**
   * Amend a booking (Compartment G). Guest details can change in any live status; the stay
   * (dates / number of rooms) can only change while Pending or Approved — inventory is swapped
   * atomically (release old, reserve new) and prices are re-snapshotted from the rate calendar
   * on the SAME occupancy key. Any coupon discount granted at creation is kept as-is.
   *
   * Development Phase 02: the stay is re-priced under the terms it was sold on (`bookings.pricing`
   * — a typed rate, a contract, a complimentary room, a tax exemption), and a booking that holds
   * no rooms (an inquiry) is re-priced without touching inventory.
   */
  amend(tenantId: string, id: string, dto: AmendBookingDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
      if (!b) throw new NotFoundException('Booking not found');
      if (b.status === 'Rejected' || b.status === 'Cancelled' || b.status === 'NoShow') {
        throw new BadRequestException(`Cannot amend a ${b.status} booking`);
      }

      const changes: string[] = [];

      // Guest details live on the customer record (legacy `save-email`, generalized).
      if (dto.customerName || dto.customerEmail !== undefined || dto.customerPhone !== undefined) {
        const patch: Record<string, unknown> = { updatedAt: new Date() };
        if (dto.customerName) patch.name = dto.customerName;
        if (dto.customerEmail !== undefined) patch.email = dto.customerEmail || null;
        if (dto.customerPhone !== undefined) patch.phone = dto.customerPhone || null;
        await tx.update(customers).set(patch).where(eq(customers.id, b.customerId));
        changes.push('guest details');
      }

      const newCheckin = dto.checkin ?? b.checkin;
      const newCheckout = dto.checkout ?? b.checkout;
      const newRooms = dto.rooms ?? b.rooms;
      const stayChanged =
        newCheckin !== b.checkin || newCheckout !== b.checkout || newRooms !== b.rooms;

      if (stayChanged) {
        if (b.status !== 'Pending' && b.status !== 'Approved') {
          throw new BadRequestException(`Cannot change the stay of a ${b.status} booking`);
        }
        if (newCheckout <= newCheckin)
          throw new BadRequestException('checkout must be after checkin');

        const oldNights = eachNight(b.checkin, b.checkout);
        const newNights = eachNight(newCheckin, newCheckout);

        // Re-price the new stay on the SAME occupancy key (BUG #2 discipline), under the same
        // terms it was sold on.
        const snapshot = readPricingSnapshot(b.pricing);
        const currentDays = await tx
          .select({ sellingPrice: bookingDays.sellingPrice })
          .from(bookingDays)
          .where(eq(bookingDays.bookingId, id));
        const [tenant] = await tx
          .select({ mode: tenants.distributionMode })
          .from(tenants)
          .where(eq(tenants.id, tenantId));
        const line = await this.pricer.priceLine(
          tx,
          {
            roomId: b.roomId,
            occupancyId: b.occupancyId,
            checkin: newCheckin,
            checkout: newCheckout,
            rooms: newRooms,
            policy: policyForAmend(
              snapshot,
              currentDays.map((d) => Number(d.sellingPrice)),
            ),
            unpricedMessage: 'Prices are not set for all nights of the new stay',
          },
          tenant?.mode ?? 'yoho',
        );
        const nightSelling = new Map(line.nights.map((n) => [n.date, Number(n.sellingPrice)]));
        const nightTax = new Map(line.nights.map((n) => [n.date, Number(n.tax)]));

        if (b.inventoryHeld) {
          // Swap inventory atomically: release the old stay, reserve the new one. On insufficient
          // availability the whole transaction rolls back, so the release is undone too.
          await releaseStay(tx, b.roomId, oldNights, b.rooms);
          try {
            await reserveStay(tx, b.roomId, newNights, newRooms);
          } catch (e) {
            if (e instanceof InsufficientAvailabilityError) {
              throw new ConflictException({ reason: 'insufficient_availability', date: e.date });
            }
            throw e;
          }
        }

        // Stretch the legs to the new dates. If the room the guest was in is not free for the
        // new range, the exclusion constraint rejects it — so rather than fail the amendment,
        // unassign first and let the desk (or auto-assign) place them again.
        await unassignLegs(tx, b.id);
        await resizeLegs(tx, {
          tenantId,
          bookingId: b.id,
          rooms: newRooms,
          checkin: newCheckin,
          checkout: newCheckout,
        });

        if (b.inventoryHeld) {
          await enqueueOutbox(tx, {
            tenantId,
            aggregate: 'availability',
            aggregateId: b.roomId,
            eventType: 'ari.availability',
            payload: {
              propertyId: b.propertyId,
              roomId: b.roomId,
              action: 'amend',
              origin: 'booking',
              // Every date the amend touched (old ∪ new) — an amend moves inventory on both the
              // freed and the newly-taken nights, and the channel must re-sync all of them.
              nights: [...new Set([...oldNights, ...newNights])].sort(),
              released: { nights: oldNights, rooms: b.rooms },
              reserved: { nights: newNights, rooms: newRooms },
            },
          });
        }

        // Fresh day-wise snapshot for the new stay.
        await tx.delete(bookingDays).where(eq(bookingDays.bookingId, id));
        await tx.insert(bookingDays).values(
          line.nights.map((n) => ({
            tenantId,
            bookingId: id,
            date: n.date,
            basePrice: n.basePrice,
            sellingPrice: n.sellingPrice,
            commission: n.commission,
            tax: n.tax,
            listSellingPrice: n.listSellingPrice,
            rateSource: n.rateSource,
            taxLines: n.taxLines,
          })),
        );

        await tx
          .update(bookings)
          .set({
            checkin: newCheckin,
            checkout: newCheckout,
            nights: newNights.length,
            rooms: newRooms,
            amount: line.amount,
            totalBasePrice: line.totalBase,
            taxes: line.taxes,
            commissionableAmount: line.commissionable,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, id));

        // Reconcile any room charges the night audit already posted. An Approved booking can
        // carry posted nights, and leaving them untouched breaks the load-bearing invariant that
        // the folio's room lines sum to `bookings.amount`: a removed night stays billed, a
        // re-priced night keeps its old price. Removed nights are voided; re-priced nights are
        // voided and re-posted at the new price on the same window.
        const liveRoomCharges = await tx
          .select({
            id: folioCharges.id,
            folioId: folioCharges.folioId,
            bookingDate: folioCharges.bookingDate,
            total: folioCharges.total,
          })
          .from(folioCharges)
          .innerJoin(folios, eq(folios.id, folioCharges.folioId))
          .where(
            and(
              eq(folios.bookingId, id),
              eq(folioCharges.source, 'room'),
              isNull(folioCharges.voidedAt),
            ),
          );
        for (const c of liveRoomCharges) {
          const d = c.bookingDate!;
          const stillInStay = nightSelling.has(d);
          const newTotal = stillInStay ? Number((nightSelling.get(d)! * newRooms).toFixed(2)) : 0;
          if (stillInStay && Number(c.total) === newTotal) continue;
          await tx
            .update(folioCharges)
            .set({ voidedAt: new Date(), voidReason: 'stay amended', updatedAt: new Date() })
            .where(eq(folioCharges.id, c.id));
          if (stillInStay) {
            const t = Number((nightTax.get(d)! * newRooms).toFixed(2));
            await tx.insert(folioCharges).values({
              tenantId,
              folioId: c.folioId,
              source: 'room',
              description:
                newRooms > 1 ? `Room charge — ${d} (${newRooms} rooms)` : `Room charge — ${d}`,
              postedFor: d,
              bookingDate: d,
              quantity: newRooms.toFixed(2),
              unitPrice: nightSelling.get(d)!.toFixed(2),
              net: (newTotal - t).toFixed(2),
              tax: t.toFixed(2),
              total: newTotal.toFixed(2),
            });
          }
        }

        changes.push(
          `stay ${b.checkin}→${b.checkout} ×${b.rooms} to ${newCheckin}→${newCheckout} ×${newRooms}`,
        );
      }

      if (changes.length === 0) throw new BadRequestException('Nothing to amend');
      await tx.insert(bookingApprovals).values({
        tenantId,
        bookingId: id,
        action: 'amended',
        reason: changes.join('; '),
      });

      const [updated] = await tx.select().from(bookings).where(eq(bookings.id, id));
      return updated;
    });
  }
}
