import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import {
  bookings,
  customers,
  documentSequences,
  folios,
  invoiceLines,
  invoices,
  messages,
  nextDocumentNumber,
  properties,
  type DocumentType,
  type Tx,
} from '@yohobed/db';
import {
  FOLIO_INVOICE_KINDS,
  documentNumber,
  fiscalYear,
  invoiceTitle,
  isLkTin,
  lkInvoiceSerial,
  lkSerialPeriod,
  roundMoney,
  summariseTaxes,
  sumMoney,
  type InvoiceKind,
  type InvoiceParty,
  type InvoiceProfile,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { propertyBusinessDate } from '../common/local-date';
import { renderInvoicePdf } from '../vouchers/document-pdf';
import { ensureWindow } from '../folio/windows';
import {
  folioLines,
  fxRateOn,
  hasVat,
  payerOf,
  proformaLines,
  supplierOf,
  withPayerOverrides,
  type BuiltLine,
} from './invoice-builder';
import type {
  CreditNoteDto,
  IssueInvoiceDto,
  ListInvoicesQuery,
  ProformaDto,
  UpdateSequenceDto,
} from './dto';

const money = (n: number) => n.toFixed(2);

export interface InvoiceActor {
  tenantId: string;
  userId: string | null;
}

type Property = typeof properties.$inferSelect;
type Booking = typeof bookings.$inferSelect;

/**
 * Invoices, pro-formas and credit notes (Development Phase 02, Sprint 6). Ungated: every hotel
 * that sells a room has to be able to invoice it.
 *
 * - A folio window is invoiced once (a partial unique index backs the check). A Sri Lankan
 *   VAT-registered hotel gets a TAX INVOICE for the VAT-able lines and a BILL for the rest, as
 *   Gazette 2481/22 requires; anyone else gets one INVOICE.
 * - An issued document is never edited or voided. A credit note, with a reason, cancels it and
 *   frees the window to be invoiced again.
 * - Every number comes from the property's gap-free series, taken inside the issuing transaction.
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly dbs: DatabaseService) {}

  /** Invoice a folio window. Returns the documents issued: one, or a tax invoice and a bill. */
  issueForFolio(actor: InvoiceActor, folioId: string, dto: IssueInvoiceDto) {
    return this.dbs.withTenant(actor.tenantId, (tx) => this.issueWithin(tx, actor, folioId, dto));
  }

  /**
   * Invoice a booking's own bill (window 1) — for a hotel without the folio screen, whose rooms
   * come straight from the booking's nights.
   */
  issueForBooking(actor: InvoiceActor, bookingId: string, dto: IssueInvoiceDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!booking) throw new NotFoundException('Booking not found');
      const w1 = await ensureWindow(tx, actor.tenantId, booking, 1, 'Guest');
      return this.issueWithin(tx, actor, w1.id, dto);
    });
  }

  private async issueWithin(tx: Tx, actor: InvoiceActor, folioId: string, dto: IssueInvoiceDto) {
    // The window row is the lock: two desks invoicing it at once serialise here.
    const [folio] = await tx.select().from(folios).where(eq(folios.id, folioId)).for('update');
    if (!folio) throw new NotFoundException('Folio not found');
    const live = await tx
      .select({ number: invoices.number, kind: invoices.kind })
      .from(invoices)
      .where(
        and(
          eq(invoices.folioId, folioId),
          isNull(invoices.creditedAt),
          inArray(invoices.kind, [...FOLIO_INVOICE_KINDS]),
        ),
      );
    if (live.length > 0) {
      throw new ConflictException({
        reason: 'already_invoiced',
        message: `This bill is already invoiced (${live.map((l) => l.number).join(', ')}). Issue a credit note to invoice it again.`,
        numbers: live.map((l) => l.number),
      });
    }
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, folio.bookingId));
    const property = await this.property(tx, folio.propertyId);
    const lines = await folioLines(tx, folio, booking!, property.countryCode);
    if (lines.length === 0) {
      throw new BadRequestException({
        reason: 'nothing_to_invoice',
        message: 'There is nothing on this bill to invoice yet.',
      });
    }

    const profile = profileOf(property);
    const payer = withPayerOverrides(await payerOf(tx, folio, booking!), dto.payer);
    const groups: Array<{ kind: InvoiceKind; lines: BuiltLine[] }> =
      profile === 'lk_vat'
        ? [
            { kind: 'tax_invoice' as const, lines: lines.filter(hasVat) },
            { kind: 'bill' as const, lines: lines.filter((l) => !hasVat(l)) },
          ].filter((g) => g.lines.length > 0)
        : [{ kind: 'invoice', lines }];

    const issued = [];
    for (const g of groups) {
      issued.push(
        await this.write(tx, actor, {
          property,
          booking: booking!,
          folioId: folio.id,
          kind: g.kind,
          profile,
          lines: g.lines,
          payer,
          currency: folio.currency,
          notes: dto.notes ?? null,
        }),
      );
    }
    return { documents: issued };
  }

  /** A pro-forma: what the stay will cost, before it happens. Its own series; never a tax document. */
  proforma(actor: InvoiceActor, bookingId: string, dto: ProformaDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!booking) throw new NotFoundException('Booking not found');
      const property = await this.property(tx, booking.propertyId);
      const lines = await proformaLines(tx, booking, property.countryCode);
      if (lines.length === 0) {
        throw new BadRequestException({
          reason: 'nothing_to_invoice',
          message: 'This booking has no nights to quote.',
        });
      }
      const [w1] = await tx
        .select()
        .from(folios)
        .where(and(eq(folios.bookingId, bookingId), eq(folios.window, 1)));
      const payer = withPayerOverrides(await payerOf(tx, w1 ?? null, booking), dto.payer);
      return this.write(tx, actor, {
        property,
        booking,
        folioId: null,
        kind: 'proforma',
        profile: profileOf(property),
        lines,
        payer,
        currency: booking.currency,
        notes: dto.notes ?? null,
      });
    });
  }

  /** Cancel an invoice with a credit note. The invoice stays as issued; its window is free again. */
  creditNote(actor: InvoiceActor, invoiceId: string, dto: CreditNoteDto) {
    return this.dbs.withTenant(actor.tenantId, async (tx) => {
      const [original] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .for('update');
      if (!original) throw new NotFoundException('Invoice not found');
      if (!FOLIO_INVOICE_KINDS.includes(original.kind as InvoiceKind)) {
        throw new BadRequestException({
          reason: 'not_creditable',
          message: 'Only a tax invoice, an invoice or a bill can be credited.',
        });
      }
      if (original.creditedAt) {
        throw new ConflictException({
          reason: 'already_credited',
          message: `${original.number} has already been credited.`,
        });
      }
      const property = await this.property(tx, original.propertyId);
      const date = (await propertyBusinessDate(tx, property.id, property.timezone)).date;
      const fy = fiscalYear(date, property.fyStartMonth);
      const n = await nextDocumentNumber(tx, {
        tenantId: actor.tenantId,
        propertyId: property.id,
        docType: 'credit_note',
        period: fy,
      });
      const [note] = await tx
        .insert(invoices)
        .values({
          tenantId: actor.tenantId,
          propertyId: property.id,
          bookingId: original.bookingId,
          folioId: original.folioId,
          number: documentNumber('credit_note', fy, n),
          kind: 'credit_note',
          profile: original.profile,
          status: 'issued',
          amount: original.amount,
          currency: original.currency,
          originalInvoiceId: original.id,
          creditReason: dto.reason,
          supplier: original.supplier,
          payer: original.payer,
          placeOfSupply: original.placeOfSupply,
          fiscalYear: fy,
          invoiceDate: date,
          supplyDate: original.supplyDate,
          subtotal: original.subtotal,
          taxTotal: original.taxTotal,
          rounding: original.rounding,
          taxSummary: original.taxSummary,
          // Reversed at the rate it was invoiced at, so the two documents cancel exactly.
          fxRate: original.fxRate,
          fxQuote: original.fxQuote,
          issuedByUserId: actor.userId,
        })
        .returning();
      const lines = await tx
        .select()
        .from(invoiceLines)
        .where(eq(invoiceLines.invoiceId, original.id))
        .orderBy(asc(invoiceLines.sort));
      if (lines.length > 0) {
        await tx
          .insert(invoiceLines)
          .values(
            lines.map(({ id: _id, invoiceId: _inv, ...l }) => ({ ...l, invoiceId: note!.id })),
          );
      }
      await tx
        .update(invoices)
        .set({ creditedAt: new Date(), updatedAt: new Date() })
        .where(eq(invoices.id, original.id));
      return this.detailWithin(tx, note!.id);
    });
  }

  list(tenantId: string, q: ListInvoicesQuery) {
    return this.dbs.withTenant(tenantId, (tx) => {
      const where: SQL[] = [];
      if (q.propertyId) where.push(eq(invoices.propertyId, q.propertyId));
      if (q.bookingId) where.push(eq(invoices.bookingId, q.bookingId));
      if (q.folioId) where.push(eq(invoices.folioId, q.folioId));
      if (q.kind) where.push(eq(invoices.kind, q.kind));
      if (q.from) where.push(gte(invoices.issuedAt, new Date(`${q.from}T00:00:00Z`)));
      if (q.to) where.push(lte(invoices.issuedAt, new Date(`${q.to}T23:59:59.999Z`)));
      return tx
        .select({
          id: invoices.id,
          propertyId: invoices.propertyId,
          bookingId: invoices.bookingId,
          folioId: invoices.folioId,
          number: invoices.number,
          kind: invoices.kind,
          profile: invoices.profile,
          status: invoices.status,
          amount: invoices.amount,
          currency: invoices.currency,
          invoiceDate: invoices.invoiceDate,
          issuedAt: invoices.issuedAt,
          creditedAt: invoices.creditedAt,
          originalInvoiceId: invoices.originalInvoiceId,
          payerName: invoices.payer,
          bookingReference: bookings.reference,
        })
        .from(invoices)
        .leftJoin(bookings, eq(bookings.id, invoices.bookingId))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(invoices.issuedAt))
        .limit(500)
        .then((rows) =>
          rows.map((r) => ({
            ...r,
            payerName: (r.payerName as InvoiceParty | null)?.name ?? null,
            title: invoiceTitle(r.kind as InvoiceKind),
          })),
        );
    });
  }

  detail(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.detailWithin(tx, id));
  }

  async queueEmail(tenantId: string, id: string, emails: string[]) {
    const invoice = await this.detail(tenantId, id);
    if (invoice.creditedAt || invoice.status === 'void' || invoice.kind === 'proforma') {
      throw new ConflictException('Only an active issued invoice or bill can be sent');
    }
    const pdf = await renderInvoicePdf(invoice);
    const recipients = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
    await this.dbs.withTenant(tenantId, (tx) =>
      tx.insert(messages).values(
        recipients.map((to) => ({
          tenantId,
          bookingId: invoice.bookingId,
          channel: 'email' as const,
          toAddress: to,
          templateKey: 'issued_invoice',
          language: 'en',
          subject: `${invoice.title} ${invoice.number}`,
          body: `Please find ${invoice.title.toLowerCase()} ${invoice.number} attached.`,
          attachments: [{ filename: `${invoice.number}.pdf`, content: pdf.toString('base64') }],
          status: 'queued' as const,
        })),
      ),
    );
    return { queued: recipients.length, recipients };
  }

  // --- Document series ---------------------------------------------------------------------

  /** The property's series, and what the next document of each kind would be numbered today. */
  sequences(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const property = await this.property(tx, propertyId);
      const date = (await propertyBusinessDate(tx, property.id, property.timezone)).date;
      const rows = await tx
        .select({
          docType: documentSequences.docType,
          period: documentSequences.period,
          nextValue: documentSequences.nextValue,
          updatedAt: documentSequences.updatedAt,
        })
        .from(documentSequences)
        .where(eq(documentSequences.propertyId, propertyId))
        .orderBy(asc(documentSequences.docType), desc(documentSequences.period));
      const nextOf = (docType: DocumentType, period: string) =>
        rows.find((r) => r.docType === docType && r.period === period)?.nextValue ?? 1;
      const fy = fiscalYear(date, property.fyStartMonth);
      const month = lkSerialPeriod(date);
      const lk = profileOf(property) === 'lk_vat';
      return {
        profile: profileOf(property),
        date,
        series: rows,
        next: [
          ...(lk
            ? [
                {
                  docType: 'tax_invoice',
                  period: month,
                  number: lkInvoiceSerial(date, property.branchCode, nextOf('tax_invoice', month)),
                },
                {
                  docType: 'bill',
                  period: fy,
                  number: documentNumber('bill', fy, nextOf('bill', fy)),
                },
              ]
            : [
                {
                  docType: 'invoice',
                  period: fy,
                  number: documentNumber(
                    'invoice',
                    fy,
                    nextOf('invoice', fy),
                    property.invoicePrefix,
                  ),
                },
              ]),
          {
            docType: 'credit_note',
            period: fy,
            number: documentNumber('credit_note', fy, nextOf('credit_note', fy)),
          },
          {
            docType: 'proforma',
            period: fy,
            number: documentNumber('proforma', fy, nextOf('proforma', fy)),
          },
          {
            docType: 'receipt',
            period: date.slice(0, 4),
            number: `RC${date.slice(2, 4)}-${String(nextOf('receipt', date.slice(0, 4))).padStart(5, '0')}`,
          },
        ],
      };
    });
  }

  /**
   * Continue a series from another system: set the number the next document gets. Only ever
   * forward — going back would hand out a number that is already on a document.
   */
  setSequence(tenantId: string, propertyId: string, dto: UpdateSequenceDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      await this.property(tx, propertyId);
      const [current] = await tx
        .select()
        .from(documentSequences)
        .where(
          and(
            eq(documentSequences.propertyId, propertyId),
            eq(documentSequences.docType, dto.docType),
            eq(documentSequences.period, dto.period),
          ),
        )
        .for('update');
      if (current && dto.nextValue < current.nextValue) {
        throw new ConflictException({
          reason: 'sequence_backwards',
          message: `The next number is already ${current.nextValue}; a series can only move forward.`,
        });
      }
      const [row] = current
        ? await tx
            .update(documentSequences)
            .set({ nextValue: dto.nextValue, updatedAt: new Date() })
            .where(eq(documentSequences.id, current.id))
            .returning()
        : await tx
            .insert(documentSequences)
            .values({
              tenantId,
              propertyId,
              docType: dto.docType,
              period: dto.period,
              nextValue: dto.nextValue,
            })
            .returning();
      return row;
    });
  }

  // --- internals ---------------------------------------------------------------------------

  private async property(tx: Tx, id: string): Promise<Property> {
    const [p] = await tx.select().from(properties).where(eq(properties.id, id));
    if (!p) throw new NotFoundException('Property not found');
    return p;
  }

  /** Number, snapshot and write one document with its lines. */
  private async write(
    tx: Tx,
    actor: InvoiceActor,
    a: {
      property: Property;
      booking: Booking;
      folioId: string | null;
      kind: InvoiceKind;
      profile: InvoiceProfile;
      lines: BuiltLine[];
      payer: InvoiceParty;
      currency: string;
      notes: string | null;
    },
  ) {
    const { property } = a;
    const date = (await propertyBusinessDate(tx, property.id, property.timezone)).date;
    const fy = fiscalYear(date, property.fyStartMonth);
    let number: string;
    if (a.kind === 'tax_invoice') {
      const n = await nextDocumentNumber(tx, {
        tenantId: actor.tenantId,
        propertyId: property.id,
        docType: 'tax_invoice',
        period: lkSerialPeriod(date),
      });
      number = lkInvoiceSerial(date, property.branchCode, n);
    } else {
      const kind = a.kind as Exclude<InvoiceKind, 'legacy' | 'tax_invoice'>;
      const n = await nextDocumentNumber(tx, {
        tenantId: actor.tenantId,
        propertyId: property.id,
        docType: kind,
        period: fy,
      });
      number = documentNumber(kind, fy, n, property.invoicePrefix);
    }

    // A Sri Lankan tax invoice in another currency shows its LKR equivalents at the day's rate.
    const fxQuote = a.profile === 'lk_vat' && a.currency !== 'LKR' ? 'LKR' : null;
    const fxRate = fxQuote ? await fxRateOn(tx, a.currency, fxQuote, date) : null;

    const amount = sumMoney(a.lines.map((l) => l.amount));
    const taxTotal = sumMoney(a.lines.map((l) => l.tax));
    const posted = a.lines.map((l) => l.postedFor).filter((d): d is string => Boolean(d));
    const lastPosted = posted.length ? posted.reduce((m, d) => (d > m ? d : m)) : null;
    const supplyDate =
      lastPosted && lastPosted < date
        ? lastPosted
        : a.kind === 'proforma'
          ? a.booking.checkout
          : date;

    const [inv] = await tx
      .insert(invoices)
      .values({
        tenantId: actor.tenantId,
        propertyId: property.id,
        bookingId: a.booking.id,
        folioId: a.folioId,
        number,
        kind: a.kind,
        profile: a.profile,
        status: 'issued',
        amount: money(amount),
        currency: a.currency,
        supplier: supplierOf(property),
        payer: a.payer,
        placeOfSupply: property.stateCode ?? property.countryCode,
        fiscalYear: fy,
        invoiceDate: date,
        supplyDate,
        subtotal: money(roundMoney(amount - taxTotal)),
        taxTotal: money(taxTotal),
        taxSummary: summariseTaxes(a.lines),
        fxRate,
        fxQuote,
        notes: a.notes,
        issuedByUserId: actor.userId,
      })
      .returning();
    await tx.insert(invoiceLines).values(
      a.lines.map((l, i) => ({
        tenantId: actor.tenantId,
        invoiceId: inv!.id,
        sort: i,
        description: l.description,
        quantity: l.quantity.toFixed(2),
        unitPrice: money(l.unitPrice),
        amount: money(l.amount),
        net: money(l.net),
        tax: money(l.tax),
        taxLines: l.taxLines,
        postedFor: l.postedFor,
        folioChargeId: l.folioChargeId,
      })),
    );
    return this.detailWithin(tx, inv!.id);
  }

  private async detailWithin(tx: Tx, id: string) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id));
    if (!inv) throw new NotFoundException('Invoice not found');
    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.sort), asc(invoiceLines.id));
    const [b] = inv.bookingId
      ? await tx
          .select({
            reference: bookings.reference,
            checkin: bookings.checkin,
            checkout: bookings.checkout,
            guestName: customers.name,
          })
          .from(bookings)
          .innerJoin(customers, eq(customers.id, bookings.customerId))
          .where(eq(bookings.id, inv.bookingId))
      : [];
    const [original] = inv.originalInvoiceId
      ? await tx
          .select({ id: invoices.id, number: invoices.number })
          .from(invoices)
          .where(eq(invoices.id, inv.originalInvoiceId))
      : [];
    const credits = await tx
      .select({ id: invoices.id, number: invoices.number, creditReason: invoices.creditReason })
      .from(invoices)
      .where(eq(invoices.originalInvoiceId, id));
    return {
      ...inv,
      title: invoiceTitle(inv.kind as InvoiceKind),
      booking: b ?? null,
      original: original ?? null,
      creditNotes: credits,
      lines,
    };
  }
}

/** Sri Lanka's gazette profile applies to a hotel there with a TIN; anyone else gets a plain invoice. */
export function profileOf(p: Pick<Property, 'countryCode' | 'taxIds'>): InvoiceProfile {
  return p.countryCode === 'LK' && isLkTin(p.taxIds?.tin) ? 'lk_vat' : 'generic';
}
