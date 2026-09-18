import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  bookings,
  bookingDays,
  bookingApprovals,
  bookingRooms,
  customers,
  folioCharges,
  folios,
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
  messages,
  templates,
  reviewInvites,
  enqueueOutbox,
  type Tx,
} from '@yohobed/db';
import {
  couponDiscount,
  kindAfterApproval,
  referralCommission,
  renderTemplate,
  CURRENCY_META,
  isCurrencyCode,
  type ReservationKind,
} from '@yohobed/domain';
import { ConfigService } from '@nestjs/config';
import { BillingService } from '../billing/billing.service';
import { settleAtCheckout } from '../folio/settlement';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../email/mailer.service';
import { createLegs, resizeLegs, unassignLegs } from '../inventory/room-units.service';
import { eachNight } from '../common/dates';
import { localToday, propertyBusinessDate } from '../common/local-date';
import { resolveFxRateToLkr } from '../common/fx-rate';
import { ReservationPricer } from '../reservations/pricer';
import { policyForAmend, readPricingSnapshot } from '../reservations/pricing-snapshot';
import type { Env } from '../config/env';
import type { AmendBookingDto, CreateBookingDto } from './dto';

type Transition = 'approve' | 'reject' | 'cancel' | 'no_show' | 'check_in' | 'check_out';

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

  approve(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'approve');
  }
  reject(tenantId: string, id: string, reason?: string) {
    return this.transition(tenantId, id, 'reject', reason);
  }
  cancel(tenantId: string, id: string, reason?: string) {
    return this.transition(tenantId, id, 'cancel', reason);
  }
  noShow(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'no_show');
  }
  checkIn(tenantId: string, id: string) {
    return this.transition(tenantId, id, 'check_in');
  }
  async checkOut(tenantId: string, id: string) {
    const updated = await this.transition(tenantId, id, 'check_out');
    this.mailer.deliverQueuedSafe(tenantId); // after commit: send the queued review invite
    return updated;
  }

  private transition(tenantId: string, id: string, kind: Transition, reason?: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      this.transitionWithin(tx, tenantId, id, kind, reason),
    );
  }

  /**
   * Move a booking through its lifecycle, inside the caller's transaction.
   *
   * The row is locked first: two desks cancelling the same booking at once must not both give its
   * rooms back. Inventory is only returned by a booking that holds it (`inventory_held`), so
   * cancelling an inquiry never releases rooms it never took.
   */
  async transitionWithin(tx: Tx, tenantId: string, id: string, kind: Transition, reason?: string) {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
    if (!b) throw new NotFoundException('Booking not found');

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
      if (b.status !== 'Approved') {
        throw new BadRequestException(`Cannot check in a ${b.status} booking`);
      }
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
    await tx
      .insert(bookingApprovals)
      .values({ tenantId, bookingId: id, action, reason: reason ?? null });

    // Check-out settles with the city ledger: a company's or travel agent's window moves to its
    // account and a travel agent's commission is accrued (Pro, Development Phase 02).
    if (kind === 'check_out') {
      const { features } = await this.billing.entitlements(tenantId, tx);
      if (features.cashiering) await settleAtCheckout(tx, tenantId, updated!, null);
    }

    // Check-out opens the review window: mint a single-use invite + queue the guest email
    // (Compartment I). The invite row has no RLS — its unguessable token IS the authorization.
    if (kind === 'check_out') await this.queueReviewInvite(tx, tenantId, b);
    return updated;
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
