import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { decomposeBooking } from '@yohobed/domain';
import { bookings, bookingDays, invoices, invoiceLines, payments, payouts } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import type { RecordPaymentDto } from './dto';

@Injectable()
export class FinanceService {
  constructor(private readonly dbs: DatabaseService) {}

  // --- Invoices ---------------------------------------------------------------

  createInvoiceForBooking(tenantId: string, bookingId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!b) throw new NotFoundException('Booking not found');

      const [existing] = await tx.select().from(invoices).where(eq(invoices.bookingId, bookingId));
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

  listInvoices(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(invoices).orderBy(desc(invoices.issuedAt)),
    );
  }

  getInvoice(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
      if (!inv) throw new NotFoundException('Invoice not found');
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      return { ...inv, lines };
    });
  }

  // --- Payments ---------------------------------------------------------------

  recordPayment(tenantId: string, bookingId: string, dto: RecordPaymentDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!b) throw new NotFoundException('Booking not found');

      const [pay] = await tx
        .insert(payments)
        .values({
          tenantId,
          bookingId,
          direction: dto.direction,
          amount: dto.amount.toFixed(2),
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
          .where(and(eq(payments.bookingId, bookingId), eq(payments.direction, 'received')));
        const [inv] = await tx.select().from(invoices).where(eq(invoices.bookingId, bookingId));
        if (inv && inv.status !== 'paid' && Number(agg!.total) >= Number(inv.amount)) {
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
        inArray(bookings.status, ['Approved', 'CheckedIn', 'CheckedOut']),
        gte(bookings.checkin, from),
        lte(bookings.checkin, to),
      );

      const [totals] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          gross: sql<string>`coalesce(sum(${bookings.amount}), 0)`,
          base: sql<string>`coalesce(sum(${bookings.totalBasePrice}), 0)`,
          taxes: sql<string>`coalesce(sum(${bookings.taxes}), 0)`,
        })
        .from(bookings)
        .where(where);

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
      return {
        propertyId,
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

  /** Revenue summary across the tenant's bookings in a period, grouped by status. */
  revenueSummary(tenantId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          status: bookings.status,
          count: sql<number>`count(*)::int`,
          gross: sql<string>`coalesce(sum(${bookings.amount}), 0)`,
        })
        .from(bookings)
        .where(and(gte(bookings.checkin, from), lte(bookings.checkin, to)))
        .groupBy(bookings.status);

      const byStatus: Record<string, { count: number; gross: number }> = {};
      let approvedGross = 0;
      let totalBookings = 0;
      for (const r of rows) {
        byStatus[r.status] = { count: r.count, gross: Number(r.gross) };
        if (r.status === 'Approved' || r.status === 'CheckedIn' || r.status === 'CheckedOut') {
          approvedGross += Number(r.gross);
        }
        totalBookings += r.count;
      }
      return { from, to, byStatus, approvedGross, totalBookings };
    });
  }
}
