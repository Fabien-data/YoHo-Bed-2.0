import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  date,
  jsonb,
  timestamp,
  integer,
  numeric,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { tenants, properties, users } from './identity';

/**
 * The property's *business* date, which is not today's date.
 *
 * A hotel's day ends when the night auditor says it does — often at 3am — so a charge posted at
 * 01:30 belongs to the previous business day. Every posting and report keys off this rather than
 * `current_date`, which is the difference between a report that reconciles and one that does not.
 *
 * One row per property: they may legitimately sit on different dates when a chain spans time zones,
 * or when one property's auditor has run and another's has not.
 */
export const businessDates = pgTable(
  'business_dates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    currentDate: date('current_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ propertyUnique: unique('business_dates_property_uq').on(t.propertyId) }),
);

/**
 * One run of the night audit — Yanolja's Night Audit Log.
 *
 * Records the user and the IP because this is the single most consequential button in the product:
 * it posts revenue, writes off no-shows, closes tills and moves the date everything else is
 * measured against. "Who rolled us into the 8th, and from where" has to be answerable.
 *
 * `summary` holds the counts and totals the run produced, frozen as they were. Recomputing them
 * later would give a different answer the moment anything is back-dated, which would make the log
 * useless for exactly the disputes it exists to settle.
 */
export const nightAuditRuns = pgTable(
  'night_audit_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** The business date being closed. */
    fromDate: date('from_date').notNull(),
    /** The business date the property is left on. */
    toDate: date('to_date').notNull(),
    roomsCharged: integer('rooms_charged').notNull().default(0),
    chargesPosted: numeric('charges_posted', { precision: 14, scale: 2 }).notNull().default('0'),
    taxesPosted: numeric('taxes_posted', { precision: 14, scale: 2 }).notNull().default('0'),
    noShows: integer('no_shows').notNull().default(0),
    drawersClosed: integer('drawers_closed').notNull().default(0),
    summary: jsonb('summary').notNull().default({}),
    runByUserId: uuid('run_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    runFromIp: text('run_from_ip'),
    /**
     * `manual`: someone pressed Run. `auto`: the property closes its day by itself at the time the
     * owner set (migration 0043) — there is then no user and no IP, and the log says so.
     */
    trigger: text('trigger').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    triggerValid: check('night_audit_runs_trigger_valid', sql`${t.trigger} in ('manual', 'auto')`),
  }),
);
