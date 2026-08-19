import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  date,
  timestamp,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, properties } from './identity';

/**
 * Property & Inventory (Phase 3).
 *
 * `availability_calendar` is the single source of truth for how many rooms may still be sold on
 * a given date. Its `rooms_to_sell >= 0` check constraint, plus the atomic conditional decrement
 * in inventory.ts, are what make the legacy overbooking race (BUG #1) impossible.
 */

export const availabilityStatus = pgEnum('availability_status', ['Open', 'Close']);

/** An `inactive` unit still exists and keeps its history, but is not sellable or assignable. */
export const roomUnitStatus = pgEnum('room_unit_status', ['active', 'inactive']);

/** A per-tenant room category (e.g. Deluxe, Suite). */
export const roomtypes = pgTable('roomtypes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  roomtypeId: uuid('roomtype_id').references(() => roomtypes.id, { onDelete: 'set null' }),
  legacyId: integer('legacy_id').unique(),
  name: text('name').notNull(),
  quantity: integer('quantity').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A physically identifiable room — "01", "05" — belonging to a `rooms` bucket.
 *
 * `rooms` stays the *sellable* unit that `availability_calendar`, `rate_plans`, `cm_room_mappings`
 * and the outbox all speak, so nothing about pricing or distribution changes. This table sits
 * beside it and answers the question the bucket cannot: which actual room is the guest in. That
 * is the prerequisite for Stay View, Room View, room assignment and every housekeeping screen.
 *
 * Codes are unique per PROPERTY, not per room type, and are numbered across the whole property —
 * Yanolja's demo interleaves them (Double holds 01/05/06/07, Quadruple holds 02/03/04/08), which
 * is what real properties look like once rooms are renumbered over the years.
 *
 * `SUM(active units) = rooms.quantity` is deliberately NOT a constraint: a unit taken out of
 * service must be allowed to make the two diverge. Setup surfaces the mismatch as a warning.
 */
export const roomUnits = pgTable(
  'room_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** The bucket / room type this unit belongs to. */
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** What the tape chart shows, e.g. "01". */
    code: text('code').notNull(),
    /** Sort position within the property. Defaults to the numeric part of the code. */
    displayOrder: integer('display_order').notNull().default(0),
    floor: text('floor'),
    notes: text('notes'),
    status: roomUnitStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('room_units_property_code_uq').on(t.propertyId, t.code),
  }),
);

/**
 * A room taken out of service — Yanolja's hatched navy bar across the tape chart with its reason
 * written on it ("WATER LEAK").
 *
 * Deliberately separate from a booking: a block has no guest, no money and no rate plan, and it
 * must be able to overlap the same dates a cancelled booking once held.
 */
export const maintenanceBlocks = pgTable('maintenance_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  roomUnitId: uuid('room_unit_id')
    .notNull()
    .references(() => roomUnits.id, { onDelete: 'cascade' }),
  /** Inclusive start, exclusive end — the same half-open convention as a stay. */
  blockFrom: date('block_from').notNull(),
  blockTo: date('block_to').notNull(),
  reason: text('reason').notNull(),
  blockedByUserId: uuid('blocked_by_user_id'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const availabilityCalendar = pgTable(
  'availability_calendar',
  {
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
    date: date('date').notNull(),
    /** The room's physical count — the ceiling when releasing inventory. */
    physicalQuantity: integer('physical_quantity').notNull(),
    /** How many rooms may still be sold. Never allowed below zero. */
    roomsToSell: integer('rooms_to_sell').notNull(),
    status: availabilityStatus('status').notNull().default('Open'),
    /** Minimum stay (nights) for arrivals on this date. 1 = no restriction. */
    minStay: integer('min_stay').notNull().default(1),
    /** Maximum stay (nights) for arrivals on this date. 0 = unlimited. */
    maxStay: integer('max_stay').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roomDateUnique: unique('availability_room_date_uq').on(t.roomId, t.date),
    roomsToSellNonNegative: check('rooms_to_sell_non_negative', sql`${t.roomsToSell} >= 0`),
  }),
);
