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
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { rooms } from './inventory';

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

export const ratePlans = pgTable('rate_plans', {
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
  status: ratePlanStatus('status').notNull().default('Active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

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
