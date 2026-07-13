import { pgTable, pgEnum, uuid, text, integer, numeric, date, timestamp } from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { rooms } from './inventory';
import { occupancies } from './rates';

/**
 * Bookings (Phase 5). Fixes two legacy bugs by construction:
 *  - BUG #2 (walk-in wrong key): a booking references its `occupancyId` explicitly — the correct
 *    pricing key — never the room id masquerading as one.
 *  - BUG #4 (reference race): references come from an atomic per-day counter, not MAX()+1.
 * The day-wise `booking_days` snapshot preserves the exact prices at the moment of booking.
 */

export const bookingStatus = pgEnum('booking_status', [
  'Pending',
  'Approved',
  'Rejected',
  'Cancelled',
  'NoShow',
]);
export const bookingSource = pgEnum('booking_source', ['Extranet', 'OTA', 'Backend']);
export const bookingAction = pgEnum('booking_action', [
  'created',
  'approved',
  'rejected',
  'cancelled',
  'no_show',
]);

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  /** The correct pricing key (BUG #2) — never the room id. */
  occupancyId: uuid('occupancy_id')
    .notNull()
    .references(() => occupancies.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  reference: text('reference').notNull().unique(),
  checkin: date('checkin').notNull(),
  checkout: date('checkout').notNull(),
  nights: integer('nights').notNull(),
  rooms: integer('rooms').notNull().default(1),
  status: bookingStatus('status').notNull().default('Pending'),
  source: bookingSource('source').notNull().default('Extranet'),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  totalBasePrice: numeric('total_base_price', { precision: 12, scale: 2 }).notNull(),
  /** Tax portion decomposed out of `amount` (legacy PricingCalculator::calculateTaxFromSelling). */
  taxes: numeric('taxes', { precision: 12, scale: 2 }).notNull().default('0'),
  /** `amount − taxes` (legacy `commissionable_amount`) — the base for the settlement split. */
  commissionableAmount: numeric('commissionable_amount', { precision: 12, scale: 2 })
    .notNull()
    .default('0'),
  /** Coupon discount off the amount (Compartment D). The guest pays amount − discount. */
  discount: numeric('discount', { precision: 12, scale: 2 }).notNull().default('0'),
  currency: text('currency').notNull().default('LKR'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Day-wise price snapshot at the moment of booking (for audit + parity). */
export const bookingDays = pgTable('booking_days', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull(),
  sellingPrice: numeric('selling_price', { precision: 12, scale: 2 }).notNull(),
  commission: numeric('commission', { precision: 12, scale: 2 }).notNull(),
  /** Per-night tax portion decomposed from the selling price (0 when no tax configured). */
  tax: numeric('tax', { precision: 12, scale: 2 }).notNull().default('0'),
});

/** Single audit trail for the booking lifecycle. */
export const bookingApprovals = pgTable('booking_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  action: bookingAction('action').notNull(),
  reason: text('reason'),
  actorUserId: uuid('actor_user_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Global per-day counter for race-free booking references (BUG #4).
 * Not tenant-scoped: references are globally unique, like the legacy scheme.
 */
export const bookingCounters = pgTable('booking_counters', {
  day: text('day').primaryKey(),
  counter: integer('counter').notNull().default(0),
});
