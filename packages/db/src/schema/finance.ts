import { pgTable, pgEnum, uuid, text, integer, numeric, date, timestamp } from 'drizzle-orm/pg-core';
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

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  direction: paymentDirection('direction').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  method: paymentMethod('method').notNull().default('bank'),
  reference: text('reference'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
  netPayable: numeric('net_payable', { precision: 14, scale: 2 }).notNull(),
  status: payoutStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
