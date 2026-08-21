import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { rooms, roomUnits } from './inventory';
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
  'CheckedIn',
  'CheckedOut',
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
  'checked_in',
  'checked_out',
  'amended',
]);

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  // Guest depth — what a registration card and a police/immigration report need, and what the
  // front desk fills in at check-in. All nullable: an OTA booking arrives with a name and little
  // else, and demanding more would block the check-in it is meant to support.
  nationality: text('nationality'),
  idType: text('id_type'),
  idNumber: text('id_number'),
  dateOfBirth: date('date_of_birth'),
  address: text('address'),
  city: text('city'),
  country: text('country'),
  /** Flags the guest across every screen — Yanolja's crown badge on the room card. */
  vip: boolean('vip').notNull().default(false),
  notes: text('notes'),
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
  /** Set when this booking is one leg of a multi-room group (Yanolja's Group ID). */
  groupId: uuid('group_id'),
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
  /**
   * FX rate snapshotted at booking creation: 1 unit of `currency` = this many LKR (1 for LKR).
   * Frozen so the cross-property consolidated (LKR) view never drifts as live rates move. Never
   * used inside per-property finance, which stays in `currency`. numeric(18,8) for rate precision.
   */
  fxRateToLkr: numeric('fx_rate_to_lkr', { precision: 18, scale: 8 }).notNull().default('1'),
  /** Front-desk timestamps (Compartment G): set when the guest physically arrives/leaves. */
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A group of sibling reservations — Yanolja's "Group ID", the thing that makes `3359-1` and
 * `3359-2` show up together in one Group Reservation List panel.
 *
 * Grouping is presentational: it never merges the money. Each member booking keeps its own
 * amount, folio and lifecycle.
 */
export const bookingGroups = pgTable('booking_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  /** Short human reference shown on the card, e.g. "414". */
  code: text('code').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One physical room on a booking — the thing a tape-chart bar actually represents.
 *
 * A booking with `rooms = 3` gets three legs. Money stays entirely on `bookings`/`booking_days`,
 * so `@yohobed/domain` is untouched by any of this; a leg only carries where the guests sleep.
 *
 * `roomUnitId` is nullable: an OTA reservation arrives unassigned, and the front desk assigns it
 * later (or `auto-assign` does). `releasedAt` is stamped when the booking is cancelled or
 * rejected — that frees the unit for re-sale while preserving which unit it had been given, and
 * it is what the double-booking exclusion constraint keys off.
 */
export const bookingRooms = pgTable(
  'booking_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    roomUnitId: uuid('room_unit_id').references(() => roomUnits.id, { onDelete: 'set null' }),
    /** 0-based position within the booking, so legs have a stable order. */
    legIndex: integer('leg_index').notNull().default(0),
    /** Denormalised from the booking so the exclusion constraint can be expressed on this row. */
    checkin: date('checkin').notNull(),
    checkout: date('checkout').notNull(),
    adults: integer('adults').notNull().default(1),
    children: integer('children').notNull().default(0),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingLegUnique: unique('booking_rooms_booking_leg_uq').on(t.bookingId, t.legIndex),
  }),
);

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
