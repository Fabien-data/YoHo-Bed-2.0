import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';

/**
 * Reservation-desk master lists (Development Phase 02).
 *
 * These are the owner-maintained lists every reservation picks from. Each tenant gets a copy of
 * its country's preset when first seeded (`seedDefaultMasters`) and edits freely from then on.
 * Entries are deactivated, never deleted, because past reservations and reports still name them.
 *
 * The enum-like columns are CHECK-constrained text rather than Postgres enums. Adding a value to
 * an enum cannot be used in the same migration run (Drizzle applies every pending migration in a
 * single transaction), and these vocabularies are expected to grow.
 */

/** Yanolja's "Market Segment": why the guest is staying, for revenue analysis. */
export const marketSegments = pgTable(
  'market_segments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** transient | group | contract | non_revenue */
    grp: text('grp').notNull().default('transient'),
    /** A TAG_COLORS key. */
    palette: text('palette').notNull().default('slate'),
    /** Complimentary and house-use nights are not "sold" in occupancy and ADR. */
    excludedFromSold: boolean('excluded_from_sold').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('market_segments_tenant_code_uq').on(t.tenantId, t.code),
    grpValid: check(
      'market_segments_grp_valid',
      sql`${t.grp} in ('transient', 'group', 'contract', 'non_revenue')`,
    ),
  }),
);

/**
 * How a guest can pay at this hotel — the Payment Mode dropdown.
 *
 * `category` is what the money does (cash goes into a drawer, city_ledger bills an account); the
 * name is whatever the hotel calls it. `property_id` null means every property of the tenant.
 */
export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    /** cash | card | bank_transfer | qr | wallet | cheque | city_ledger | online | other */
    category: text('category').notNull().default('other'),
    /** A transfer or QR payment is only traceable with its reference number. */
    requiresReference: boolean('requires_reference').notNull().default(false),
    isDefaultCash: boolean('is_default_cash').notNull().default(false),
    /** Money taken before arrival is recorded as a guest advance (deposit). */
    isGuestAdvance: boolean('is_guest_advance').notNull().default(false),
    /** A foreign-cash line such as "Cash (USD)"; null means the property's base currency. */
    currency: text('currency'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('payment_methods_tenant_code_uq').on(t.tenantId, t.code),
    categoryValid: check(
      'payment_methods_category_valid',
      sql`${t.category} in ('cash', 'card', 'bank_transfer', 'qr', 'wallet', 'cheque', 'city_ledger', 'online', 'other')`,
    ),
  }),
);
