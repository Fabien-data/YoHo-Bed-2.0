import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import {
  bookingDays,
  bookings,
  businessDates,
  cashDrawers,
  chargeParticulars,
  customers,
  drawerSessions,
  folioCharges,
  folioTransfers,
  folios,
  ledgerAccounts,
  paymentMethods,
  payments,
  properties,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { localToday, propertyBusinessDate } from '../common/local-date';
import {
  insertPayment,
  insertRefund,
  resolveDrawerSession,
  resolvePaymentMethod,
} from '../payments/take-payment';
import { StepUpService } from '../auth/step-up.service';
import type {
  CreateParticularDto,
  OpenFolioDto,
  PostChargeDto,
  RecordFolioPaymentDto,
  RefundDto,
  TransferChargesDto,
  VoidChargeDto,
} from './dto';

/** Two decimal places, the way every money column in this system is stored. */
function money(n: number): string {
  return n.toFixed(2);
}

@Injectable()
export class FolioService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly stepUp: StepUpService,
  ) {}

  /**
   * The bill for a booking: every window, its lines, its payments and its balance.
   *
   * Window 1 is created on demand rather than at booking time, so a reservation that never
   * arrives leaves no empty bill behind.
   */
  async forBooking(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      await this.ensureWindow(tx, tenantId, booking, 1, 'Guest');

      const windows = await tx
        .select()
        .from(folios)
        .where(eq(folios.bookingId, bookingId))
        .orderBy(asc(folios.window));

      const detailed = await Promise.all(windows.map((f) => this.windowDetail(tx, f)));

      const totals = detailed.reduce(
        (acc, w) => ({
          charges: acc.charges + Number(w.totals.charges),
          paid: acc.paid + Number(w.totals.paid),
          balance: acc.balance + Number(w.totals.balance),
        }),
        { charges: 0, paid: 0, balance: 0 },
      );

      return {
        bookingId,
        reference: booking.reference,
        guestName: booking.guestName,
        status: booking.status,
        currency: booking.currency,
        checkin: booking.checkin,
        checkout: booking.checkout,
        rooms: booking.rooms,
        /** What the reservation itself is worth — the yardstick room charges must reproduce. */
        bookingAmount: booking.amount,
        windows: detailed,
        totals: {
          charges: money(totals.charges),
          paid: money(totals.paid),
          balance: money(totals.balance),
        },
      };
    });
  }

  private async windowDetail(tx: Tx, folio: typeof folios.$inferSelect) {
    const [lines, paid] = await Promise.all([
      tx
        .select({
          id: folioCharges.id,
          source: folioCharges.source,
          description: folioCharges.description,
          postedFor: folioCharges.postedFor,
          bookingDate: folioCharges.bookingDate,
          quantity: folioCharges.quantity,
          unitPrice: folioCharges.unitPrice,
          net: folioCharges.net,
          tax: folioCharges.tax,
          total: folioCharges.total,
          voidedAt: folioCharges.voidedAt,
          voidReason: folioCharges.voidReason,
          particularCode: chargeParticulars.code,
        })
        .from(folioCharges)
        .leftJoin(chargeParticulars, eq(chargeParticulars.id, folioCharges.particularId))
        .where(eq(folioCharges.folioId, folio.id))
        .orderBy(asc(folioCharges.postedFor), asc(folioCharges.createdAt)),
      // Money in, and money given back (a refund is a `sent` row on the same window, UX-1b).
      tx
        .select({
          id: payments.id,
          direction: payments.direction,
          amount: payments.amount,
          method: payments.method,
          methodName: paymentMethods.name,
          reference: payments.reference,
          note: payments.note,
          receiptNo: payments.receiptNo,
          attachmentFileId: payments.attachmentFileId,
          ledgerAccountId: payments.ledgerAccountId,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .leftJoin(paymentMethods, eq(paymentMethods.id, payments.paymentMethodId))
        .where(eq(payments.folioId, folio.id))
        .orderBy(desc(payments.createdAt)),
    ]);
    // Who this window bills — a name to print, not just a type.
    const payerName = folio.payerLedgerAccountId
      ? ((
          await tx
            .select({ name: ledgerAccounts.name })
            .from(ledgerAccounts)
            .where(eq(ledgerAccounts.id, folio.payerLedgerAccountId))
        )[0]?.name ?? null)
      : folio.payerCustomerId
        ? ((
            await tx
              .select({ name: customers.name })
              .from(customers)
              .where(eq(customers.id, folio.payerCustomerId))
          )[0]?.name ?? null)
        : null;

    // Voided lines stay on the bill but carry no money.
    const live = lines.filter((l) => !l.voidedAt);
    const charges = live.reduce((s, l) => s + Number(l.total), 0);
    const tax = live.reduce((s, l) => s + Number(l.tax), 0);
    const paidTotal = paid.reduce(
      (s, p) => s + (p.direction === 'received' ? Number(p.amount) : -Number(p.amount)),
      0,
    );

    return {
      id: folio.id,
      window: folio.window,
      label: folio.label,
      status: folio.status,
      currency: folio.currency,
      payerType: folio.payerType,
      payerName,
      payerLedgerAccountId: folio.payerLedgerAccountId,
      routes: folio.routes,
      lines,
      payments: paid,
      totals: {
        charges: money(charges),
        tax: money(tax),
        paid: money(paidTotal),
        balance: money(charges - paidTotal),
      },
    };
  }

  /** Open an extra window — the company bill beside the guest's. */
  async openWindow(tenantId: string, bookingId: string, dto: OpenFolioDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${folios.window}), 0)::int` })
        .from(folios)
        .where(eq(folios.bookingId, bookingId));
      const created = await this.ensureWindow(
        tx,
        tenantId,
        booking,
        (max ?? 0) + 1,
        dto.label ?? 'Company',
      );
      return created;
    });
  }

  /**
   * Post the room charges for a stay, one line per night.
   *
   * Copied from the `booking_days` snapshot — the money engine already decided what each night
   * costs, and recomputing would be a second answer waiting to disagree with settlement. The
   * snapshot is **per room per night**, so each line is multiplied by the booking's room count;
   * the sum of the posted lines therefore equals `bookings.amount` exactly.
   *
   * Idempotent: a unique index refuses a second live room charge for the same night, so calling
   * this twice cannot double a guest's bill.
   */
  async postRoomCharges(tenantId: string, bookingId: string, userId: string | null) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const booking = await this.loadBooking(tx, bookingId);
      if (booking.status === 'Cancelled' || booking.status === 'Rejected') {
        throw new BadRequestException(`Cannot post charges to a ${booking.status} booking`);
      }
      const folio = await this.ensureWindow(tx, tenantId, booking, 1, 'Guest');

      const nights = await tx
        .select()
        .from(bookingDays)
        .where(eq(bookingDays.bookingId, bookingId))
        .orderBy(asc(bookingDays.date));

      // Dedupe across EVERY window of the booking, not just window 1 — a room charge that was
      // transferred to the company window is still posted, and checking only this folio would
      // bill the night a second time (the unique index is per-folio, so it cannot catch this).
      const already = await tx
        .select({ bookingDate: folioCharges.bookingDate })
        .from(folioCharges)
        .innerJoin(folios, eq(folios.id, folioCharges.folioId))
        .where(
          and(
            eq(folios.bookingId, bookingId),
            eq(folioCharges.source, 'room'),
            isNull(folioCharges.voidedAt),
          ),
        );
      const posted = new Set(already.map((a) => a.bookingDate));

      const rows = nights
        .filter((n) => !posted.has(n.date))
        .map((n) => {
          const rooms = booking.rooms;
          const total = Number(n.sellingPrice) * rooms;
          const tax = Number(n.tax) * rooms;
          return {
            tenantId,
            folioId: folio.id,
            source: 'room' as const,
            description:
              rooms > 1 ? `Room charge — ${n.date} (${rooms} rooms)` : `Room charge — ${n.date}`,
            postedFor: n.date,
            bookingDate: n.date,
            quantity: money(rooms),
            unitPrice: n.sellingPrice,
            net: money(total - tax),
            tax: money(tax),
            total: money(total),
            postedByUserId: userId,
          };
        });

      if (rows.length > 0) await tx.insert(folioCharges).values(rows);
      return { posted: rows.length, skipped: nights.length - rows.length, folioId: folio.id };
    });
  }

  /** Post an extra — a minibar, a laundry bag, an airport transfer. */
  async postCharge(tenantId: string, folioId: string, userId: string | null, dto: PostChargeDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const folio = await this.loadOpenFolio(tx, folioId);

      let description = dto.description;
      let unitPrice = dto.unitPrice;
      let taxRatePct = dto.taxRatePct ?? 0;
      let taxInclusive = dto.taxInclusive ?? true;

      if (dto.particularId) {
        const [p] = await tx
          .select()
          .from(chargeParticulars)
          .where(eq(chargeParticulars.id, dto.particularId));
        if (!p) throw new NotFoundException('Charge particular not found');
        if (!p.active) throw new BadRequestException(`"${p.name}" is no longer chargeable`);
        description ??= p.name;
        unitPrice ??= Number(p.defaultPrice);
        if (dto.taxRatePct === undefined) taxRatePct = Number(p.taxRatePct);
        if (dto.taxInclusive === undefined) taxInclusive = p.taxInclusive;
      }

      if (description === undefined || unitPrice === undefined) {
        throw new BadRequestException('A charge needs a description and a price');
      }

      const gross = unitPrice * dto.quantity;
      // Tax-inclusive prices are decomposed out of the total, the same convention the room rate
      // uses, so a bill never mixes tax-in and tax-on lines. Tax and total are rounded FIRST and
      // net derived from the rounded pair — rounding all three independently can break the stored
      // invariant `net + tax = total` by a cent on half-cent taxes.
      const taxRaw = taxInclusive
        ? gross - gross / (1 + taxRatePct / 100)
        : gross * (taxRatePct / 100);
      const tax = Number(money(taxRaw));
      const total = Number(money(taxInclusive ? gross : gross + taxRaw));

      // Postings key off the property's business date, not the wall clock: a minibar rung up at
      // 03:00 belongs to the business day the night audit has not yet closed. Wall-clock UTC would
      // also be a day behind for any UTC+ property before its own midnight.
      let postedFor = dto.postedFor;
      if (!postedFor) {
        const [bd] = await tx
          .select({ currentDate: businessDates.currentDate })
          .from(businessDates)
          .where(eq(businessDates.propertyId, folio.propertyId));
        if (bd) {
          postedFor = bd.currentDate;
        } else {
          const [prop] = await tx
            .select({ timezone: properties.timezone })
            .from(properties)
            .where(eq(properties.id, folio.propertyId));
          postedFor = localToday(prop?.timezone);
        }
      }

      const [created] = await tx
        .insert(folioCharges)
        .values({
          tenantId,
          folioId: folio.id,
          particularId: dto.particularId ?? null,
          source: dto.source ?? 'manual',
          description,
          postedFor,
          quantity: money(dto.quantity),
          unitPrice: money(unitPrice),
          net: money(total - tax),
          tax: money(tax),
          total: money(total),
          postedByUserId: userId,
        })
        .returning();
      return created;
    });
  }

  /**
   * Reverse a line.
   *
   * Stamped, never deleted: a bill that silently loses a line is worse than one showing that a
   * line was reversed, and the guest's copy may already be printed.
   */
  async voidCharge(
    tenantId: string,
    chargeId: string,
    dto: VoidChargeDto,
    userId: string | null = null,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [charge] = await tx.select().from(folioCharges).where(eq(folioCharges.id, chargeId));
      if (!charge) throw new NotFoundException('Charge not found');
      if (charge.voidedAt) throw new ConflictException('That charge is already voided');
      await this.assertFolioOpen(tx, charge.folioId);

      const [updated] = await tx
        .update(folioCharges)
        .set({
          voidedAt: new Date(),
          voidReason: dto.reason?.trim() || null,
          // A reversal of money is always on the record (UX-1a).
          voidedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(eq(folioCharges.id, chargeId))
        .returning();
      return updated;
    });
  }

  /** Split the bill: move charges to another window of the same booking. */
  async transfer(tenantId: string, userId: string | null, dto: TransferChargesDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const target = await this.loadOpenFolio(tx, dto.toFolioId);

      const charges = await tx
        .select()
        .from(folioCharges)
        .where(inArray(folioCharges.id, dto.chargeIds));
      if (charges.length !== dto.chargeIds.length) {
        throw new NotFoundException('One or more charges were not found');
      }
      if (charges.some((c) => c.voidedAt)) {
        throw new BadRequestException('A voided charge cannot be transferred');
      }

      const sourceFolios = await tx
        .select()
        .from(folios)
        .where(inArray(folios.id, [...new Set(charges.map((c) => c.folioId))]));
      if (sourceFolios.some((f) => f.bookingId !== target.bookingId)) {
        throw new BadRequestException('Charges can only move between windows of the same booking');
      }
      if (sourceFolios.some((f) => f.status !== 'open')) {
        throw new BadRequestException('A closed window cannot be changed');
      }

      for (const c of charges) {
        if (c.folioId === target.id) continue;
        await tx
          .update(folioCharges)
          .set({ folioId: target.id, updatedAt: new Date() })
          .where(eq(folioCharges.id, c.id));
        await tx.insert(folioTransfers).values({
          tenantId,
          chargeId: c.id,
          fromFolioId: c.folioId,
          toFolioId: target.id,
          reason: dto.reason ?? null,
          movedByUserId: userId,
        });
      }

      return this.windowDetail(tx, target);
    });
  }

  /**
   * Take money against a window. Recorded in `payments`, the one record of what a guest paid, with
   * a receipt number from the property's series. With one of the hotel's own methods, cash goes
   * into the open drawer when the desk names none.
   */
  async recordPayment(
    tenantId: string,
    folioId: string,
    dto: RecordFolioPaymentDto,
    userId: string | null = null,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const folio = await this.loadOpenFolio(tx, folioId);
      if (!dto.confirmDuplicate) await this.assertNotDuplicate(tx, folio, dto);
      if (dto.paymentMethodId) {
        const method = await resolvePaymentMethod(tx, dto.paymentMethodId, folio.propertyId);
        if (method.category === 'city_ledger') {
          throw new BadRequestException(
            'Use "Charge to company" to move a balance to a travel agent or company account',
          );
        }
        const drawerSessionId =
          method.method === 'cash'
            ? await resolveDrawerSession(tx, {
                propertyId: folio.propertyId,
                userId,
                drawerSessionId: dto.drawerSessionId,
                required: false,
              })
            : null;
        const [prop] = await tx
          .select({ timezone: properties.timezone })
          .from(properties)
          .where(eq(properties.id, folio.propertyId));
        const businessDate = (await propertyBusinessDate(tx, folio.propertyId, prop?.timezone))
          .date;
        return insertPayment(tx, {
          tenantId,
          propertyId: folio.propertyId,
          userId,
          bookingId: folio.bookingId,
          folioId: folio.id,
          amount: dto.amount,
          currency: folio.currency,
          method,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          fileId: dto.fileId ?? null,
          drawerSessionId,
          businessDate,
        });
      }

      // A quoted shift must be real, still open, and on this folio's property. A payment attached
      // to a closed session appears on a Cashier Report whose expected total is already frozen —
      // the report stops adding up and the shortfall lands on a shift that had reconciled.
      if (dto.drawerSessionId) {
        const [session] = await tx
          .select({
            id: drawerSessions.id,
            closedAt: drawerSessions.closedAt,
            propertyId: cashDrawers.propertyId,
          })
          .from(drawerSessions)
          .innerJoin(cashDrawers, eq(cashDrawers.id, drawerSessions.drawerId))
          .where(eq(drawerSessions.id, dto.drawerSessionId));
        if (!session || session.propertyId !== folio.propertyId) {
          throw new NotFoundException('Drawer session not found');
        }
        if (session.closedAt) {
          throw new BadRequestException('That cashier shift is already closed');
        }
      }

      const [created] = await tx
        .insert(payments)
        .values({
          tenantId,
          bookingId: folio.bookingId,
          folioId: folio.id,
          direction: 'received',
          amount: money(dto.amount),
          currency: folio.currency,
          method: dto.method,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          drawerSessionId: dto.drawerSessionId ?? null,
        })
        .returning();
      return created;
    });
  }

  /**
   * A double entry is the commonest cashier mistake: the button pressed twice, or the payment
   * recorded again because the first toast was missed. The same amount by the same method on the
   * same bill within two minutes is refused until the desk confirms it is a second payment.
   */
  private async assertNotDuplicate(
    tx: Tx,
    folio: typeof folios.$inferSelect,
    dto: RecordFolioPaymentDto,
  ) {
    const since = new Date(Date.now() - 2 * 60_000);
    const [dup] = await tx
      .select({ createdAt: payments.createdAt })
      .from(payments)
      .where(
        and(
          eq(payments.folioId, folio.id),
          eq(payments.direction, 'received'),
          eq(payments.amount, money(dto.amount)),
          dto.paymentMethodId
            ? eq(payments.paymentMethodId, dto.paymentMethodId)
            : eq(payments.method, dto.method),
          gte(payments.createdAt, since),
        ),
      )
      .limit(1);
    if (dup) {
      const seconds = Math.max(1, Math.round((Date.now() - dup.createdAt.getTime()) / 1000));
      throw new ConflictException({
        reason: 'possible_duplicate',
        message: `A payment of ${folio.currency} ${money(dto.amount)} was recorded on this bill ${seconds} seconds ago. If this is a second payment, record it again and confirm.`,
      });
    }
  }

  /**
   * Give money back to the guest (UX-1b) — an overpaid deposit, a goodwill refund. Never more than
   * this window has actually been paid, cash leaves the till it is given from, and anyone but the
   * owner needs the owner's on-the-spot approval.
   */
  async refund(
    tenantId: string,
    folioId: string,
    dto: RefundDto,
    actor: { userId: string; role?: string },
  ) {
    if (actor.role !== 'OWNER') {
      if (!dto.approvalToken) {
        throw new ForbiddenException({
          reason: 'approval_required',
          message: 'A refund needs the owner. Ask them to approve it on this screen.',
        });
      }
      await this.stepUp.verify(dto.approvalToken, {
        tenantId,
        action: 'refund',
        requesterId: actor.userId,
      });
    }
    return this.dbs.withTenant(tenantId, async (tx) => {
      const folio = await this.loadOpenFolio(tx, folioId);
      const detail = await this.windowDetail(tx, folio);
      const paid = Number(detail.totals.paid);
      if (dto.amount > paid + 0.004) {
        throw new ConflictException({
          reason: 'refund_exceeds_paid',
          message: `Only ${folio.currency} ${money(paid)} has been paid on this bill, so no more than that can be given back.`,
        });
      }
      const method = await resolvePaymentMethod(tx, dto.paymentMethodId, folio.propertyId);
      if (method.category === 'city_ledger') {
        throw new BadRequestException(
          'A refund goes back by cash, card or bank, not the city ledger',
        );
      }
      const drawerSessionId =
        method.method === 'cash'
          ? await resolveDrawerSession(tx, {
              propertyId: folio.propertyId,
              userId: actor.userId,
              drawerSessionId: dto.drawerSessionId,
              required: false,
            })
          : null;
      const [prop] = await tx
        .select({ timezone: properties.timezone })
        .from(properties)
        .where(eq(properties.id, folio.propertyId));
      const businessDate = (await propertyBusinessDate(tx, folio.propertyId, prop?.timezone)).date;
      return insertRefund(tx, {
        tenantId,
        propertyId: folio.propertyId,
        userId: actor.userId,
        bookingId: folio.bookingId,
        folioId: folio.id,
        amount: dto.amount,
        currency: folio.currency,
        method,
        reference: dto.reference ?? null,
        drawerSessionId,
        businessDate,
        reason: dto.reason,
      });
    });
  }

  /**
   * Close a window at check-out.
   *
   * Refuses while the balance is non-zero — closing a bill someone still owes money on is how a
   * hotel loses revenue silently. `settleToZero` is the deliberate override for a written-off or
   * externally-settled balance.
   */
  async closeWindow(tenantId: string, folioId: string, force = false) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const folio = await this.loadOpenFolio(tx, folioId);
      const detail = await this.windowDetail(tx, folio);
      if (Number(detail.totals.balance) !== 0 && !force) {
        throw new ConflictException(
          `Window ${folio.window} still has a balance of ${detail.totals.balance}. Settle it, or close it explicitly.`,
        );
      }
      const [updated] = await tx
        .update(folios)
        .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
        .where(eq(folios.id, folioId))
        .returning();
      return updated;
    });
  }

  /**
   * Every stay that still owes money — the screen a night manager works from.
   *
   * In-house first: an unsettled balance on a guest who is still in the building can be collected,
   * while one on a departed guest is already a debt.
   */
  unsettled(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          folioId: folios.id,
          window: folios.window,
          label: folios.label,
          bookingId: bookings.id,
          reference: bookings.reference,
          status: bookings.status,
          checkin: bookings.checkin,
          checkout: bookings.checkout,
          currency: folios.currency,
          guestName: customers.name,
          vip: customers.vip,
          charges: sql<string>`coalesce((
            select sum(c.total) from folio_charges c
            where c.folio_id = ${folios.id} and c.voided_at is null
          ), 0)::text`,
          // Net of refunds (UX-1b).
          paid: sql<string>`coalesce((
            select sum(case when p.direction = 'received' then p.amount else -p.amount end)
            from payments p
            where p.folio_id = ${folios.id}
          ), 0)::text`,
          roomCodes: sql<string[]>`coalesce((
            select array_agg(ru.code order by ru.display_order)
            from booking_rooms br
            join room_units ru on ru.id = br.room_unit_id
            where br.booking_id = ${bookings.id} and br.released_at is null
          ), '{}')`,
        })
        .from(folios)
        .innerJoin(bookings, eq(bookings.id, folios.bookingId))
        .innerJoin(customers, eq(customers.id, bookings.customerId))
        .where(and(eq(bookings.propertyId, propertyId), eq(folios.status, 'open')))
        .orderBy(asc(bookings.checkout));

      return rows
        .map((r) => ({ ...r, balance: money(Number(r.charges) - Number(r.paid)) }))
        .filter((r) => Number(r.balance) !== 0)
        .sort((a, b) => {
          const rank = (s: string) => (s === 'CheckedIn' ? 0 : s === 'CheckedOut' ? 1 : 2);
          return rank(a.status) - rank(b.status) || a.checkout.localeCompare(b.checkout);
        });
    });
  }

  // --- Particulars -----------------------------------------------------------

  listParticulars(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(chargeParticulars).orderBy(asc(chargeParticulars.code)),
    );
  }

  createParticular(tenantId: string, dto: CreateParticularDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      try {
        const [created] = await tx
          .insert(chargeParticulars)
          .values({
            tenantId,
            propertyId: dto.propertyId ?? null,
            code: dto.code,
            name: dto.name,
            category: dto.category,
            defaultPrice: money(dto.defaultPrice),
            taxRatePct: dto.taxRatePct.toFixed(3),
            taxInclusive: dto.taxInclusive,
          })
          .returning();
        return created;
      } catch (e) {
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`A charge with code "${dto.code}" already exists`);
        }
        throw e;
      }
    });
  }

  // --- helpers ---------------------------------------------------------------

  private async loadBooking(tx: Tx, bookingId: string) {
    const [b] = await tx
      .select({
        id: bookings.id,
        propertyId: bookings.propertyId,
        reference: bookings.reference,
        status: bookings.status,
        currency: bookings.currency,
        amount: bookings.amount,
        rooms: bookings.rooms,
        checkin: bookings.checkin,
        checkout: bookings.checkout,
        customerId: bookings.customerId,
        guestName: customers.name,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(eq(bookings.id, bookingId));
    if (!b) throw new NotFoundException('Booking not found');
    return b;
  }

  /**
   * Get or create a window. Idempotent, so callers never have to check first. Window 1 bills the
   * booking's guest unless Bill To said otherwise when the reservation was made.
   */
  private async ensureWindow(
    tx: Tx,
    tenantId: string,
    booking: { id: string; propertyId: string; currency: string; customerId?: string | null },
    window: number,
    label: string,
  ) {
    const [existing] = await tx
      .select()
      .from(folios)
      .where(and(eq(folios.bookingId, booking.id), eq(folios.window, window)));
    if (existing) return existing;

    const [created] = await tx
      .insert(folios)
      .values({
        tenantId,
        propertyId: booking.propertyId,
        bookingId: booking.id,
        window,
        label,
        currency: booking.currency,
        payerType: 'guest',
        payerCustomerId: window === 1 ? (booking.customerId ?? null) : null,
      })
      .onConflictDoNothing({ target: [folios.bookingId, folios.window] })
      .returning();
    if (created) return created;

    // Lost a race to create it; the other writer's row is the one to use.
    const [raced] = await tx
      .select()
      .from(folios)
      .where(and(eq(folios.bookingId, booking.id), eq(folios.window, window)));
    return raced!;
  }

  private async loadOpenFolio(tx: Tx, folioId: string) {
    const [f] = await tx.select().from(folios).where(eq(folios.id, folioId));
    if (!f) throw new NotFoundException('Folio not found');
    if (f.status !== 'open') throw new BadRequestException(`This window is ${f.status}`);
    return f;
  }

  private async assertFolioOpen(tx: Tx, folioId: string) {
    await this.loadOpenFolio(tx, folioId);
  }
}
