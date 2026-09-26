import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import {
  auditLog,
  availabilityCalendar,
  bookingApprovals,
  bookingDays,
  bookingGroups,
  bookingInclusions,
  bookingRemarks,
  bookingRooms,
  bookingTransfers,
  bookings,
  businessSources,
  couponRedemptions,
  coupons,
  customers,
  enqueueOutbox,
  housekeepingAsOf,
  InsufficientAvailabilityError,
  ledgerAccounts,
  maintenanceBlocks,
  marketSegments,
  messages,
  nextBookingReference,
  nextReceiptNo,
  notifications,
  properties,
  rateTypes,
  ratePlans,
  referralCommissions,
  referralPartners,
  reservationRequests,
  reserveStay,
  roomUnits,
  rooms,
  templates,
  tenants,
  transportModes,
  workOrders,
  type Tx,
  type HotelPermission,
} from '@yohobed/db';
import {
  couponDiscount,
  CURRENCY_META,
  isCurrencyCode,
  referralCommission,
  renderTemplate,
  resolvePropertySettings,
  resolveReservationOptions,
  RESERVATION_KIND_META,
  splitProportional,
  sumMoney,
  type BookingOrigin,
  type DistributionModeLike,
  type PropertySettings,
  type Residency,
  type TaxLine,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../email/mailer.service';
import { BillingService } from '../billing/billing.service';
import { StepUpService } from '../auth/step-up.service';
import { eachNight } from '../common/dates';
import { localToday, propertyBusinessDate } from '../common/local-date';
import { resolveFxRateToLkr } from '../common/fx-rate';
import { ReservationPricer, type PricedLine, type PricingPolicy } from './pricer';
import type { PricingSnapshot } from './pricing-snapshot';
import { resolveGuest, type ResolvedGuest } from './guest-resolver';
import { BookingService } from '../bookings/booking.service';
import { assertRoomsReadyForCheckIn } from '../housekeeping/readiness';
import { ensureWindow } from '../folio/windows';
import { levyEstimate } from '../folio/levies';
import { buildVoucher, money as guestMoney, queueVoucher } from '../vouchers/voucher';
import {
  assertCityLedger,
  chargeToAccountWithin,
  insertPayment,
  resolveDrawerSession,
  resolvePaymentMethod,
} from '../payments/take-payment';
import type { CreateReservationDto, QuoteReservationDto } from './dto';

/** Who is asking — the desk user and their role in the tenant. */
export interface Actor {
  tenantId: string;
  userId: string;
  role: string | undefined;
  permissions?: HotelPermission[];
}

/** The owner approvals a price decision can need (StepUpService actions). */
export type PriceApproval = 'rate_override' | 'complimentary' | 'tax_exempt';

type LineDto = CreateReservationDto['lines'][number];

interface PreparedLine {
  index: number;
  dto: LineDto;
  priced: PricedLine;
  unit: { id: string; code: string } | null;
  /** This line's share of a coupon discount. */
  discount: number;
}

interface Prepared {
  property: typeof properties.$inferSelect;
  settings: PropertySettings;
  mode: DistributionModeLike;
  /** The hotel's operating date — no stay may start before it. */
  businessDate: string;
  /** The hotel's calendar today — references and coupons are dated by it. */
  calendarToday: string;
  nights: string[];
  holdUntil: Date | null;
  origin: BookingOrigin;
  businessSourceId: string | null;
  /** The source collects Malaysia's tourism tax itself, so the hotel must not (Sprint 7). */
  levyCollectedByChannel: boolean;
  ledgerAccountId: string | null;
  salesPersonId: string | null;
  marketSegmentId: string | null;
  residency: Residency | null;
  lines: PreparedLine[];
  coupon: { id: string; discount: number } | null;
  referral: { partnerId: string; pct: number } | null;
  totals: { amount: number; taxes: number; listAmount: number; discount: number; due: number };
  approvalsRequired: PriceApproval[];
  reasonRequired: boolean;
  policyOf: (line: LineDto) => PricingPolicy;
}

const money = (n: number) => n.toFixed(2);
const EXCLUSION_VIOLATION = '23P01';

/**
 * Taking a reservation (Development Phase 02): Yanolja's Quick Reservation and Add Reservation.
 *
 * A reservation of N rooms is N sibling bookings — `<ref>-1…n` — created in one transaction, so
 * either every room is booked or none is. Each sibling is an ordinary booking: folio, night audit,
 * invoices, payouts, amendments and the channel manager all work on it unchanged. A multi-room
 * reservation also gets a booking group, coded with its master reference, which is what shows the
 * rooms together on the Reservations screen.
 *
 * Quote and create share `prepare`, so the price a desk is quoted is the price that is stored.
 */
@Injectable()
export class ReservationService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly pricer: ReservationPricer,
    private readonly billing: BillingService,
    private readonly stepUp: StepUpService,
    private readonly mailer: MailerService,
    private readonly bookingService: BookingService,
  ) {}

  // --- Quote -----------------------------------------------------------------

  /** Price a reservation without booking it: the live Billing Summary. */
  quote(actor: Actor, dto: QuoteReservationDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const p = await this.prepare(tx, actor, dto);
      const free = await this.freeRooms(
        tx,
        [...new Set(p.lines.map((l) => l.dto.roomId))],
        p.nights,
      );
      const wanted = new Map<string, number>();
      for (const l of p.lines) wanted.set(l.dto.roomId, (wanted.get(l.dto.roomId) ?? 0) + 1);
      const holds = RESERVATION_KIND_META[dto.kind].holdsInventory;

      return {
        propertyId: p.property.id,
        checkin: dto.checkin,
        checkout: dto.checkout,
        nights: p.nights.length,
        currency: p.property.currency,
        kind: dto.kind,
        holdUntil: p.holdUntil?.toISOString() ?? null,
        origin: p.origin,
        marketSegmentId: p.marketSegmentId,
        lines: p.lines.map((l) => ({
          index: l.index,
          roomId: l.priced.roomId,
          roomName: l.priced.roomName,
          occupancyId: l.priced.occupancyId,
          ratePlanId: l.priced.ratePlanId,
          rateCode: l.priced.rateCode,
          amount: l.priced.amount,
          taxes: l.priced.taxes,
          listAmount: l.priced.listAmount,
          discountPct: l.priced.discountPct,
          rateSource: l.priced.rateSource,
          policyVersion: l.priced.policyVersion,
          couponDiscount: money(l.discount),
          nights: l.priced.nights.map((n) => ({
            date: n.date,
            sellingPrice: n.sellingPrice,
            listSellingPrice: n.listSellingPrice,
            tax: n.tax,
            rateSource: n.rateSource,
            smartQuote: n.smartQuote,
          })),
          free: free.get(l.dto.roomId) ?? 0,
          // Enough rooms of this type for every line asking for one — only matters for a
          // booking that takes rooms.
          available: !holds || (free.get(l.dto.roomId) ?? 0) >= (wanted.get(l.dto.roomId) ?? 0),
        })),
        totals: {
          amount: money(p.totals.amount),
          taxes: money(p.totals.taxes),
          listAmount: money(p.totals.listAmount),
          discount: money(p.totals.discount),
          due: money(p.totals.due),
          taxLines: this.sumTaxLines(p.lines),
        },
        approvalsRequired: p.approvalsRequired,
        reasonRequired: p.reasonRequired,
        /** Typed rates are before tax when the property charges tax on top (Sprint 7). */
        taxMode: p.property.taxMode,
        // Levies the stay will owe on top of the price — Malaysia's tourism tax, charged per
        // room per night stayed on the folio, never inside the rate (Sprint 7).
        levies: await levyEstimate(tx, {
          propertyId: p.property.id,
          currency: p.property.currency,
          checkin: dto.checkin,
          checkout: dto.checkout,
          residency: p.residency,
          levyExempt: false,
          collectedByChannel: p.levyCollectedByChannel,
          rooms: p.lines.length,
        }),
      };
    });
  }

  // --- Create ----------------------------------------------------------------

  async create(actor: Actor, dto: CreateReservationDto, idempotencyKey?: string) {
    const result = await this.dbs.withTenant(actor.tenantId, async (tx) => {
      // A big group on a slow night must fail loudly rather than hold locks forever.
      await tx.execute(sql`set local statement_timeout = '20s'`);

      let requestId: string | null = null;
      if (idempotencyKey) {
        const claim = await this.claimIdempotencyKey(tx, actor, idempotencyKey, dto);
        if ('replay' in claim) return { replayed: true as const, body: claim.replay };
        requestId = claim.id;
      }

      const body = await this.createWithin(tx, actor, dto);

      if (requestId) {
        await tx
          .update(reservationRequests)
          .set({ response: body, completedAt: new Date() })
          .where(eq(reservationRequests.id, requestId));
      }
      return { replayed: false as const, body };
    });
    if (!result.replayed) this.mailer.deliverQueuedSafe(actor.tenantId);
    return result;
  }

  private async claimIdempotencyKey(
    tx: Tx,
    actor: Actor,
    key: string,
    dto: CreateReservationDto,
  ): Promise<{ id: string } | { replay: unknown }> {
    const hash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    // A concurrent request with the same key waits here until the first commits or rolls back.
    const [claimed] = await tx
      .insert(reservationRequests)
      .values({
        tenantId: actor.tenantId,
        idempotencyKey: key,
        requestHash: hash,
        userId: actor.userId,
      })
      .onConflictDoNothing({
        target: [reservationRequests.tenantId, reservationRequests.idempotencyKey],
      })
      .returning({ id: reservationRequests.id });
    if (claimed) {
      // Keys only need to outlive a retry; prune this tenant's old ones as we go.
      await tx
        .delete(reservationRequests)
        .where(
          and(
            eq(reservationRequests.tenantId, actor.tenantId),
            lt(reservationRequests.createdAt, new Date(Date.now() - 2 * 86_400_000)),
          ),
        );
      return { id: claimed.id };
    }
    const [prior] = await tx
      .select()
      .from(reservationRequests)
      .where(
        and(
          eq(reservationRequests.tenantId, actor.tenantId),
          eq(reservationRequests.idempotencyKey, key),
        ),
      );
    if (!prior?.response) {
      throw new ConflictException({
        reason: 'idempotency_in_progress',
        message: 'This reservation is still being saved. Try again in a moment.',
      });
    }
    if (prior.requestHash !== hash) {
      throw new ConflictException({
        reason: 'idempotency_key_reused',
        message: 'This idempotency key was already used for a different reservation.',
      });
    }
    return { replay: prior.response };
  }

  private async createWithin(tx: Tx, actor: Actor, dto: CreateReservationDto) {
    const { tenantId } = actor;
    const p = await this.prepare(tx, actor, dto);
    const meta = RESERVATION_KIND_META[dto.kind];

    // Price authority: staff beyond their limits need an owner's approval on the spot.
    const approvedBy = await this.verifyApprovals(actor, dto, p);

    // The plan decides a few things; ask once, and before anything is written.
    const companyBill = dto.billTo === 'company' || dto.billTo === 'company_room_tax';
    const hasTasks = dto.lines.some((l) => l.tasks?.length);
    const features =
      hasTasks || companyBill || dto.payment
        ? (await this.billing.entitlements(tenantId, tx)).features
        : null;
    // Tasks are work orders, which are Pro.
    if (hasTasks && !features!.work_orders) {
      throw new ForbiddenException(
        'Tasks are part of the Pro plan (work orders). Save the reservation without them, or upgrade.',
      );
    }
    // Billing a travel agent or company is the city ledger, which is Pro.
    if (companyBill) assertCityLedger(features!.cashiering);
    if (dto.payment && dto.payment.amount > p.totals.due + 0.004) {
      throw new BadRequestException({
        reason: 'payment_exceeds_total',
        message: `A payment can be at most the reservation's total of ${money(p.totals.due)}.`,
      });
    }
    // A walk-in: the guest is at the desk today, in a confirmed room.
    if (dto.checkIn && dto.checkin !== p.businessDate) {
      throw new BadRequestException({
        reason: 'checkin_not_today',
        message: `Only a stay starting today (${p.businessDate}) can be checked in now.`,
      });
    }

    if (dto.expectedTotal !== undefined && Math.abs(dto.expectedTotal - p.totals.due) > 0.004) {
      throw new ConflictException({
        reason: 'price_changed',
        message: `The price changed since it was quoted: the total is now ${money(p.totals.due)}.`,
        total: money(p.totals.due),
      });
    }

    // 1. Rooms. One reservation per room type, in room-id order, so two reservations taking the
    //    same types lock them in the same order and cannot deadlock.
    const byRoom = new Map<string, PreparedLine[]>();
    for (const l of p.lines) byRoom.set(l.dto.roomId, [...(byRoom.get(l.dto.roomId) ?? []), l]);
    const roomIds = [...byRoom.keys()].sort();
    if (meta.holdsInventory) {
      for (const roomId of roomIds) {
        const lines = byRoom.get(roomId)!;
        try {
          await reserveStay(tx, roomId, p.nights, lines.length);
        } catch (e) {
          if (e instanceof InsufficientAvailabilityError) {
            const name = lines[0]!.priced.roomName;
            throw new ConflictException({
              reason: 'insufficient_availability',
              message: `Not enough ${name} rooms free on ${e.date} for ${lines.length === 1 ? 'room' : 'rooms'} ${lines.map((l) => l.index + 1).join(', ')}.`,
              roomId,
              roomName: name,
              date: e.date,
              lines: lines.map((l) => l.index),
            });
          }
          throw e;
        }
        await enqueueOutbox(tx, {
          tenantId,
          aggregate: 'availability',
          aggregateId: roomId,
          eventType: 'ari.availability',
          payload: {
            propertyId: p.property.id,
            roomId,
            nights: p.nights,
            rooms: lines.length,
            action: 'reserve',
            origin: 'reservation',
          },
        });
      }
    }

    // 1b. A walk-in needs actual rooms: give every line without one the lowest free room of its type.
    const walkInUnits = new Map<number, { id: string; code: string }>();
    const warnings: string[] = [];
    if (dto.checkIn) {
      const taken = new Set(
        p.lines.map((l) => l.unit?.id).filter((id): id is string => Boolean(id)),
      );
      // Dirty as of today, carried forward from the room's last record (UX-1a).
      const asOf = await housekeepingAsOf(tx, p.property.id, dto.checkin);
      for (const l of p.lines) {
        const unit = l.unit ?? (await this.pickFreeUnit(tx, l, dto.checkin, dto.checkout, taken));
        taken.add(unit.id);
        walkInUnits.set(l.index, unit);
        if (asOf.get(unit.id)?.status === 'dirty')
          warnings.push(`Room ${unit.code} is marked dirty.`);
      }
      await assertRoomsReadyForCheckIn(
        tx,
        p.property.id,
        [...walkInUnits.values()].map((unit) => unit.id),
        dto.checkin,
      );
    }

    // 2. The guest, and each room's own guest when the Guest List is used. The reservation's
    //    guest owns the group; a room without its own guest is booked for them.
    const country = p.property.countryCode;
    const guest = await resolveGuest(tx, tenantId, dto.guest, country, { userId: actor.userId });
    const roomGuests = new Map<number, ResolvedGuest>();
    for (const l of p.lines) {
      if (!l.dto.guest) continue;
      roomGuests.set(
        l.index,
        await resolveGuest(tx, tenantId, l.dto.guest, country, {
          line: l.index,
          userId: actor.userId,
        }),
      );
    }

    // 3. References: one master, `<master>-n` for each room of a multi-room reservation.
    const master = await nextBookingReference(tx, p.calendarToday);
    const multi = p.lines.length > 1;
    const fxRateToLkr = await resolveFxRateToLkr(tx, p.property.currency);

    let groupId: string | null = null;
    if (multi) {
      const [group] = await tx
        .insert(bookingGroups)
        .values({
          tenantId,
          propertyId: p.property.id,
          code: master,
          name: dto.groupName ?? guest.name,
          kind: 'reservation',
          billTo: dto.billTo,
          ownerCustomerId: guest.id,
          businessSourceId: p.businessSourceId,
        })
        .returning({ id: bookingGroups.id });
      groupId = group!.id;
    }

    const options = resolveReservationOptions(dto.options ?? {});
    const created: Array<{ line: PreparedLine; booking: typeof bookings.$inferSelect }> = [];

    for (const l of p.lines) {
      const reference = multi ? `${master}-${l.index + 1}` : master;
      const snapshot: PricingSnapshot = {
        ...(l.priced.policyVersion
          ? {
              smart: {
                policyVersion: l.priced.policyVersion,
                guests: {
                  adults: l.dto.adults,
                  childAges: l.dto.childAges ?? [],
                  extraBeds: l.dto.extraBeds,
                  cots: l.dto.cots ?? 0,
                },
                nights: l.priced.nights.map((night) => ({
                  date: night.date,
                  quote: night.smartQuote,
                })),
              },
            }
          : {}),
        ...(l.dto.rate && l.priced.rateSource === 'override' && { override: l.dto.rate }),
        ...(dto.useContractRates && p.ledgerAccountId && { contractAccountId: p.ledgerAccountId }),
        ...(dto.complimentary && { complimentary: true }),
        ...(dto.taxExempt && {
          taxExempt: {
            exemptionId: dto.taxExempt.exemptionId,
            reason: dto.taxExempt.reason ?? null,
          },
        }),
        ...(dto.priceReason && { reason: dto.priceReason }),
        ...(Object.keys(approvedBy).length > 0 && { approvedBy }),
      };

      const [booking] = await tx
        .insert(bookings)
        .values({
          tenantId,
          propertyId: p.property.id,
          roomId: l.dto.roomId,
          occupancyId: l.dto.occupancyId,
          customerId: (roomGuests.get(l.index) ?? guest).id,
          groupId,
          businessSourceId: p.businessSourceId,
          ledgerAccountId: p.ledgerAccountId,
          reference,
          checkin: dto.checkin,
          checkout: dto.checkout,
          nights: p.nights.length,
          rooms: 1,
          status: meta.initialStatus,
          source: 'Extranet',
          amount: l.priced.amount,
          totalBasePrice: l.priced.totalBase,
          taxes: l.priced.taxes,
          commissionableAmount: l.priced.commissionable,
          discount: money(l.discount),
          currency: p.property.currency,
          fxRateToLkr,
          reservationKind: dto.kind,
          holdUntil: p.holdUntil,
          origin: p.origin,
          residency: p.residency,
          levyCollectedByChannel: p.levyCollectedByChannel,
          arrivalTime: dto.arrivalTime ? `${dto.arrivalTime}:00` : null,
          departureTime: dto.departureTime ? `${dto.departureTime}:00` : null,
          marketSegmentId: p.marketSegmentId,
          salesPersonId: p.salesPersonId,
          voucherNo: dto.voucherNo ?? null,
          isVip: dto.vip,
          createdByUserId: actor.userId,
          siblingIndex: multi ? l.index + 1 : null,
          pricing: snapshot as Record<string, unknown>,
          options: options as unknown as Record<string, unknown>,
        })
        .returning();

      // The leg: who sleeps in the room, and which room. A booking that takes rooms is assigned
      const exceptions = l.priced.nights.filter((night) => night.smartQuote?.belowMinimum);
      if (exceptions.length)
        await tx.insert(auditLog).values({
          tenantId,
          actorUserId: actor.userId,
          action: 'minimum_rate.exception',
          entity: 'booking',
          entityId: booking!.id,
          detail: {
            reason: l.dto.minimumExceptionReason,
            nights: exceptions.map((night) => ({ date: night.date, quote: night.smartQuote })),
            policyVersion: l.priced.policyVersion,
          },
        });
      // the room asked for; an inquiry only notes it as a preference.
      const leg = {
        tenantId,
        bookingId: booking!.id,
        legIndex: 0,
        checkin: dto.checkin,
        checkout: dto.checkout,
        adults: l.dto.adults,
        children: l.dto.children,
        childAges: l.dto.childAges ?? [],
        extraBeds: l.dto.extraBeds,
        roomUnitId: meta.holdsInventory ? ((walkInUnits.get(l.index) ?? l.unit)?.id ?? null) : null,
        preferredRoomUnitId: meta.holdsInventory ? null : (l.unit?.id ?? null),
      };
      try {
        // A savepoint, so the exclusion constraint's refusal becomes a clean 409 naming the room.
        await tx.transaction(async (sp) => {
          await sp.insert(bookingRooms).values(leg);
        });
      } catch (e) {
        if ((e as { code?: string })?.code === EXCLUSION_VIOLATION) {
          throw new ConflictException({
            reason: 'room_taken',
            message: `Room ${(walkInUnits.get(l.index) ?? l.unit)?.code} is no longer free for these dates (room ${l.index + 1}).`,
            line: l.index,
            roomUnitId: l.unit?.id,
          });
        }
        throw e;
      }

      await tx.insert(bookingDays).values(
        l.priced.nights.map((n) => ({
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
      await tx.insert(bookingApprovals).values({
        tenantId,
        bookingId: booking!.id,
        action: 'created',
        reason: meta.label,
        actorUserId: actor.userId,
      });

      // Notes for the whole reservation, then this room's own.
      const remarks = [...(dto.remarks ?? []), ...(l.dto.remarks ?? [])];
      if (remarks.length > 0) {
        await tx.insert(bookingRemarks).values(
          remarks.map((r) => ({
            tenantId,
            bookingId: booking!.id,
            type: r.type,
            text: r.text,
            createdByUserId: actor.userId,
          })),
        );
      }
      if (l.dto.tasks?.length) {
        await tx.insert(workOrders).values(
          l.dto.tasks.map((t) => ({
            tenantId,
            propertyId: p.property.id,
            bookingId: booking!.id,
            roomUnitId: meta.holdsInventory ? (l.unit?.id ?? null) : null,
            title: t.title,
            description: t.description ?? null,
            department: t.department,
            trigger: t.trigger,
            priority: t.priority,
            deadline: t.deadline ?? null,
            createdByUserId: actor.userId,
          })),
        );
      }
      if (l.dto.inclusions?.length) {
        await tx.insert(bookingInclusions).values(
          l.dto.inclusions.map((inc) => ({
            tenantId,
            bookingId: booking!.id,
            particularId: inc.particularId ?? null,
            name: inc.name,
            rhythm: inc.rhythm,
            unitPrice: money(inc.unitPrice),
            discountPct: inc.discountPct.toFixed(3),
            taxRatePct: inc.taxRatePct.toFixed(3),
            includedInRate: inc.includedInRate,
            itemize: inc.itemize,
            createdByUserId: actor.userId,
          })),
        );
      }
      // The rate type's bundled add-ons (Configuration → Rate types, 2026-09-26): the guest pays
      // one price that includes them, so they go on the stay as INCLUDED inclusions — shown on the
      // stay and its registration card, never posted again.
      const [rateType] = await tx
        .select({ addOns: rateTypes.addOns })
        .from(ratePlans)
        .innerJoin(rateTypes, eq(rateTypes.id, ratePlans.rateTypeId))
        .where(eq(ratePlans.id, l.priced.ratePlanId));
      if (rateType?.addOns.length) {
        await tx.insert(bookingInclusions).values(
          rateType.addOns.map((a) => ({
            tenantId,
            bookingId: booking!.id,
            particularId: a.chargeParticularId ?? null,
            name: a.name,
            rhythm: a.rhythm,
            unitPrice: money(Number(a.amount) || 0),
            includedInRate: true,
            itemize: false,
            createdByUserId: actor.userId,
          })),
        );
      }
      if (l.dto.transfers?.length) {
        for (const t of l.dto.transfers) {
          if (t.transportModeId) await this.loadTransportMode(tx, t.transportModeId);
        }
        await tx.insert(bookingTransfers).values(
          l.dto.transfers.map((t) => ({
            tenantId,
            bookingId: booking!.id,
            direction: t.direction,
            transportModeId: t.transportModeId ?? null,
            scheduledAt: t.scheduledAt ? new Date(t.scheduledAt) : null,
            fromPlace: t.fromPlace ?? null,
            toPlace: t.toPlace ?? null,
            flightNo: t.flightNo ?? null,
            pax: t.pax,
            vehicle: t.vehicle ?? null,
            driver: t.driver ?? null,
            amount: money(t.amount),
            notes: t.notes ?? null,
            createdByUserId: actor.userId,
          })),
        );
      }
      created.push({ line: l, booking: booking! });
    }

    // 4. Coupon and referral, as the walk-in records them.
    if (p.coupon) {
      for (const c of created) {
        await tx.insert(couponRedemptions).values({
          tenantId,
          couponId: p.coupon.id,
          bookingId: c.booking.id,
          amount: money(c.line.discount),
        });
      }
      await tx
        .update(coupons)
        .set({ usedCount: sql`${coupons.usedCount} + 1` })
        .where(eq(coupons.id, p.coupon.id));
    }
    if (p.referral) {
      for (const c of created) {
        await tx.insert(referralCommissions).values({
          tenantId,
          referralPartnerId: p.referral.partnerId,
          bookingId: c.booking.id,
          amount: referralCommission(c.line.priced.raw.commissionable, p.referral.pct).toFixed(2),
        });
      }
    }

    // 4b. Who pays: every room's bill (window 1) gets its payer now, from Bill To. With "room and
    //     tax to the company", the guest gets window 2 and the extras route to it.
    const account = companyBill
      ? (
          await tx.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, p.ledgerAccountId!))
        )[0]!
      : null;
    const windowOne = new Map<string, string>();
    for (const c of created) {
      const roomGuest = (roomGuests.get(c.line.index) ?? guest).id;
      const b = { id: c.booking.id, propertyId: p.property.id, currency: p.property.currency };
      const w1 = account
        ? await ensureWindow(tx, tenantId, b, 1, account.name, {
            payerType: account.type === 'travel_agent' ? 'travel_agent' : 'company',
            payerLedgerAccountId: account.id,
          })
        : await ensureWindow(tx, tenantId, b, 1, 'Guest', {
            payerType: 'guest',
            payerCustomerId: dto.billTo === 'group_owner' ? guest.id : roomGuest,
          });
      windowOne.set(c.booking.id, w1.id);
      if (dto.billTo === 'company_room_tax') {
        await ensureWindow(tx, tenantId, b, 2, 'Guest (extras)', {
          payerType: 'guest',
          payerCustomerId: roomGuest,
          routes: ['manual', 'pos', 'inclusion'],
        });
      }
    }

    // 4c. Money taken with the reservation, spread over the rooms in proportion to what each costs,
    //     under one receipt.
    let paymentTaken: { receiptNo: string | null; amount: string; method: string } | null = null;
    if (dto.payment) {
      const method = await resolvePaymentMethod(tx, dto.payment.paymentMethodId, p.property.id);
      const dues = created.map((c) => Number(c.booking.amount) - Number(c.booking.discount));
      const shares =
        created.length === 1 ? [dto.payment.amount] : splitProportional(dto.payment.amount, dues);
      const allocationGroupId = created.length > 1 ? randomUUID() : null;
      if (method.category === 'city_ledger') {
        assertCityLedger(features!.cashiering);
        if (!p.ledgerAccountId) {
          throw new BadRequestException('City ledger needs the travel agent or company');
        }
        for (const [i, c] of created.entries()) {
          if (shares[i]! <= 0) continue;
          await chargeToAccountWithin(tx, {
            tenantId,
            userId: actor.userId,
            bookingId: c.booking.id,
            folioId: windowOne.get(c.booking.id)!,
            ledgerAccountId: p.ledgerAccountId,
            amount: shares[i]!,
            currency: p.property.currency,
            description: `Reservation ${c.booking.reference}`,
            reference: dto.payment.reference ?? dto.voucherNo ?? null,
            enforceCreditLimit: true,
            allocationGroupId,
          });
        }
        paymentTaken = { receiptNo: null, amount: money(dto.payment.amount), method: method.name };
      } else {
        const drawerSessionId =
          method.method === 'cash'
            ? await resolveDrawerSession(tx, {
                propertyId: p.property.id,
                userId: actor.userId,
                drawerSessionId: dto.payment.drawerSessionId,
                required: features!.cashiering,
              })
            : null;
        const receiptNo = await nextReceiptNo(tx, {
          tenantId,
          propertyId: p.property.id,
          date: p.businessDate,
        });
        for (const [i, c] of created.entries()) {
          if (shares[i]! <= 0) continue;
          await insertPayment(tx, {
            tenantId,
            propertyId: p.property.id,
            userId: actor.userId,
            bookingId: c.booking.id,
            folioId: windowOne.get(c.booking.id)!,
            amount: shares[i]!,
            currency: p.property.currency,
            method,
            reference: dto.payment.reference ?? null,
            fileId: dto.payment.fileId ?? null,
            drawerSessionId,
            receiptNo,
            allocationGroupId,
            businessDate: p.businessDate,
          });
        }
        paymentTaken = { receiptNo, amount: money(dto.payment.amount), method: method.name };
      }
    }

    // 4d. A walk-in is checked in now, in the same transaction: all rooms or none.
    if (dto.checkIn) {
      for (const c of created) {
        // The walk-in desk has already been warned about a dirty room (the `warnings` above), and
        // the guest is standing there: it proceeds, on the record, rather than refusing.
        await this.bookingService.transitionWithin(
          tx,
          tenantId,
          c.booking.id,
          'check_in',
          'walk-in',
          { actorUserId: actor.userId, overrideDirty: true },
        );
      }
    }

    // 5. A price decision is on the record: who made it, who approved it, and why.
    if (p.reasonRequired) {
      await tx.insert(auditLog).values({
        tenantId,
        actorUserId: actor.userId,
        action: 'reservation.price_decision',
        entity: 'reservation',
        entityId: master,
        detail: {
          complimentary: dto.complimentary,
          taxExempt: dto.taxExempt ?? null,
          reason: dto.priceReason ?? null,
          approvedBy,
          lines: p.lines.map((l) => ({
            room: l.index + 1,
            rateSource: l.priced.rateSource,
            listAmount: l.priced.listAmount,
            amount: l.priced.amount,
            discountPct: l.priced.discountPct,
          })),
        },
      });
    }

    // 6. One notification and one confirmation for the whole reservation.
    const symbol = isCurrencyCode(p.property.currency)
      ? CURRENCY_META[p.property.currency].symbol
      : p.property.currency;
    await tx.insert(notifications).values({
      tenantId,
      type: 'booking_created',
      title: multi
        ? `New reservation ${master} · ${created.length} rooms`
        : `New reservation ${master}`,
      body: `${guest.name} · ${dto.checkin} → ${dto.checkout} · ${symbol} ${money(p.totals.due)} · ${meta.label}`,
      entity: 'booking',
      entityId: created[0]!.booking.id,
    });
    // "Email booking vouchers" sends the voucher (Sprint 6) to the addresses asked for — the guest
    // included, when no address is given — in place of the plain confirmation to those addresses.
    let voucherTo: string[] = [];
    if (options.emailVoucher) {
      voucherTo = options.voucherEmails.length
        ? options.voucherEmails
        : guest.email
          ? [guest.email.toLowerCase()]
          : [];
      const voucher = await buildVoucher(tx, created[0]!.booking.id);
      if (voucher) await queueVoucher(tx, voucher, voucherTo, null);
    }
    if (guest.email && !voucherTo.includes(guest.email.toLowerCase())) {
      const [tpl] = await tx
        .select()
        .from(templates)
        .where(and(eq(templates.key, 'booking_created'), eq(templates.language, 'en')));
      if (tpl) {
        const vars = {
          guestName: guest.name,
          reference: master,
          propertyName: p.property.name,
          // `total` carries the booking's own currency; `amount` stays for templates written before.
          total: guestMoney(p.totals.due, p.property.currency),
          amount: money(p.totals.due),
          checkin: dto.checkin,
          checkout: dto.checkout,
          nights: p.nights.length,
        };
        await tx.insert(messages).values({
          tenantId,
          bookingId: created[0]!.booking.id,
          channel: 'email',
          toAddress: guest.email,
          templateKey: 'booking_created',
          language: 'en',
          subject: renderTemplate(tpl.subject, vars),
          body: renderTemplate(tpl.body, vars),
          status: 'queued',
        });
      }
    }

    return {
      reference: master,
      groupId,
      kind: dto.kind,
      status: dto.checkIn ? 'CheckedIn' : meta.initialStatus,
      checkedIn: dto.checkIn,
      billTo: dto.billTo,
      payment: paymentTaken,
      warnings,
      holdUntil: p.holdUntil?.toISOString() ?? null,
      currency: p.property.currency,
      total: money(p.totals.amount),
      taxes: money(p.totals.taxes),
      discount: money(p.totals.discount),
      due: money(p.totals.due),
      listTotal: money(p.totals.listAmount),
      guest: { id: guest.id, name: guest.name, created: guest.created },
      bookings: created.map(({ line, booking }) => ({
        id: booking.id,
        reference: booking.reference,
        siblingIndex: booking.siblingIndex,
        roomId: line.priced.roomId,
        roomName: line.priced.roomName,
        occupancyId: line.priced.occupancyId,
        rateCode: line.priced.rateCode,
        roomUnitId: meta.holdsInventory
          ? ((walkInUnits.get(line.index) ?? line.unit)?.id ?? null)
          : null,
        roomCode: meta.holdsInventory
          ? ((walkInUnits.get(line.index) ?? line.unit)?.code ?? null)
          : null,
        guestName: (roomGuests.get(line.index) ?? guest).name,
        amount: booking.amount,
        taxes: booking.taxes,
        discount: booking.discount,
        nights: booking.nights,
      })),
    };
  }

  // --- Shared preparation ------------------------------------------------------

  /**
   * Everything a reservation needs decided before anything is written: the property and its
   * settings, the dates, every referenced id (loaded under RLS — a foreign key would accept
   * another tenant's id), the price of every room, and what the desk is allowed to do about it.
   */
  private async prepare(
    tx: Tx,
    actor: Actor,
    dto: QuoteReservationDto | CreateReservationDto,
  ): Promise<Prepared> {
    const [property] = await tx.select().from(properties).where(eq(properties.id, dto.propertyId));
    if (!property) throw new NotFoundException('Property not found');
    const [tenant] = await tx
      .select({ mode: tenants.distributionMode })
      .from(tenants)
      .where(eq(tenants.id, actor.tenantId));
    const mode: DistributionModeLike = tenant?.mode ?? 'yoho';
    const settings = resolvePropertySettings(property.settings);

    const businessDate = (await propertyBusinessDate(tx, property.id, property.timezone)).date;
    const calendarToday = localToday(property.timezone);
    if (dto.checkin < businessDate) {
      throw new BadRequestException({
        reason: 'checkin_in_past',
        message: `Check-in cannot be before the hotel's date (${businessDate})`,
      });
    }
    const nights = eachNight(dto.checkin, dto.checkout);

    // The kind decides whether there is a release time.
    const meta = RESERVATION_KIND_META[dto.kind];
    let holdUntil: Date | null = null;
    if (meta.isHold) {
      if (dto.holdUntil === undefined) {
        holdUntil = new Date(Date.now() + settings.hold.defaultHours * 3_600_000);
      } else if (dto.holdUntil !== null) {
        holdUntil = new Date(dto.holdUntil);
        if (holdUntil.getTime() <= Date.now()) {
          throw new BadRequestException('The hold must release in the future');
        }
      }
    } else if (dto.holdUntil) {
      throw new BadRequestException('Only a hold has a release time');
    }

    // Contract rates are part of the city ledger: say so before looking anything up.
    if (dto.useContractRates) {
      const { features } = await this.billing.entitlements(actor.tenantId, tx);
      if (!features.cashiering) {
        throw new ForbiddenException(
          'Contract rates are part of the Pro plan (city ledger). Upgrade to enable them.',
        );
      }
    }

    // Referenced lists, each checked under RLS.
    let source: typeof businessSources.$inferSelect | null = null;
    if (dto.businessSourceId) {
      [source] = await tx
        .select()
        .from(businessSources)
        .where(eq(businessSources.id, dto.businessSourceId));
      if (!source) throw new NotFoundException('Business source not found');
      if (!source.active) throw new BadRequestException(`${source.name} is not active`);
      if (dto.origin && dto.origin !== source.category) {
        throw new BadRequestException(
          `${source.name} is a ${source.category.replace('_', ' ')} source, not ${dto.origin.replace('_', ' ')}`,
        );
      }
    }
    let account: typeof ledgerAccounts.$inferSelect | null = null;
    if (dto.ledgerAccountId) {
      [account] = await tx
        .select()
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.id, dto.ledgerAccountId));
      if (!account || (account.type !== 'travel_agent' && account.type !== 'company')) {
        throw new NotFoundException('Travel agent or company not found');
      }
      if (!account.active) throw new BadRequestException(`${account.name} is not active`);
    }
    if (dto.salesPersonId) {
      const [person] = await tx
        .select({
          type: ledgerAccounts.type,
          active: ledgerAccounts.active,
          name: ledgerAccounts.name,
        })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.id, dto.salesPersonId));
      if (!person || person.type !== 'sales_person') {
        throw new NotFoundException('Sales person not found');
      }
      if (!person.active) throw new BadRequestException(`${person.name} is not active`);
    }
    if (dto.marketSegmentId) {
      const [seg] = await tx
        .select({ active: marketSegments.active, name: marketSegments.name })
        .from(marketSegments)
        .where(eq(marketSegments.id, dto.marketSegmentId));
      if (!seg) throw new NotFoundException('Market segment not found');
      if (!seg.active) throw new BadRequestException(`${seg.name} is not active`);
    }

    const origin: BookingOrigin =
      dto.origin ??
      (source?.category as BookingOrigin | undefined) ??
      (account ? (account.type === 'travel_agent' ? 'travel_agent' : 'corporate') : 'direct');

    const policyOf = (line: LineDto): PricingPolicy => ({
      override: line.rate ?? null,
      contractAccountId: dto.useContractRates ? (dto.ledgerAccountId ?? null) : null,
      complimentary: dto.complimentary,
      taxExempt: Boolean(dto.taxExempt),
    });

    // Every room, priced.
    const holds = meta.holdsInventory;
    const lines: PreparedLine[] = [];
    for (let i = 0; i < dto.lines.length; i++) {
      const line = dto.lines[i]!;
      if (actor.permissions && line.rate && !actor.permissions.includes('price_change'))
        throw new ForbiddenException('Your role cannot change reservation prices.');
      // The room type's own limits (Configuration → Room types, 2026-09-26): one switched off is
      // not sold, and one that takes at most N adults or children refuses more.
      const [limits] = await tx
        .select({
          name: rooms.name,
          active: rooms.active,
          maxAdults: rooms.maxAdults,
          maxChildren: rooms.maxChildren,
        })
        .from(rooms)
        .where(eq(rooms.id, line.roomId));
      if (limits && !limits.active)
        throw new BadRequestException({
          message: `Room ${i + 1}: ${limits.name} is not being sold. Switch it on under Configuration → Room types.`,
          line: i,
        });
      if (limits?.maxAdults != null && line.adults > limits.maxAdults)
        throw new BadRequestException({
          message: `Room ${i + 1}: ${limits.name} takes at most ${limits.maxAdults} adult${limits.maxAdults === 1 ? '' : 's'}.`,
          field: 'adults',
          line: i,
        });
      if (limits?.maxChildren != null && line.children > limits.maxChildren)
        throw new BadRequestException({
          message:
            limits.maxChildren === 0
              ? `Room ${i + 1}: ${limits.name} does not take children.`
              : `Room ${i + 1}: ${limits.name} takes at most ${limits.maxChildren} child${limits.maxChildren === 1 ? '' : 'ren'}.`,
          field: 'children',
          line: i,
        });
      if (line.childAges && line.childAges.length !== line.children)
        throw new BadRequestException({
          message: `Room ${i + 1}: enter an age for every child.`,
          field: 'childAges',
          line: i,
        });
      const priced = await this.pricer.priceLine(
        tx,
        {
          roomId: line.roomId,
          occupancyId: line.occupancyId,
          checkin: dto.checkin,
          checkout: dto.checkout,
          rooms: 1,
          guests:
            line.children === (line.childAges?.length ?? 0)
              ? {
                  adults: line.adults,
                  childAges: line.childAges ?? [],
                  extraBeds: line.extraBeds,
                  cots: line.cots ?? 0,
                }
              : undefined,
          minimumException: line.minimumExceptionReason
            ? {
                authorized:
                  actor.role === 'OWNER' || !!actor.permissions?.includes('minimum_exception'),
                reason: line.minimumExceptionReason,
              }
            : undefined,
          policy: policyOf(line),
          residency: dto.residency ?? null,
          checkAudience: true,
          requireActivePlan: true,
          checkRestrictions: true,
          lineIndex: i,
        },
        mode,
      );
      if (priced.propertyId !== property.id) {
        throw new BadRequestException(`Room ${i + 1}: that room type belongs to another property`);
      }
      const unit = line.roomUnitId
        ? await this.checkUnit(
            tx,
            line.roomUnitId,
            line.roomId,
            dto.checkin,
            dto.checkout,
            holds,
            i,
          )
        : null;
      lines.push({ index: i, dto: line, priced, unit, discount: 0 });
    }

    // Coupon: off the reservation total, shared across the rooms in proportion to their price.
    // One room is exactly the walk-in's arithmetic.
    let coupon: Prepared['coupon'] = null;
    if (dto.couponCode) {
      const code = dto.couponCode.trim().toUpperCase();
      const [c] = await tx.select().from(coupons).where(eq(coupons.code, code));
      if (!c || !c.active) throw new BadRequestException('Invalid coupon code');
      if (calendarToday < c.startDate || calendarToday > c.endDate) {
        throw new BadRequestException('Coupon is not valid today');
      }
      if (c.maxUses > 0 && c.usedCount >= c.maxUses) {
        throw new BadRequestException('Coupon usage limit reached');
      }
      if (c.propertyId && c.propertyId !== property.id) {
        throw new BadRequestException('Coupon is not valid for this property');
      }
      const rawTotal = lines.reduce((s, l) => s + l.priced.raw.amount, 0);
      const discount = couponDiscount(rawTotal, c.type, Number(c.value));
      const shares =
        lines.length === 1
          ? [discount]
          : splitProportional(
              discount,
              lines.map((l) => Number(l.priced.amount)),
            );
      lines.forEach((l, i) => (l.discount = shares[i]!));
      coupon = { id: c.id, discount };
    }
    // Apply a coupon to every affected night before checking the protected net amount.
    for (const line of lines.filter((item) => item.priced.policyVersion && item.discount > 0)) {
      const discounts = splitProportional(
        line.discount,
        line.priced.nights.map((night) => Number(night.sellingPrice)),
      );
      line.priced.nights.forEach((night, index) => {
        const quote = night.smartQuote!;
        const selling = Number(night.sellingPrice);
        const netAfterDiscount = Math.round(
          Number(night.basePrice) * 100 * (selling ? (selling - discounts[index]!) / selling : 0),
        );
        if (netAfterDiscount - quote.bedNetMinor < quote.minimumNetMinor) {
          if (
            !(actor.role === 'OWNER' || actor.permissions?.includes('minimum_exception')) ||
            !line.dto.minimumExceptionReason?.trim()
          )
            throw new BadRequestException({
              reason: 'minimum_net_rate',
              message: `${night.date}: the coupon would put room and meals below the hotel minimum.`,
              line: line.index,
            });
          quote.belowMinimum = true;
          quote.exceptionReason = line.dto.minimumExceptionReason.trim();
        }
      });
    }
    let referral: Prepared['referral'] = null;
    if (dto.referralCode) {
      const code = dto.referralCode.trim().toUpperCase();
      const [r] = await tx.select().from(referralPartners).where(eq(referralPartners.code, code));
      if (!r || !r.active) throw new BadRequestException('Invalid referral code');
      referral = { partnerId: r.id, pct: Number(r.commissionPct) };
    }

    const amount = sumMoney(lines.map((l) => Number(l.priced.amount)));
    const taxes = sumMoney(lines.map((l) => Number(l.priced.taxes)));
    const listAmount = sumMoney(lines.map((l) => Number(l.priced.listAmount)));
    const discount = sumMoney(lines.map((l) => l.discount));

    // Price authority. Owners are never limited; staff may discount up to the property's limit
    // and give complimentary rooms only when allowed. A contract rate is pre-agreed, not a
    // discount the desk is making.
    const overrides = lines.filter((l) => l.priced.rateSource === 'override');
    const hasOverride = overrides.length > 0;
    const worstDiscount = Math.max(0, ...overrides.map((l) => l.priced.discountPct));
    const approvalsRequired: PriceApproval[] = [];
    if (actor.role !== 'OWNER') {
      if (hasOverride && worstDiscount > settings.rateControl.staffMaxDiscountPct + 1e-9) {
        approvalsRequired.push('rate_override');
      }
      if (dto.complimentary && !settings.rateControl.staffCanComp) {
        approvalsRequired.push('complimentary');
      }
      if (dto.taxExempt) approvalsRequired.push('tax_exempt');
    }
    const reasonRequired = hasOverride || dto.complimentary || Boolean(dto.taxExempt);

    const marketSegmentId =
      dto.marketSegmentId ??
      lines[0]?.priced.marketSegmentId ??
      account?.defaultMarketSegmentId ??
      source?.defaultMarketSegmentId ??
      null;

    return {
      property,
      settings,
      mode,
      businessDate,
      calendarToday,
      nights,
      holdUntil,
      origin,
      businessSourceId: source?.id ?? null,
      levyCollectedByChannel: source?.collectsTourismTax ?? false,
      ledgerAccountId: account?.id ?? null,
      salesPersonId: dto.salesPersonId ?? null,
      marketSegmentId,
      residency: dto.residency ?? null,
      lines,
      coupon,
      referral,
      totals: { amount, taxes, listAmount, discount, due: sumMoney([amount, -discount]) },
      approvalsRequired,
      reasonRequired,
      policyOf,
    };
  }

  /** A room the desk picked: it must be this room type's, in service, and (to take it) free. */
  private async checkUnit(
    tx: Tx,
    unitId: string,
    roomId: string,
    checkin: string,
    checkout: string,
    take: boolean,
    index: number,
  ) {
    const [unit] = await tx.select().from(roomUnits).where(eq(roomUnits.id, unitId));
    if (!unit) throw new NotFoundException(`Room ${index + 1}: that room was not found`);
    if (unit.roomId !== roomId) {
      throw new BadRequestException(`Room ${index + 1}: room ${unit.code} is another room type`);
    }
    if (!take) return { id: unit.id, code: unit.code };
    if (unit.status !== 'active') {
      throw new BadRequestException(`Room ${index + 1}: room ${unit.code} is out of service`);
    }
    const [blocked] = await tx
      .select({ reason: maintenanceBlocks.reason })
      .from(maintenanceBlocks)
      .where(
        and(
          eq(maintenanceBlocks.roomUnitId, unitId),
          isNull(maintenanceBlocks.releasedAt),
          sql`daterange(${maintenanceBlocks.blockFrom}, ${maintenanceBlocks.blockTo}, '[)')
              && daterange(${checkin}::date, ${checkout}::date, '[)')`,
        ),
      )
      .limit(1);
    if (blocked) {
      throw new ConflictException({
        reason: 'room_blocked',
        message: `Room ${unit.code} is blocked for those dates: ${blocked.reason}`,
        line: index,
      });
    }
    return { id: unit.id, code: unit.code };
  }

  /** Verify the owner approvals the desk needs; returns who approved each action. */
  private async verifyApprovals(
    actor: Actor,
    dto: CreateReservationDto,
    p: Prepared,
  ): Promise<Record<string, string>> {
    if (p.reasonRequired && !dto.priceReason) {
      throw new BadRequestException({
        reason: 'price_reason_required',
        message: 'Give a reason for the changed price',
      });
    }
    const missing = p.approvalsRequired.filter((a) => !dto.approvals?.[a]);
    if (missing.length > 0) {
      throw new ForbiddenException({
        reason: 'approval_required',
        actions: missing,
        message: 'An owner needs to approve this price before it can be saved',
      });
    }
    const approvedBy: Record<string, string> = {};
    for (const action of p.approvalsRequired) {
      const ok = await this.stepUp.verify(dto.approvals![action]!, {
        tenantId: actor.tenantId,
        action,
        requesterId: actor.userId,
      });
      approvedBy[action] = ok.approverId;
    }
    return approvedBy;
  }

  /**
   * The lowest-numbered room of a line's type that is in service, not blocked and not occupied for
   * the stay. The exclusion constraint on booking_rooms still has the last word if two desks pick
   * the same room at once.
   */
  private async pickFreeUnit(
    tx: Tx,
    line: PreparedLine,
    checkin: string,
    checkout: string,
    taken: Set<string>,
  ) {
    const free = await tx
      .select({ id: roomUnits.id, code: roomUnits.code })
      .from(roomUnits)
      .where(
        and(
          eq(roomUnits.roomId, line.dto.roomId),
          eq(roomUnits.status, 'active'),
          sql`not exists (
            select 1 from booking_rooms br
            where br.room_unit_id = room_units.id and br.released_at is null
              and daterange(br.checkin, br.checkout, '[)') && daterange(${checkin}::date, ${checkout}::date, '[)')
          )`,
          sql`not exists (
            select 1 from maintenance_blocks mb
            where mb.room_unit_id = room_units.id and mb.released_at is null
              and daterange(mb.block_from, mb.block_to, '[)') && daterange(${checkin}::date, ${checkout}::date, '[)')
          )`,
        ),
      )
      .orderBy(asc(roomUnits.displayOrder));
    let firstNotReady: { id: string; code: string } | undefined;
    let unit: { id: string; code: string } | undefined;
    for (const candidate of free) {
      if (taken.has(candidate.id)) continue;
      try {
        await assertRoomsReadyForCheckIn(tx, line.priced.propertyId, [candidate.id], checkin);
        unit = candidate;
        break;
      } catch (error) {
        if (
          error instanceof ConflictException &&
          (error.getResponse() as { reason?: string }).reason === 'room_not_ready'
        ) {
          firstNotReady ??= candidate;
          continue;
        }
        throw error;
      }
    }
    if (!unit) {
      if (firstNotReady) {
        await assertRoomsReadyForCheckIn(tx, line.priced.propertyId, [firstNotReady.id], checkin);
      }
      throw new ConflictException({
        reason: 'no_room_free',
        message: `No ${line.priced.roomName} room is free to check room ${line.index + 1} into.`,
        line: line.index,
      });
    }
    return unit;
  }

  private async loadTransportMode(tx: Tx, id: string) {
    const [m] = await tx.select().from(transportModes).where(eq(transportModes.id, id));
    if (!m) throw new NotFoundException('Transport mode not found');
    return m;
  }

  /** Rooms of each type free on every night (a closed or unopened night counts as none). */
  private async freeRooms(tx: Tx, roomIds: string[], nights: string[]) {
    const out = new Map<string, number>();
    if (roomIds.length === 0) return out;
    const rows = await tx
      .select({
        roomId: availabilityCalendar.roomId,
        free: sql<number>`min(case when ${availabilityCalendar.status} = 'Open' then ${availabilityCalendar.roomsToSell} else 0 end)::int`,
        days: sql<number>`count(*)::int`,
      })
      .from(availabilityCalendar)
      .where(
        and(
          inArray(availabilityCalendar.roomId, roomIds),
          inArray(availabilityCalendar.date, nights),
        ),
      )
      .groupBy(availabilityCalendar.roomId);
    for (const r of rows) out.set(r.roomId, r.days === nights.length ? r.free : 0);
    return out;
  }

  /** Each tax across the whole reservation, for the Billing Summary. */
  private sumTaxLines(lines: PreparedLine[]) {
    const byKey = new Map<string, { key: string; name: string; rate: number; cents: number }>();
    for (const l of lines) {
      for (const n of l.priced.nights) {
        for (const t of n.taxLines as TaxLine[]) {
          const e = byKey.get(t.key) ?? { key: t.key, name: t.name, rate: t.rate, cents: 0 };
          e.cents += Math.round(t.amount * 100);
          byKey.set(t.key, e);
        }
      }
    }
    return [...byKey.values()].map((e) => ({
      key: e.key,
      name: e.name,
      rate: e.rate,
      amount: money(e.cents / 100),
    }));
  }
}
