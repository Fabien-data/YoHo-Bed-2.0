import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  date,
  timestamp,
  unique,
  uniqueIndex,
  check,
  boolean,
  jsonb,
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

export const rooms = pgTable(
  'rooms',
  {
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

    /**
     * Yanolja's Room Type (Configuration, owner brief 2026-09-26). A short code for lists and
     * channels; guests included in the base rate and the most the room takes (null = not set, so
     * nothing is enforced); the beds, the room amenities (catalogue codes) and a colour. `active`
     * off stops selling the type — its existing stays are untouched — and `sort_order` is the
     * hotel's own order everywhere room types are listed.
     */
    shortCode: text('short_code'),
    description: text('description'),
    baseAdults: integer('base_adults'),
    baseChildren: integer('base_children'),
    maxAdults: integer('max_adults'),
    maxChildren: integer('max_children'),
    bedTypes: jsonb('bed_types').$type<string[]>().notNull().default([]),
    amenities: jsonb('amenities').$type<string[]>().notNull().default([]),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shortCodeUnique: uniqueIndex('rooms_property_short_code_uq')
      .on(t.propertyId, sql`upper(${t.shortCode})`)
      .where(sql`${t.shortCode} is not null`),
    occupancyValid: check(
      'rooms_occupancy_valid',
      sql`coalesce(${t.baseAdults}, 0) >= 0 and coalesce(${t.baseChildren}, 0) >= 0
      and coalesce(${t.maxAdults}, 0) >= 0 and coalesce(${t.maxChildren}, 0) >= 0
      and (${t.baseAdults} is null or ${t.maxAdults} is null or ${t.baseAdults} <= ${t.maxAdults})
      and (${t.baseChildren} is null or ${t.maxChildren} is null or ${t.baseChildren} <= ${t.maxChildren})`,
    ),
  }),
);

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
    displayName: text('display_name'),
    /** Sort position within the property. Defaults to the numeric part of the code. */
    displayOrder: integer('display_order').notNull().default(0),
    floor: text('floor'),
    notes: text('notes'),
    smokingPolicy: text('smoking_policy').notNull().default('unspecified'),
    wheelchairAccessible: boolean('wheelchair_accessible').notNull().default(false),
    connectedRoomUnitId: uuid('connected_room_unit_id'),
    mapX: integer('map_x'),
    mapY: integer('map_y'),
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
export const maintenanceBlocks = pgTable(
  'maintenance_blocks',
  {
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
    /**
     * What the block is for. `out_of_service` is maintenance: the room is broken or being worked on.
     * `blocked` holds a sound room back from sale (owner use, staff, an event). Both take the room
     * off sale and update channels; the kind only changes how the desk sees it. CHECK-constrained
     * text, never an enum (see configuration.ts).
     */
    kind: text('kind').notNull().default('out_of_service'),
    blockedByUserId: uuid('blocked_by_user_id'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindValid: check(
      'maintenance_blocks_kind_valid',
      sql`${t.kind} in ('out_of_service', 'blocked')`,
    ),
  }),
);

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
