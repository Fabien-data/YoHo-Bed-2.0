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
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { bookings } from './bookings';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every list screen sums a booking's payments; without this each row is a sequential scan.
  (t) => ({ bookingIdx: index('payments_booking_idx').on(t.bookingId) }),
);

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  number: text('number').notNull().unique(),
  status: invoiceStatus('status').notNull().default('issued'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('LKR'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
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
