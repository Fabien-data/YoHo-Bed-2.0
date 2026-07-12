import { pgTable, pgEnum, uuid, text, integer, date, timestamp, unique, check } from 'drizzle-orm/pg-core';
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roomDateUnique: unique('availability_room_date_uq').on(t.roomId, t.date),
    roomsToSellNonNegative: check('rooms_to_sell_non_negative', sql`${t.roomsToSell} >= 0`),
  }),
);
