import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  index,
  jsonb,
  check,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { InvoiceParty, TaxLine } from '@yohobed/domain';
import { tenants, properties, users } from './identity';
import { bookings } from './bookings';
import { paymentMethods } from './configuration';
import { privateFiles } from './files';
import { folios, folioCharges } from './folio';

/**
 * Finance & Settlement (Phase 7). Consolidates the legacy sprawl (payments/payment_received/
 * payment_send/invoice/booking_invoice/revenue) into: `payments` (one table, a direction),
 * `invoices` (+ lines), and `payouts` (property settlement that reconciles to bookings).
 */

export const paymentDirection = pgEnum('payment_direction', ['received', 'sent']);
export const paymentMethod = pgEnum('payment_method', ['cash', 'card', 'bank', 'online']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'issued', 'paid', 'void']);
export const payoutStatus = pgEnum('payout_status', ['pending', 'scheduled', 'paid']);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    /**
     * The folio window this payment settles, when it was taken at the front desk.
     *
     * Deliberately added here rather than in a separate `folio_payments` table: this is already the
     * record of what a guest paid, and a second one would be a second answer to "is this settled?".
     * Null for payments that predate folios, and for the platform-side payout direction.
     */
    folioId: uuid('folio_id'),
    /**
     * The cashier shift this payment was taken on, so the drawer can be reconciled at close.
     * Null for anything not taken at a till — an OTA settlement, a bank transfer, a back-dated entry.
     */
    drawerSessionId: uuid('drawer_session_id'),
    /**
     * Set when the payment is a transfer to the city ledger rather than actual money: the folio is
     * cleared and the debt moves to the travel agent or company, which is what "charge to company"
     * means. A matching `ledger_entries` debit is written in the same transaction.
     */
    ledgerAccountId: uuid('ledger_account_id'),
    direction: paymentDirection('direction').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /**
     * Denomination of `amount` — always inherited from the booking (and therefore its property's
     * base currency), never chosen per payment. Recorded explicitly so the "is this invoice settled?"
     * comparison in FinanceService.recordPayment can refuse to compare across currencies.
     */
    currency: text('currency').notNull().default('LKR'),
    method: paymentMethod('method').notNull().default('bank'),
    reference: text('reference'),
    note: text('note'),
    /**
     * The hotel's own payment method (Development Phase 02, Sprint 5) — "LankaQR", "Cash (USD)" —
     * of which `method` above is the coarse category the cashier report sums by.
     */
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id, {
      onDelete: 'set null',
    }),
    methodCode: text('method_code'),
    takenByUserId: uuid('taken_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** A photo of the slip, in the private file store. */
    attachmentFileId: uuid('attachment_file_id').references(() => privateFiles.id, {
      onDelete: 'set null',
    }),
    /** The receipt number the guest was given; shared by every row of one split deposit. */
    receiptNo: text('receipt_no'),
    /** Rows that are one payment split across the rooms of a reservation share this id. */
    allocationGroupId: uuid('allocation_group_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every list screen sums a booking's payments; without this each row is a sequential scan.
  (t) => ({
    bookingIdx: index('payments_booking_idx').on(t.bookingId),
    receiptIdx: index('payments_receipt_idx').on(t.tenantId, t.receiptNo),
  }),
);

/** One tax's total on a document. */
export interface InvoiceTaxTotal {
  key: string;
  name: string;
  rate: number;
  priority: number;
  amount: number;
}

/**
 * An issued document: a tax invoice, an invoice, a non-VAT bill, a pro-forma or a credit note
 * (Development Phase 02, Sprint 6), or the pre-Phase-02 `INV-<reference>` (`kind = 'legacy'`).
 *
 * A folio window is invoiced once: the partial unique index `invoices_folio_live_uq` (0031) allows
 * one live document of each folio kind per window. Correcting one never edits or voids it — a credit
 * note is issued against it, which stamps `credited_at` and frees the window to be invoiced again.
 * Numbers are unique per property, from the gap-free `document_sequences`.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    number: text('number').notNull(),
    status: invoiceStatus('status').notNull().default('issued'),
    /** The total, taxes included. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('LKR'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // --- Development Phase 02, Sprint 6 ---------------------------------------------------------
    kind: text('kind').notNull().default('legacy'),
    /** `lk_vat` (Gazette 2481/22) or `generic`: decides the title, date order and serial. */
    profile: text('profile').notNull().default('generic'),
    folioId: uuid('folio_id').references(() => folios.id, { onDelete: 'set null' }),
    /** A credit note's invoice. */
    originalInvoiceId: uuid('original_invoice_id').references((): AnyPgColumn => invoices.id, {
      onDelete: 'restrict',
    }),
    creditReason: text('credit_reason'),
    /** Set on an invoice when a credit note cancels it; its window can be invoiced again. */
    creditedAt: timestamp('credited_at', { withTimezone: true }),
    /** Supplier and purchaser as printed, frozen at issue: a renamed company does not rewrite history. */
    supplier: jsonb('supplier').$type<InvoiceParty>(),
    payer: jsonb('payer').$type<InvoiceParty>(),
    placeOfSupply: text('place_of_supply'),
    fiscalYear: text('fiscal_year'),
    /** The hotel's business date of issue, and the last day of what it bills. */
    invoiceDate: date('invoice_date'),
    supplyDate: date('supply_date'),
    /** Taxes excluded, and all taxes: `subtotal + tax_total + rounding = amount`. */
    subtotal: numeric('subtotal', { precision: 12, scale: 2 }),
    taxTotal: numeric('tax_total', { precision: 12, scale: 2 }),
    rounding: numeric('rounding', { precision: 12, scale: 2 }).notNull().default('0'),
    taxSummary: jsonb('tax_summary').$type<InvoiceTaxTotal[]>(),
    /** A foreign-currency invoice's rate to the local currency on the invoice date. */
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    fxQuote: text('fx_quote'),
    notes: text('notes'),
    issuedByUserId: uuid('issued_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    numberPerProperty: unique('invoices_property_number_uq').on(t.propertyId, t.number),
    folioIdx: index('invoices_folio_idx').on(t.folioId),
    bookingIdx: index('invoices_booking_idx').on(t.bookingId),
    kindValid: check(
      'invoices_kind_valid',
      sql`${t.kind} in ('legacy', 'tax_invoice', 'invoice', 'bill', 'proforma', 'credit_note')`,
    ),
    profileValid: check(
      'invoices_profile_valid',
      sql`${t.profile} in ('lk_vat', 'generic', 'in_gst', 'my_sst')`,
    ),
    creditNoteHasOriginal: check(
      'invoices_credit_note_original',
      sql`${t.kind} <> 'credit_note' or (${t.originalInvoiceId} is not null and length(trim(coalesce(${t.creditReason}, ''))) > 0)`,
    ),
  }),
);

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  /** The line total, taxes included. */
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  // --- Development Phase 02, Sprint 6 -----------------------------------------------------------
  sort: integer('sort').notNull().default(0),
  quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
  /** Per unit, taxes included. */
  unitPrice: numeric('unit_price', { precision: 12, scale: 2 }),
  /** Taxes excluded, and all taxes: `net + tax = amount`. */
  net: numeric('net', { precision: 12, scale: 2 }),
  tax: numeric('tax', { precision: 12, scale: 2 }),
  taxLines: jsonb('tax_lines').$type<TaxLine[]>(),
  /** India's SAC (996311 for accommodation); Sprint 7. */
  hsnSac: text('hsn_sac'),
  postedFor: date('posted_for'),
  folioChargeId: uuid('folio_charge_id').references(() => folioCharges.id, {
    onDelete: 'set null',
  }),
});

/** A settlement statement for a property over a period — reconciles to its bookings. */
export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  bookingCount: integer('booking_count').notNull(),
  grossSelling: numeric('gross_selling', { precision: 14, scale: 2 }).notNull(),
  propertyBase: numeric('property_base', { precision: 14, scale: 2 }).notNull(),
  yohoCommission: numeric('yoho_commission', { precision: 14, scale: 2 }).notNull(),
  otaCommission: numeric('ota_commission', { precision: 14, scale: 2 }).notNull(),
  taxes: numeric('taxes', { precision: 14, scale: 2 }).notNull().default('0'),
  netPayable: numeric('net_payable', { precision: 14, scale: 2 }).notNull(),
  /**
   * The property's base currency at settlement time. A payout is scoped to one property, so every
   * figure on this row is exact in this currency — no FX is ever applied to a settlement.
   */
  currency: text('currency').notNull().default('LKR'),
  status: payoutStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
