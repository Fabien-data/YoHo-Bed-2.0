import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  unique,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { customers } from './bookings';

/**
 * The Configuration lists from Yanolja's Settings menu that YoHoBed did not have yet (owner brief,
 * 2026-09-26): Holidays, Guest Attributes, Discounts, saved Remarks and Payout types. Each is a
 * short list the owner keeps, which other screens then offer to pick from.
 */

/** A holiday or special date — marked on Stay View and the rates calendar. */
export const holidays = pgTable(
  'holidays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    name: text('name').notNull(),
    /** Falls on the same day every year (a national day) rather than once (a Poya day). */
    recurring: boolean('recurring').notNull().default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateNameUnique: unique('holidays_property_date_name_uq').on(t.propertyId, t.date, t.name),
  }),
);

/**
 * A guest attribute: a label the hotel puts on a guest's profile ("Repeat guest", "Blacklisted",
 * "Allergic to nuts") that every reservation for that guest then shows.
 */
export const guestAttributes = pgTable(
  'guest_attributes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** A categorical palette key (TAG_COLORS). */
    color: text('color').notNull().default('slate'),
    description: text('description'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: uniqueIndex('guest_attributes_tenant_name_uq').on(
      t.tenantId,
      sql`lower(${t.name})`,
    ),
  }),
);

/** Which attributes a guest carries. */
export const customerAttributes = pgTable(
  'customer_attributes',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => guestAttributes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.customerId, t.attributeId] }) }),
);

/**
 * A named discount the desk can apply to a reservation's nightly rate ("Staff 20%", "Long stay").
 * Applying one types the discounted rate with the discount as its reason, so the price rules the
 * desk already works under — the staff limit and the owner's approval beyond it — still apply.
 */
export const discounts = pgTable(
  'discounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** `percent` off the nightly rate, or a fixed `amount` off each night (property currency). */
    kind: text('kind').notNull().default('percent'),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    description: text('description'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('discounts_property_code_uq').on(t.propertyId, t.code),
    kindValid: check('discounts_kind_valid', sql`${t.kind} in ('percent', 'amount')`),
    valueValid: check(
      'discounts_value_valid',
      sql`${t.value} > 0 and (${t.kind} <> 'percent' or ${t.value} <= 100)`,
    ),
  }),
);

/** A saved remark the desk adds with one click ("Late arrival — keep the room"). */
export const remarkTemplates = pgTable(
  'remark_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Which department reads it — one of REMARK_TYPES. */
    type: text('type').notNull().default('general'),
    text: text('text').notNull(),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    typeValid: check(
      'remark_templates_type_valid',
      sql`${t.type} in ('general', 'front_desk', 'housekeeping', 'accounts', 'kitchen', 'preference')`,
    ),
  }),
);

/**
 * Why money leaves the till — Yanolja's Payouts (eZee's "paid out" reasons): "Taxi fare paid for
 * a guest", "Petty cash — supplies". The Cashiering expense voucher picks one; it reports under
 * its fixed `category`.
 */
export const payoutTypes = pgTable(
  'payout_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('other'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('payout_types_tenant_code_uq').on(t.tenantId, t.code),
    categoryValid: check(
      'payout_types_category_valid',
      sql`${t.category} in ('supplies', 'maintenance', 'transport', 'staff', 'utilities', 'other')`,
    ),
  }),
);
