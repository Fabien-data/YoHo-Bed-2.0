import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  bookings,
  bookingDays,
  bookingApprovals,
  bookingGuests,
  bookingRooms,
  bookingGroups,
  customers,
  folioCharges,
  folios,
  guestDocuments,
  housekeepingAsOf,
  maintenanceBlocks,
  reclaimReleasedNights,
  roomUnits,
  properties,
  roomMoves,
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
import { addDaysIso } from '@yohobed/locale';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../billing/billing.service';
import { StepUpService } from '../auth/step-up.service';
import { settleAtCheckout } from '../folio/settlement';
import { reconcileLevies, voidAllLevies } from '../folio/levies';
import { runBulk, type BulkResult } from './bulk';
import { assertRegistered } from '../compliance/compliance.service';
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
import { ReservationPricer, type PricedNight } from '../reservations/pricer';
import { assertRoomsReadyForCheckIn } from '../housekeeping/readiness';
import { policyForAmend, readPricingSnapshot } from '../reservations/pricing-snapshot';
import type { Env } from '../config/env';
import type { AmendBookingDto, CreateBookingDto } from './dto';
import { totalsFromNights } from './stay-change';

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
  /**
   * Check out with the guest's balance unpaid. Needs a reason, and — for anyone but the owner —
   * the owner's on-the-spot approval (`approvalToken`, step-up action `checkout_balance`).
   */
  allowBalance?: boolean;
  approvalToken?: string;
  /**
   * The system checking out a stay whose departure day is over and nobody did (owner brief,
   * 2026-09-26). The property chose it by leaving automatic check-out on, so a balance does not
   * stop it — the balance stays on the bill and the desk is told. `departedOn` is the day the guest
   * was due to leave: a room somebody has cleaned or re-let since is not dirtied again.
   */
  automatic?: { departedOn: string };
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
    private readonly stepUp: StepUpService,
  ) {}

  list(tenantId: string, grantedPropertyIds?: string[]) {
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
        .where(
          grantedPropertyIds
            ? grantedPropertyIds.length
              ? inArray(bookings.propertyId, grantedPropertyIds)
              : sql`false`
            : undefined,
        )
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
    opts: {
      source?: 'Extranet' | 'OTA';
      autoApprove?: boolean;
      channelLabel?: string;
      contractedAmount?: number;
    } = {},
  ) {
    const line = await this.pricer.priceLine(
      tx,
      {
        roomId: dto.roomId,
        occupancyId: dto.occupancyId,
        checkin: dto.checkin,
        checkout: dto.checkout,
        rooms: dto.rooms,
        guests: dto.guests,
        externalContract: opts.source === 'OTA',
        policy:
          opts.contractedAmount !== undefined
            ? { override: { mode: 'total', amount: opts.contractedAmount / dto.rooms } }
            : undefined,
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
      if (line.policyVersion)
        throw new BadRequestException(
          'Use the reservation composer to review coupons against smart nightly minimums.',
        );
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
    const pricing = {
      ...(opts.source === 'OTA'
        ? {
            otaContract: {
              channel: opts.channelLabel ?? null,
              amount: opts.contractedAmount ?? null,
              reviewRequired: false,
            },
          }
        : {}),
      ...(line.policyVersion && dto.guests
        ? {
            smart: {
              policyVersion: line.policyVersion,
              guests: dto.guests,
              nights: line.nights.map((night) => ({
                date: night.date,
                quote: night.smartQuote,
              })),
            },
          }
        : {}),
    };

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
        ...(Object.keys(pricing).length ? { pricing } : {}),
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
      adults: dto.guests?.adults ?? line.accommodates ?? 1,
    });
    if (dto.guests)
      await tx
        .update(bookingRooms)
        .set({
          children: dto.guests.childAges.length,
          childAges: dto.guests.childAges,
          extraBeds: dto.guests.extraBeds,
        })
        .where(eq(bookingRooms.bookingId, booking!.id));

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
   * The same desk action across a selection (UX-2) — check in a coach party, close a morning's
   * departures. Each stay runs on its own, so one refusal never stops the rest (see bulk.ts).
   */
  bulk(
    tenantId: string,
    action: 'check-in' | 'check-out',
    ids: string[],
    ctx: TransitionContext = {},
  ): Promise<BulkResult> {
    return runBulk(ids, (id) =>
      action === 'check-in'
        ? this.checkIn(tenantId, id, undefined, ctx)
        : this.checkOut(tenantId, id, undefined, ctx),
    );
  }
  /**
   * What the guest owes on this stay (UX-1b) — the Reservations list's Total − Paid, which is
   * what the desk means by "still to pay", even before any night is posted to the bill.
   */
  balance(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      return { balance: (await this.guestOwes(tx, id)).toFixed(2), currency: b.currency };
    });
  }

  /**
   * What checking this guest in would do right now (UX-1b) — computed by DOING it inside a
   * transaction that is always rolled back, so the dialog can never promise something the real
   * check-in then refuses. Returns the room(s) the guest would get and, if it would be refused,
   * the refusal (`reason`, `message`, `rooms`) the dialog turns into a choice.
   */
  async checkInPreview(tenantId: string, id: string, ctx: TransitionContext = {}) {
    const preview = {
      ok: false,
      problem: null as Record<string, unknown> | null,
      rooms: [] as Array<{ code: string; housekeeping: string }>,
      balance: '0.00',
      currency: '',
      requireDocuments: false,
      customerId: '',
    };
    await this.rolledBack(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      const property = await this.propertyOf(tx, b.propertyId);
      preview.currency = b.currency;
      preview.customerId = b.customerId;
      preview.requireDocuments = property.settings.requireDocumentsAtCheckin;
      preview.balance = (await this.guestOwes(tx, id)).toFixed(2);
      preview.problem = await this.attempt(() =>
        this.transitionWithin(tx, tenantId, id, 'check_in', undefined, ctx),
      );
      preview.ok = preview.problem === null;
      preview.rooms = await this.roomsTonight(tx, b, property.timezone);
    });
    return preview;
  }

  /**
   * What checking this guest out would do right now (UX-1b), the same way: for real, rolled back.
   * `balance` is what the guest still owes AFTER any company bill moved to the city ledger.
   */
  async checkOutPreview(tenantId: string, id: string, ctx: TransitionContext = {}) {
    const preview = {
      ok: false,
      problem: null as Record<string, unknown> | null,
      balance: '0.00',
      currency: '',
      policy: 'block' as 'block' | 'allow',
      /** Leaving before the booked departure: these nights go back on sale. */
      unstayedNights: 0,
      /** The hotel's operating date — "today" for shortening the stay to leave now. */
      today: '',
      guestEmail: null as string | null,
    };
    await this.rolledBack(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      const property = await this.propertyOf(tx, b.propertyId);
      preview.currency = b.currency;
      preview.policy = property.settings.checkoutBalancePolicy;
      const operating = await this.operatingDate(tx, b.propertyId, property.timezone);
      preview.today = operating;
      preview.unstayedNights = operating < b.checkout ? eachNight(operating, b.checkout).length : 0;
      const [guest] = await tx
        .select({ email: customers.email })
        .from(customers)
        .where(eq(customers.id, b.customerId));
      preview.guestEmail = guest?.email ?? null;
      preview.problem = await this.attempt(async () => {
        await this.transitionWithin(tx, tenantId, id, 'check_out', undefined, ctx);
        // Past the guard: nothing is owed after the city-ledger move.
        preview.balance = (await this.guestOwes(tx, id)).toFixed(2);
      });
      if (preview.problem?.reason === 'balance_open') {
        preview.balance = String(preview.problem.balance);
      } else if (preview.problem) {
        preview.balance = (await this.guestOwes(tx, id)).toFixed(2);
      }
      preview.ok = preview.problem === null;
    });
    return preview;
  }

  /**
   * Swap any room the guest would walk into dirty for a clean, free one of the same type
   * (UX-1b) — the "use a clean room instead" choice in the check-in dialog. Legs already in a clean
   * room are left alone. Returns the rooms tonight, as the preview shows them.
   */
  switchToCleanRooms(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      if (b.status !== 'Approved') {
        throw new BadRequestException('Rooms are chosen before check-in');
      }
      const property = await this.propertyOf(tx, b.propertyId);
      const today = await this.operatingDate(tx, b.propertyId, property.timezone);
      const asOf = await housekeepingAsOf(tx, b.propertyId, today);
      const legs = await tx
        .select({ id: bookingRooms.id, unitId: bookingRooms.roomUnitId })
        .from(bookingRooms)
        .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
      const dirty = legs.filter((l) => l.unitId && asOf.get(l.unitId)?.status === 'dirty');
      if (dirty.length === 0) return this.roomsTonight(tx, b, property.timezone);
      await tx
        .update(bookingRooms)
        .set({ roomUnitId: null, updatedAt: new Date() })
        .where(
          inArray(
            bookingRooms.id,
            dirty.map((l) => l.id),
          ),
        );
      await assignRoomsForCheckIn(tx, b, today);
      const rooms = await this.roomsTonight(tx, b, property.timezone);
      if (rooms.some((r) => r.housekeeping === 'dirty' || r.code === '')) {
        throw new ConflictException({
          reason: 'no_clean_room',
          message:
            'There is no clean room of this type free for the stay. Have one cleaned, or check in anyway with a reason.',
        });
      }
      return rooms;
    });
  }

  /**
   * Move an in-house guest's departure (UX-1b) — "can I stay two more nights?", "we're leaving
   * tomorrow instead". Only the nights added or removed change; nights already slept keep the
   * price they were sold at. The guest keeps their room: if it is taken on an added night, the
   * change is refused with the room and date, rather than silently moving them.
   *
   * A stay before arrival is changed with PATCH /bookings/:id instead.
   */
  changeDeparture(
    tenantId: string,
    id: string,
    newCheckout: string,
    reason: string,
    ctx: TransitionContext = {},
    expectedUpdatedAt?: string,
  ) {
    return this.dbs.withTenant(tenantId, (tx) =>
      this.changeDepartureWithin(tx, tenantId, id, newCheckout, reason, ctx, expectedUpdatedAt),
    );
  }

  /**
   * What moving an in-house departure would do (Stay View's resize review): the new total, the
   * difference and every night's price — computed by doing it for real in a transaction that is
   * always rolled back, so the review shows exactly what Save will charge, including a
   * complimentary or overridden rate that the stay keeps.
   */
  async changeDeparturePreview(
    tenantId: string,
    id: string,
    newCheckout: string,
    ctx: TransitionContext = {},
  ) {
    const preview = {
      ok: false,
      problem: null as Record<string, unknown> | null,
      bookingId: id,
      expectedUpdatedAt: '',
      currency: '',
      old: { checkin: '', checkout: '', amount: '0.00' },
      proposed: { checkin: '', checkout: newCheckout, amount: '0.00', difference: '0.00' },
      nights: [] as Array<{ date: string; amount: string; retained: boolean }>,
    };
    await this.rolledBack(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, id));
      if (!b) throw new NotFoundException('Booking not found');
      preview.expectedUpdatedAt = b.updatedAt.toISOString();
      preview.currency = b.currency;
      preview.old = { checkin: b.checkin, checkout: b.checkout, amount: b.amount };
      preview.proposed = {
        checkin: b.checkin,
        checkout: newCheckout,
        amount: b.amount,
        difference: '0.00',
      };
      preview.problem = await this.attempt(async () => {
        const updated = await this.changeDepartureWithin(
          tx,
          tenantId,
          id,
          newCheckout,
          'Reviewed on the calendar',
          ctx,
        );
        preview.proposed.amount = updated.amount;
        preview.proposed.difference = (Number(updated.amount) - Number(b.amount)).toFixed(2);
        const days = await tx
          .select({ date: bookingDays.date, amount: bookingDays.sellingPrice })
          .from(bookingDays)
          .where(eq(bookingDays.bookingId, id))
          .orderBy(asc(bookingDays.date));
        preview.nights = days.map((d) => ({
          date: d.date,
          amount: d.amount,
          retained: b.checkin <= d.date && d.date < b.checkout,
        }));
      });
      preview.ok = preview.problem === null;
    });
    return preview;
  }

  private async changeDepartureWithin(
    tx: Tx,
    tenantId: string,
    id: string,
    newCheckout: string,
    reason: string,
    ctx: TransitionContext = {},
    expectedUpdatedAt?: string,
  ) {
    const b = await this.lockBooking(tx, id);
    if (expectedUpdatedAt && b.updatedAt.toISOString() !== expectedUpdatedAt)
      throw new ConflictException({
        reason: 'changed',
        message: 'This reservation changed after the review. Refresh the proposal.',
      });
    if (b.status !== 'CheckedIn') {
      throw new BadRequestException(
        'Only an in-house stay changes its departure here; edit the reservation before arrival',
      );
    }
    if (newCheckout === b.checkout) {
      throw new BadRequestException(`${b.reference} already leaves on ${b.checkout}`);
    }
    const property = await this.propertyOf(tx, b.propertyId);
    const today = await this.operatingDate(tx, b.propertyId, property.timezone);
    if (newCheckout < today || newCheckout <= b.checkin) {
      throw new ConflictException({
        reason: 'departure_in_past',
        message: `The guest cannot leave before ${today}. To let them go today, check them out.`,
      });
    }

    const now = new Date();
    if (newCheckout > b.checkout) {
      // Extend: price the added nights only, under the terms the stay was sold on.
      const added = eachNight(b.checkout, newCheckout);
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
          checkin: b.checkout,
          checkout: newCheckout,
          rooms: b.rooms,
          policy: policyForAmend(
            snapshot,
            currentDays.map((d) => Number(d.sellingPrice)),
          ),
          unpricedMessage: 'Prices are not set for the extra nights',
        },
        tenant?.mode ?? 'yoho',
      );
      try {
        await reserveStay(tx, b.roomId, added, b.rooms);
      } catch (e) {
        if (e instanceof InsufficientAvailabilityError) {
          throw new ConflictException({
            reason: 'insufficient_availability',
            date: e.date,
            message: `This room type is sold out on ${e.date}, so the stay cannot be extended past it.`,
          });
        }
        throw e;
      }
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'availability',
        aggregateId: b.roomId,
        eventType: 'ari.availability',
        payload: {
          propertyId: b.propertyId,
          roomId: b.roomId,
          nights: added,
          rooms: b.rooms,
          action: 'reserve',
          origin: 'stay_extended',
        },
      });

      // The guest stays in their room. Each leg is stretched in its own savepoint, so a clash
      // is reported with the room and not as a generic failure.
      const legs = await tx
        .select({ id: bookingRooms.id, code: roomUnits.code })
        .from(bookingRooms)
        .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
        .where(
          and(
            eq(bookingRooms.bookingId, id),
            isNull(bookingRooms.releasedAt),
            eq(bookingRooms.checkout, b.checkout),
          ),
        );
      for (const leg of legs) {
        try {
          await tx.transaction(async (sp) => {
            await sp
              .update(bookingRooms)
              .set({ checkout: newCheckout, updatedAt: now })
              .where(eq(bookingRooms.id, leg.id));
          });
        } catch (e) {
          if ((e as { code?: string })?.code !== '23P01') throw e;
          throw new ConflictException({
            reason: 'room_taken',
            message: `Room ${leg.code ?? ''} is booked for another guest during the extra nights. Move this guest to a free room first, then extend.`,
          });
        }
      }

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
    } else {
      // Shorten: the nights from the new departure go back on sale and off the bill.
      const removed = eachNight(newCheckout, b.checkout);
      const posted = await tx
        .select({ id: folioCharges.id })
        .from(folioCharges)
        .innerJoin(folios, eq(folios.id, folioCharges.folioId))
        .where(
          and(
            eq(folios.bookingId, id),
            eq(folioCharges.source, 'room'),
            isNull(folioCharges.voidedAt),
            inArray(folioCharges.bookingDate, removed),
          ),
        );
      if (posted.length) {
        await tx
          .update(folioCharges)
          .set({
            voidedAt: now,
            voidReason: 'Stay shortened',
            voidedByUserId: ctx.actorUserId ?? null,
            updatedAt: now,
          })
          .where(
            inArray(
              folioCharges.id,
              posted.map((p) => p.id),
            ),
          );
      }
      await releaseStay(tx, b.roomId, removed, b.rooms);
      await enqueueOutbox(tx, {
        tenantId,
        aggregate: 'availability',
        aggregateId: b.roomId,
        eventType: 'ari.availability',
        payload: {
          propertyId: b.propertyId,
          roomId: b.roomId,
          nights: removed,
          rooms: b.rooms,
          action: 'release',
          origin: 'stay_shortened',
        },
      });
      const live = and(eq(bookingRooms.bookingId, id), isNull(bookingRooms.releasedAt));
      await tx
        .update(bookingRooms)
        .set({ releasedAt: now, updatedAt: now })
        .where(and(live, gte(bookingRooms.checkin, newCheckout)));
      await tx
        .update(bookingRooms)
        .set({ checkout: newCheckout, updatedAt: now })
        .where(and(live, gt(bookingRooms.checkout, newCheckout)));
      await tx
        .delete(bookingDays)
        .where(and(eq(bookingDays.bookingId, id), inArray(bookingDays.date, removed)));
    }

    const nights = await tx
      .select({
        sellingPrice: bookingDays.sellingPrice,
        basePrice: bookingDays.basePrice,
        tax: bookingDays.tax,
      })
      .from(bookingDays)
      .where(eq(bookingDays.bookingId, id));
    const [updated] = await tx
      .update(bookings)
      .set({
        checkout: newCheckout,
        nights: nights.length,
        ...totalsFromNights(nights, b.rooms),
        updatedAt: now,
      })
      .where(eq(bookings.id, id))
      .returning();
    await this.record(
      tx,
      tenantId,
      id,
      'amended',
      `Departure ${b.checkout} → ${newCheckout}: ${reason.trim()}`,
      ctx,
    );
    return updated!;
  }

  /** Run `fn` in a tenant transaction that is always rolled back — a dry run of the real thing. */
  private async rolledBack(tenantId: string, fn: (tx: Tx) => Promise<void>): Promise<void> {
    const rollback = new Error('rollback');
    try {
      await this.dbs.withTenant(tenantId, async (tx) => {
        await fn(tx);
        throw rollback;
      });
    } catch (e) {
      if (e !== rollback) throw e;
    }
  }

  /** The refusal an HTTP exception carries, or null when the action went through. */
  private async attempt(fn: () => Promise<unknown>): Promise<Record<string, unknown> | null> {
    try {
      await fn();
      return null;
    } catch (e) {
      if (!(e instanceof HttpException)) throw e;
      const body = e.getResponse();
      return typeof body === 'string'
        ? { reason: 'refused', message: body }
        : { reason: 'refused', ...(body as Record<string, unknown>) };
    }
  }

  /** The room(s) a stay occupies on the operating date, with their housekeeping state. */
  private async roomsTonight(
    tx: Tx,
    b: typeof bookings.$inferSelect,
    timezone: string | null,
  ): Promise<Array<{ code: string; housekeeping: string }>> {
    const today = await this.operatingDate(tx, b.propertyId, timezone);
    const legs = await tx
      .select({ unitId: bookingRooms.roomUnitId, code: roomUnits.code })
      .from(bookingRooms)
      .leftJoin(roomUnits, eq(roomUnits.id, bookingRooms.roomUnitId))
      .where(
        and(
          eq(bookingRooms.bookingId, b.id),
          isNull(bookingRooms.releasedAt),
          lte(bookingRooms.checkin, today),
          gt(bookingRooms.checkout, today),
        ),
      );
    const asOf = await housekeepingAsOf(tx, b.propertyId, today);
    return legs.map((l) => ({
      code: l.code ?? '',
      housekeeping: l.unitId ? (asOf.get(l.unitId)?.status ?? 'clean') : 'unassigned',
    }));
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
      // Nothing was stayed, so no tourism tax is owed (Sprint 7).
      await voidAllLevies(tx, b.id, 'Check-in undone', ctx.actorUserId ?? null);
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
      const [checkInProperty] = await tx
        .select({ timezone: properties.timezone })
        .from(properties)
        .where(eq(properties.id, b.propertyId));
      const activeLegs = await tx
        .select({ roomUnitId: bookingRooms.roomUnitId })
        .from(bookingRooms)
        .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
      const assignedUnitIds = activeLegs.flatMap((leg) => (leg.roomUnitId ? [leg.roomUnitId] : []));
      // Hotels that have not configured physical rooms retain the legacy category-only workflow.
      // Once numbered rooms exist, assertReadyForCheckIn assigns every leg before this point.
      if (assignedUnitIds.length && !(ctx.overrideDirty && reason?.trim()))
        await assertRoomsReadyForCheckIn(
          tx,
          b.propertyId,
          assignedUnitIds,
          localToday(checkInProperty?.timezone),
        );
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

    // A thank-you days after the guest left reads as a mistake: an automatic check-out of a stay
    // that ended before yesterday sends the guest nothing (see below).
    let lateAutomatic = false;

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
        ctx.automatic ? { departedOn: ctx.automatic.departedOn } : {},
      );
      lateAutomatic =
        !!ctx.automatic && ctx.automatic.departedOn < addDaysIso(localToday(property.timezone), -1);

      // Leaving early gives the nights not stayed back for sale, and frees the room from tonight.
      // (What those nights cost is a price question: shorten the stay to re-price it.)
      const operating = await this.operatingDate(tx, b.propertyId, property.timezone);
      if (operating < b.checkout) {
        await releaseBookingInventory(tx, b, { from: operating, origin: 'early_checkout' });
      }

      // Levies for exactly the nights stayed (Sprint 7): what night audit did not post is posted
      // now — a Starter hotel has no night audit — and a night not stayed is voided. Before the
      // settlement and the balance check, so the guest settles the tourism tax too.
      await reconcileLevies(tx, tenantId, updated!, operating, ctx.actorUserId ?? null);

      const { features } = await this.billing.entitlements(tenantId, tx);
      if (features.cashiering)
        await settleAtCheckout(tx, tenantId, updated!, ctx.actorUserId ?? null);

      // A guest never leaves owing money by accident (UX-STANDARD §4). This runs AFTER the
      // city-ledger move, so what a company pays is not held against the guest; throwing here
      // rolls back the whole check-out, settlement included.
      const owed = await this.guestOwes(tx, b.id);
      if (owed > 0.004 && property.settings.checkoutBalancePolicy === 'block' && !ctx.automatic) {
        if (!(ctx.allowBalance && reason?.trim())) {
          throw new ConflictException({
            reason: 'balance_open',
            balance: owed.toFixed(2),
            currency: b.currency,
            message: `${b.reference} still has ${b.currency} ${owed.toFixed(2)} to pay. Take the payment or move it to the city ledger; the owner can let the guest go anyway, with a reason.`,
          });
        }
        if (ctx.role !== 'OWNER') {
          // The desk may, with the owner's approval given on the spot (step-up).
          if (!ctx.approvalToken || !ctx.actorUserId) {
            throw new ForbiddenException(
              'Only the owner can check a guest out with a balance unpaid. Ask them to approve it on this screen.',
            );
          }
          await this.stepUp.verify(ctx.approvalToken, {
            tenantId,
            action: 'checkout_balance',
            requesterId: ctx.actorUserId,
          });
        }
      }
    }

    // Check-out opens the review window: mint a single-use invite + queue the guest email
    // (Compartment I). The invite row has no RLS — its unguessable token IS the authorization.
    if (kind === 'check_out' && !lateAutomatic) {
      await this.queueReviewInvite(tx, tenantId, b);
      await this.queueCheckoutEmail(tx, tenantId, b);
    }
    return updated;
  }

  /**
   * Flag a reservation VIP, or clear the flag (owner brief, 2026-09-26): a label that shows the
   * stay with a crown on every screen, nothing more. Every room of a multi-room reservation changes
   * together, and each change is on the stay's record.
   */
  setVip(tenantId: string, id: string, vip: boolean, ctx: TransitionContext = {}) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const b = await this.lockBooking(tx, id);
      const [group] = b.groupId
        ? await tx
            .select({ kind: bookingGroups.kind })
            .from(bookingGroups)
            .where(eq(bookingGroups.id, b.groupId))
        : [];
      const ids =
        group?.kind === 'reservation'
          ? (
              await tx
                .select({ id: bookings.id })
                .from(bookings)
                .where(eq(bookings.groupId, b.groupId!))
            ).map((r) => r.id)
          : [b.id];
      const changed = await tx
        .update(bookings)
        .set({ isVip: vip, updatedAt: new Date() })
        .where(and(inArray(bookings.id, ids), sql`${bookings.isVip} <> ${vip}`))
        .returning({ id: bookings.id });
      for (const row of changed)
        await this.record(tx, tenantId, row.id, 'amended', vip ? 'Marked VIP' : 'VIP removed', ctx);
      return { vip, bookings: ids.length };
    });
  }

  /**
   * Check out a stay whose departure day is over and that nobody checked out (owner brief,
   * 2026-09-26), inside the caller's transaction — the day-close scheduler's and the night
   * audit's. The desk's own check-out with the system as the actor: the room turns dirty and gets
   * its departure clean, levies and the city ledger settle, and the record says why. What the
   * guest still owes stays on the bill; the notification says how much, so the desk can collect.
   *
   * Returns null when the stay is no longer in house (someone got there first).
   */
  async autoCheckOutWithin(tx: Tx, tenantId: string, bookingId: string) {
    const [b] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        reference: bookings.reference,
        checkout: bookings.checkout,
        currency: bookings.currency,
        guestName: customers.name,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(eq(bookings.id, bookingId));
    if (!b || b.status !== 'CheckedIn') return null;

    await this.transitionWithin(
      tx,
      tenantId,
      bookingId,
      'check_out',
      `Checked out automatically: the departure date (${b.checkout}) had passed`,
      { automatic: { departedOn: b.checkout } },
    );
    const owed = await this.guestOwes(tx, bookingId);
    const due = owed > 0.004 ? `${b.currency} ${owed.toFixed(2)}` : null;
    await tx.insert(notifications).values({
      tenantId,
      type: 'auto_checkout',
      title: `Checked out automatically — ${b.reference}`,
      body: `${b.guestName} was still in house after their departure date (${b.checkout}), so the stay was checked out and the room marked for cleaning.${due ? ` ${due} is still to pay.` : ''}`,
      entity: 'booking',
      entityId: bookingId,
    });
    return { id: b.id, reference: b.reference, owed: due };
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

    // Malaysia's Registration of Guests Act (Sprint 7): the register is complete before the key.
    if (property.settings.requireGuestRegistration) await assertRegistered(tx, b, b.reference);
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
  private async quoteAmendedNights(
    tx: Tx,
    tenantId: string,
    booking: typeof bookings.$inferSelect,
    checkin: string,
    checkout: string,
    count: number,
  ) {
    const snapshot = readPricingSnapshot(booking.pricing);
    const currentDays = await tx
      .select()
      .from(bookingDays)
      .where(eq(bookingDays.bookingId, booking.id));
    const [tenant] = await tx
      .select({ mode: tenants.distributionMode })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const oldByDate = new Map(currentDays.map((day) => [day.date, day]));
    const nights: PricedNight[] = [];
    for (const date of eachNight(checkin, checkout)) {
      const old = oldByDate.get(date);
      if (old) {
        nights.push({
          date,
          basePrice: old.basePrice,
          commission: old.commission,
          sellingPrice: old.sellingPrice,
          tax: old.tax,
          listSellingPrice: old.listSellingPrice ?? old.sellingPrice,
          rateSource: old.rateSource as PricedNight['rateSource'],
          taxLines: old.taxLines ?? [],
        });
        continue;
      }
      const next = new Date(Date.parse(date + 'T00:00:00Z') + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const fresh = await this.pricer.priceLine(
        tx,
        {
          roomId: booking.roomId,
          occupancyId: booking.occupancyId,
          checkin: date,
          checkout: next,
          rooms: count,
          policy: {
            contractAccountId: snapshot.contractAccountId,
            taxExempt: Boolean(snapshot.taxExempt),
          },
          guests: snapshot.smart?.guests,
          unpricedMessage: 'Prices are not set for all new nights of the stay',
        },
        tenant?.mode ?? 'yoho',
      );
      nights.push(fresh.nights[0]!);
    }
    const sum = (field: 'basePrice' | 'sellingPrice' | 'tax' | 'listSellingPrice') =>
      nights.reduce((total, night) => total + Number(night[field]) * count, 0);
    const amount = sum('sellingPrice');
    const taxes = sum('tax');
    return {
      nights,
      amount: amount.toFixed(2),
      totalBase: sum('basePrice').toFixed(2),
      taxes: taxes.toFixed(2),
      commissionable: (amount - taxes).toFixed(2),
      listAmount: sum('listSellingPrice').toFixed(2),
    };
  }

  async previewStayChange(tenantId: string, id: string, checkin: string, checkout: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, id));
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.source === 'OTA')
        throw new BadRequestException(
          'The connected provider does not support OTA date modification from Stay View.',
        );
      if (
        booking.status !== 'Pending' &&
        booking.status !== 'Approved' &&
        booking.status !== 'CheckedIn'
      )
        throw new BadRequestException('This stay cannot be changed here.');
      if (
        booking.status === 'CheckedIn' &&
        (checkin !== booking.checkin || checkout <= booking.checkout)
      )
        throw new BadRequestException('An in-house stay can only extend its departure date.');
      if (checkin >= checkout) throw new BadRequestException('Departure must be after arrival.');
      if (booking.status !== 'CheckedIn') await this.assertNotSplit(tx, id);
      const line = await this.quoteAmendedNights(
        tx,
        tenantId,
        booking,
        checkin,
        checkout,
        booking.rooms,
      );
      const legs = await tx
        .select({ id: bookingRooms.id, roomUnitId: bookingRooms.roomUnitId })
        .from(bookingRooms)
        .where(and(eq(bookingRooms.bookingId, id), isNull(bookingRooms.releasedAt)));
      if (booking.status === 'CheckedIn' && (legs.length !== 1 || !legs[0]?.roomUnitId))
        throw new ConflictException(
          'This in-house stay needs a single assigned room before extending.',
        );
      const conflicts: string[] = [];
      for (const leg of legs) {
        if (!leg.roomUnitId) continue;
        const [other] = await tx
          .select({ id: bookingRooms.id })
          .from(bookingRooms)
          .where(
            and(
              eq(bookingRooms.roomUnitId, leg.roomUnitId),
              isNull(bookingRooms.releasedAt),
              sql`${bookingRooms.bookingId} <> ${id} and daterange(${bookingRooms.checkin}, ${bookingRooms.checkout}, '[)') && daterange(${checkin}::date, ${checkout}::date, '[)')`,
            ),
          )
          .limit(1);
        const [block] = await tx
          .select({ id: maintenanceBlocks.id })
          .from(maintenanceBlocks)
          .where(
            and(
              eq(maintenanceBlocks.roomUnitId, leg.roomUnitId),
              isNull(maintenanceBlocks.releasedAt),
              sql`daterange(${maintenanceBlocks.blockFrom}, ${maintenanceBlocks.blockTo}, '[)') && daterange(${checkin}::date, ${checkout}::date, '[)')`,
            ),
          )
          .limit(1);
        if (other || block) conflicts.push(leg.roomUnitId);
      }
      return {
        bookingId: id,
        expectedUpdatedAt: booking.updatedAt.toISOString(),
        old: { checkin: booking.checkin, checkout: booking.checkout, amount: booking.amount },
        proposed: {
          checkin,
          checkout,
          amount: line.amount,
          difference: (Number(line.amount) - Number(booking.amount)).toFixed(2),
        },
        nights: line.nights.map((night) => ({
          date: night.date,
          amount: night.sellingPrice,
          retained: booking.checkin <= night.date && night.date < booking.checkout,
        })),
        conflicts,
      };
    });
  }

  amend(tenantId: string, id: string, dto: AmendBookingDto, ctx: TransitionContext = {}) {
    return this.dbs.withTenant(tenantId, (tx) =>
      this.amendWithin(tx, tenantId, id, dto, undefined, undefined, ctx),
    );
  }

  /** Review and save are priced by the same helper; the booking version is checked under lock. */
  amendWithReview(
    tenantId: string,
    id: string,
    dto: AmendBookingDto,
    expectedUpdatedAt: string,
    expectedAmount: string,
    ctx: TransitionContext = {},
  ) {
    return this.dbs.withTenant(tenantId, (tx) =>
      this.amendWithin(tx, tenantId, id, dto, expectedUpdatedAt, expectedAmount, ctx),
    );
  }

  /**
   * A stay split across rooms (a mid-stay move) has one leg per room. Shifting its dates as one
   * block would have to decide which room each shifted night belongs to, which is a room move,
   * not a date change — so it is refused with what to do instead, never guessed.
   */
  private async assertNotSplit(tx: Tx, bookingId: string) {
    const [split] = await tx
      .select({ legIndex: bookingRooms.legIndex })
      .from(bookingRooms)
      .where(and(eq(bookingRooms.bookingId, bookingId), isNull(bookingRooms.releasedAt)))
      .groupBy(bookingRooms.legIndex)
      .having(sql`count(*) > 1`)
      .limit(1);
    if (split)
      throw new ConflictException({
        reason: 'split_stay',
        message:
          'This stay is split across rooms, so its dates cannot move as one block. Move the guest back into one room first, or change the departure from the reservation.',
      });
  }

  private async amendWithin(
    tx: Tx,
    tenantId: string,
    id: string,
    dto: AmendBookingDto,
    expectedUpdatedAt?: string,
    expectedAmount?: string,
    ctx: TransitionContext = {},
  ) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
    if (!b) throw new NotFoundException('Booking not found');
    if (expectedUpdatedAt && b.updatedAt.toISOString() !== expectedUpdatedAt)
      throw new ConflictException(
        'This reservation changed after the review. Refresh the proposal.',
      );
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
      if (b.source === 'OTA')
        throw new BadRequestException(
          'OTA date changes require a provider modification workflow; internal room allocation remains available.',
        );
      if (b.status !== 'Pending' && b.status !== 'Approved' && b.status !== 'CheckedIn') {
        throw new BadRequestException(`Cannot change the stay of a ${b.status} booking`);
      }
      const inHouseExtension = b.status === 'CheckedIn';
      if (
        inHouseExtension &&
        (newCheckin !== b.checkin || newCheckout <= b.checkout || newRooms !== b.rooms)
      )
        throw new BadRequestException(
          'An in-house stay can only extend its departure date without changing rooms.',
        );
      if (newCheckout <= newCheckin)
        throw new BadRequestException('checkout must be after checkin');
      if (!inHouseExtension) await this.assertNotSplit(tx, b.id);

      const oldNights = eachNight(b.checkin, b.checkout);
      const newNights = eachNight(newCheckin, newCheckout);

      const line = await this.quoteAmendedNights(
        tx,
        tenantId,
        b,
        newCheckin,
        newCheckout,
        newRooms,
      );
      if (expectedAmount && line.amount !== expectedAmount)
        throw new ConflictException('Rates changed after the review. Refresh the proposal.');
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

      // Preserve room assignments across the new dates. Conflicts roll back the amendment.
      const existingLegs = await tx
        .select({
          id: bookingRooms.id,
          legIndex: bookingRooms.legIndex,
          roomUnitId: bookingRooms.roomUnitId,
        })
        .from(bookingRooms)
        .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
      if (inHouseExtension) {
        if (existingLegs.length !== 1 || !existingLegs[0]?.roomUnitId)
          throw new ConflictException(
            'This in-house stay needs a single assigned room before extending.',
          );
        const [planned] = await tx
          .select({ id: roomMoves.id })
          .from(roomMoves)
          .where(and(eq(roomMoves.bookingId, b.id), eq(roomMoves.status, 'planned')));
        if (planned)
          throw new ConflictException('Resolve the planned room move before extending this stay.');
        const [blocked] = await tx
          .select({ id: maintenanceBlocks.id })
          .from(maintenanceBlocks)
          .where(
            and(
              eq(maintenanceBlocks.roomUnitId, existingLegs[0].roomUnitId),
              isNull(maintenanceBlocks.releasedAt),
              sql`daterange(${maintenanceBlocks.blockFrom}, ${maintenanceBlocks.blockTo}, '[)') && daterange(${b.checkout}::date, ${newCheckout}::date, '[)')`,
            ),
          );
        if (blocked)
          throw new ConflictException('The assigned room is blocked during the extension.');
        try {
          await tx.transaction((sp) =>
            sp
              .update(bookingRooms)
              .set({ checkout: newCheckout, updatedAt: new Date() })
              .where(eq(bookingRooms.id, existingLegs[0]!.id)),
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23P01')
            throw new ConflictException('The assigned room has another stay during the extension.');
          throw error;
        }
      } else {
        await unassignLegs(tx, b.id);
        await resizeLegs(tx, {
          tenantId,
          bookingId: b.id,
          rooms: newRooms,
          checkin: newCheckin,
          checkout: newCheckout,
        });

        const reshaped = await tx
          .select({ id: bookingRooms.id, legIndex: bookingRooms.legIndex })
          .from(bookingRooms)
          .where(and(eq(bookingRooms.bookingId, b.id), isNull(bookingRooms.releasedAt)));
        for (const leg of reshaped) {
          const original = existingLegs.find((item) => item.legIndex === leg.legIndex);
          if (!original?.roomUnitId) continue;
          const [unit] = await tx
            .select({ code: roomUnits.code, status: roomUnits.status })
            .from(roomUnits)
            .where(eq(roomUnits.id, original.roomUnitId));
          if (!unit || unit.status !== 'active')
            throw new ConflictException(
              'An assigned room is no longer active. Review room allocation.',
            );
          const [blocked] = await tx
            .select({ id: maintenanceBlocks.id })
            .from(maintenanceBlocks)
            .where(
              and(
                eq(maintenanceBlocks.roomUnitId, original.roomUnitId),
                isNull(maintenanceBlocks.releasedAt),
                sql`daterange(${maintenanceBlocks.blockFrom}, ${maintenanceBlocks.blockTo}, '[)') && daterange(${newCheckin}::date, ${newCheckout}::date, '[)')`,
              ),
            );
          if (blocked)
            throw new ConflictException(`Room ${unit.code} is blocked during the proposed stay.`);
          try {
            await tx.transaction((sp) =>
              sp
                .update(bookingRooms)
                .set({ roomUnitId: original.roomUnitId, updatedAt: new Date() })
                .where(eq(bookingRooms.id, leg.id)),
            );
          } catch (error) {
            if ((error as { code?: string }).code === '23P01')
              throw new ConflictException(
                `Room ${unit.code} is occupied during the proposed stay. Review another room.`,
              );
            throw error;
          }
        }
      }

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
    await this.record(
      tx,
      tenantId,
      id,
      stayChanged ? 'stay_changed' : 'amended',
      changes.join('; '),
      ctx,
    );

    const [updated] = await tx.select().from(bookings).where(eq(bookings.id, id));
    return updated;
  }
}
