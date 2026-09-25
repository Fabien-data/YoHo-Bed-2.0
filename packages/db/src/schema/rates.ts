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
  unique,
  check,
  boolean,
  jsonb,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { RateTypeAddOn } from '@yohobed/domain';
import { tenants, properties } from './identity';
import { rooms } from './inventory';
import { marketSegments } from './configuration';

/**
 * Rates (Phase 4) — the unified per-day model that collapses the legacy rate-code/pricing sprawl.
 *
 * rate_plans (a room × meal-plan) → occupancies (a guest configuration) → rate_calendar
 * (one base+commission+selling price per occupancy per date). Selling prices are computed by the
 * parity-tested `@yohobed/domain` engine, never stored by hand.
 */

export const ratePlanStatus = pgEnum('rate_plan_status', ['Active', 'Inactive']);

/** Global meal-plan lookup: RO, BB, HB, FB, AI (seeded). */
export const rateCodes = pgTable('rate_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

/**
 * Yanolja's Rate Type (Configuration, owner brief 2026-09-26): a named pricing structure the hotel
 * sells — "BB", "Corporate BB", "Honeymoon package" — with the meal plan its price includes and
 * any chargeable add-ons bundled in. A rate plan is one room type sold under one rate type.
 *
 * The meal plan keeps meaning what `rate_codes` says (RO/BB/HB/FB/AI): a rate plan still points at
 * its meal plan, which is what pricing and the channels read. Add-ons become the stay's included
 * inclusions at booking, so the guest pays one price and the folio never charges them twice.
 */
export const rateTypes = pgTable(
  'rate_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shortCode: text('short_code').notNull(),
    mealPlan: text('meal_plan').notNull().default('RO'),
    addOns: jsonb('add_ons').$type<RateTypeAddOn[]>().notNull().default([]),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('rate_types_property_code_uq').on(t.propertyId, t.shortCode),
    mealPlanValid: check(
      'rate_types_meal_plan_valid',
      sql`${t.mealPlan} in ('RO', 'BB', 'HB', 'FB', 'AI')`,
    ),
  }),
);

export const ratePlans = pgTable(
  'rate_plans',
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
    rateCodeId: uuid('rate_code_id')
      .notNull()
      .references(() => rateCodes.id),
    /** The hotel's rate type this plan sells (2026-09-26); its meal plan is `rate_code_id`. */
    rateTypeId: uuid('rate_type_id').references((): AnyPgColumn => rateTypes.id, {
      onDelete: 'set null',
    }),
    status: ratePlanStatus('status').notNull().default('Active'),
    /**
     * Who the plan is sold to (Development Phase 02): all | local | foreign. A resident rate is
     * only offered to a local guest, a foreign rate only to a foreign one.
     */
    audience: text('audience').notNull().default('all'),
    /** The market segment a reservation on this plan starts with; it outranks the source's. */
    marketSegmentId: uuid('market_segment_id').references(() => marketSegments.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    audienceValid: check(
      'rate_plans_audience_valid',
      sql`${t.audience} in ('all', 'local', 'foreign')`,
    ),
  }),
);

export const occupancies = pgTable('occupancies', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  ratePlanId: uuid('rate_plan_id')
    .notNull()
    .references(() => ratePlans.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  accommodates: integer('accommodates').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rateCalendar = pgTable(
  'rate_calendar',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    occupancyId: uuid('occupancy_id')
      .notNull()
      .references(() => occupancies.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull(),
    commission: numeric('commission', { precision: 12, scale: 2 }).notNull(),
    sellingPrice: numeric('selling_price', { precision: 12, scale: 2 }).notNull(),
    /**
     * The pre-tax price (Sprint 7), stored for `exclusive_forward` properties, which price from it
     * and charge taxes on top. `selling_price` stays the tax-inclusive figure for every reader.
     * Null on the legacy path.
     */
    netPrice: numeric('net_price', { precision: 12, scale: 2 }),
    /** Owner-set last-minute discount % on the selling price for near-term stays (0 = none). */
    lastMinuteDropPct: numeric('last_minute_drop_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ occDateUnique: unique('rate_calendar_occ_date_uq').on(t.occupancyId, t.date) }),
);

/**
 * Commission slabs for properties whose `commission_type = 'slab'` (legacy `commissionslabs`).
 * The Yoho commission for a base price is the value of the slab where
 * `slab_start <= base <= slab_end`. Percentage-commission properties don't use this table.
 */
export const commissionSlabs = pgTable('commission_slabs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  slabStart: numeric('slab_start', { precision: 12, scale: 2 }).notNull(),
  slabEnd: numeric('slab_end', { precision: 12, scale: 2 }).notNull(),
  commission: numeric('commission', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A named date range for seasonal authoring (legacy `seasons`). It gives a span a name the owner
 * can paint prices across; the resulting per-day prices live in `rate_calendar` (the source of
 * truth), so a season is an authoring overlay, not a second price store.
 */
export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
