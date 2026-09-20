import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { decomposeBooking } from '@yohobed/domain';
import {
  bookings,
  bookingDays,
  folios,
  invoices,
  invoiceLines,
  payments,
  payouts,
  properties,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { resolveAggCurrency } from '../common/currency';
import { CONFIRMED_STATUSES, isConfirmedStatus } from '../common/booking-status';
import type { RecordPaymentDto } from './dto';

@Injectable()
export class FinanceService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Invoices ---------------------------------------------------------------

  createInvoiceForBooking(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!b) throw new NotFoundException('Booking not found');

      // The one-per-booking INV-<reference>; a booking's tax invoices are separate documents.
      const [existing] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.bookingId, bookingId), eq(invoices.kind, 'legacy')));
      if (existing) {
        const lines = await tx
          .select()
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, existing.id));
        return { ...existing, lines };
      }

      const [inv] = await tx
        .insert(invoices)
        .values({
          tenantId,
          propertyId: b.propertyId,
          bookingId,
          number: `INV-${b.reference}`,
          amount: b.amount,
          currency: b.currency,
          status: 'issued',
        })
        .returning();

      const days = await tx
        .select()
        .from(bookingDays)
        .where(eq(bookingDays.bookingId, bookingId))
        .orderBy(bookingDays.date);
      if (days.length) {
        await tx.insert(invoiceLines).values(
          days.map((d) => ({
            tenantId,
            invoiceId: inv!.id,
            description: `Room night ${d.date} (×${b.rooms})`,
            amount: (Number(d.sellingPrice) * b.rooms).toFixed(2),
          })),
        );
      }
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv!.id));
      return { ...inv, lines };
    });
  }

  // Listing and reading invoices: InvoicesService (Development Phase 02, Sprint 6).

  // --- Payments ---------------------------------------------------------------

  recordPayment(tenantId: string, bookingId: string, dto: RecordPaymentDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!b) throw new NotFoundException('Booking not found');

      // A payment is always denominated in the booking's currency. If a caller states one, it must
      // agree: the settled-in-full check below compares payment totals against the invoice amount,
      // and comparing 300 USD to 300 LKR would mark a barely-paid invoice as paid.
      if (dto.currency && dto.currency !== b.currency) {
        throw new BadRequestException({
          error: 'currency_mismatch',
          message: `Booking ${b.reference} is denominated in ${b.currency}; received ${dto.currency}.`,
        });
      }

      // Land the money on the guest's bill too. A payment recorded here but not on the folio is
      // the "two truths" bug: the reservation says paid while the folio still shows a balance,
      // check-out refuses to close the window, and a fully-paid guest is listed as a debtor.
      let folioId: string | null = null;
      if (dto.direction === 'received') {
        const [w1] = await tx
          .select({ id: folios.id, status: folios.status })
          .from(folios)
          .where(and(eq(folios.bookingId, bookingId), eq(folios.window, 1)));
        if (w1) {
          // A closed window's cashier report is frozen — leave the payment booking-level then.
          folioId = w1.status === 'open' ? w1.id : null;
        } else {
          const [created] = await tx
            .insert(folios)
            .values({
              tenantId,
              propertyId: b.propertyId,
              bookingId,
              window: 1,
              label: 'Guest',
              currency: b.currency,
              payerType: 'guest',
              payerCustomerId: b.customerId,
            })
            .onConflictDoNothing({ target: [folios.bookingId, folios.window] })
            .returning();
          folioId = created?.id ?? null;
        }
      }

      const [pay] = await tx
        .insert(payments)
        .values({
          tenantId,
          bookingId,
          folioId,
          direction: dto.direction,
          amount: dto.amount.toFixed(2),
          currency: b.currency,
          method: dto.method,
          reference: dto.reference ?? null,
          note: dto.note ?? null,
        })
        .returning();

      // If the guest has now paid the invoice in full, mark it paid.
      if (dto.direction === 'received') {
        const [agg] = await tx
          .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
          .from(payments)
          .where(
            and(
              eq(payments.bookingId, bookingId),
              eq(payments.direction, 'received'),
              // Belt-and-braces: only ever total payments that share the booking's denomination.
              eq(payments.currency, b.currency),
            ),
          );
        const [inv] = await tx
          .select()
          .from(invoices)
          .where(and(eq(invoices.bookingId, bookingId), eq(invoices.kind, 'legacy')));
        if (
          inv &&
          inv.status !== 'paid' &&
          inv.currency === b.currency &&
          Number(agg!.total) >= Number(inv.amount)
        ) {
          await tx
            .update(invoices)
            .set({ status: 'paid', updatedAt: new Date() })
            .where(eq(invoices.id, inv.id));
        }
      }
      return pay;
    });
  }

  listPayments(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select()
        .from(payments)
        .where(eq(payments.bookingId, bookingId))
        .orderBy(desc(payments.createdAt)),
    );
  }

  // --- Settlement / payouts ---------------------------------------------------

  /**
   * A settlement statement for a property over a period. Reconciles to its confirmed bookings —
   * Approved and beyond (CheckedIn/CheckedOut are still revenue; Compartment G added them).
   */
  payoutStatement(tenantId: string, propertyId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const where = and(
        eq(bookings.propertyId, propertyId),
        inArray(bookings.status, [...CONFIRMED_STATUSES]),
        gte(bookings.checkin, from),
        lte(bookings.checkin, to),
      );

      const [totals] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          gross: sql<string>`coalesce(sum(${bookings.amount}), 0)`,
          base: sql<string>`coalesce(sum(${bookings.totalBasePrice}), 0)`,
          taxes: sql<string>`coalesce(sum(${bookings.taxes}), 0)`,
          currencies: sql<string[]>`coalesce(array_agg(distinct ${bookings.currency}), '{}')`,
        })
        .from(bookings)
        .where(where);

      // A settlement is a payment instruction, so it is never approximate: it must be exact in one
      // currency. Bookings here should be homogeneous (currency is stamped from the property and
      // locked once bookings exist), so a mix means the invariant was broken out-of-band — refuse
      // rather than emit a total that silently adds rupees to dollars.
      if (totals!.currencies.length > 1) {
        throw new ConflictException({
          error: 'mixed_currency_settlement',
          message:
            `Bookings in this period span multiple currencies (${totals!.currencies.join(', ')}). ` +
            `A payout must settle in a single currency — resolve the affected bookings first.`,
        });
      }

      const [yohoAgg] = await tx
        .select({
          yoho: sql<string>`coalesce(sum(${bookingDays.commission} * ${bookings.rooms}), 0)`,
        })
        .from(bookingDays)
        .innerJoin(bookings, eq(bookings.id, bookingDays.bookingId))
        .where(where);

      // Tax-aware split: gross = propertyBase + yohoCommission + otaCommission + taxes.
      const s = decomposeBooking(
        Number(totals!.gross),
        Number(totals!.taxes),
        Number(totals!.base),
        Number(yohoAgg!.yoho),
      );
      // A statement is scoped to one property, so it's entirely in that property's base currency.
      const [prop] = await tx
        .select({ currency: properties.currency })
        .from(properties)
        .where(eq(properties.id, propertyId));
      return {
        propertyId,
        currency: prop?.currency ?? 'LKR',
        from,
        to,
        bookingCount: totals!.count,
        ...s,
        netPayable: s.propertyBase,
      };
    });
  }

  async createPayout(tenantId: string, propertyId: string, from: string, to: string) {
    const stmt = await this.payoutStatement(tenantId, propertyId, from, to);
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .insert(payouts)
        .values({
          tenantId,
          propertyId,
          periodStart: from,
          periodEnd: to,
          bookingCount: stmt.bookingCount,
          grossSelling: stmt.grossSelling.toFixed(2),
          propertyBase: stmt.propertyBase.toFixed(2),
          yohoCommission: stmt.yohoCommission.toFixed(2),
          otaCommission: stmt.otaCommission.toFixed(2),
          taxes: stmt.taxes.toFixed(2),
          netPayable: stmt.netPayable.toFixed(2),
          currency: stmt.currency,
          status: 'pending',
        })
        .returning(),
    );
    return row;
  }

  listPayouts(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(payouts).orderBy(desc(payouts.createdAt)),
    );
  }

  /**
   * Revenue summary across the tenant's bookings in a period, grouped by status.
   *
   * Spans every property, so it can span base currencies: grouped by (status, currency) and folded
   * via `resolveAggCurrency` — native when the tenant prices in one currency, LKR-consolidated
   * (using each booking's snapshotted rate) when it doesn't.
   */
  revenueSummary(tenantId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          status: bookings.status,
          currency: bookings.currency,
          count: sql<number>`count(*)::int`,
          gross: sql<string>`coalesce(sum(${bookings.amount}), 0)`,
          grossLkr: sql<string>`coalesce(sum(${bookings.amount} * ${bookings.fxRateToLkr}), 0)`,
        })
        .from(bookings)
        .where(and(gte(bookings.checkin, from), lte(bookings.checkin, to)))
        .groupBy(bookings.status, bookings.currency);

      const agg = resolveAggCurrency(rows.map((r) => r.currency));
      const byStatus: Record<string, { count: number; gross: number }> = {};
      let approvedGross = 0;
      let totalBookings = 0;
      for (const r of rows) {
        const gross = Number(agg.approximate ? r.grossLkr : r.gross);
        // Two properties in different currencies can contribute to the same status bucket.
        const bucket = (byStatus[r.status] ??= { count: 0, gross: 0 });
        bucket.count += r.count;
        bucket.gross += gross;
        if (isConfirmedStatus(r.status)) approvedGross += gross;
        totalBookings += r.count;
      }
      return {
        from,
        to,
        byStatus,
        approvedGross,
        totalBookings,
        currency: agg.currency,
        approximate: agg.approximate,
      };
    });
  }
}
