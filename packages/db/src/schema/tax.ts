import { pgTable, uuid, text, integer, numeric, date, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, properties } from './identity';

/**
 * Property tax configuration (Compartment A — parity foundation).
 *
 * Reproduces the legacy priority-ordered tax model (Constants.php / PricingCalculator.php):
 * a property links to named tax types at priority 1 (service charge), 2 (NBT), 3 (VAT); each
 * tax type carries time-bounded rate durations. On a given date the applicable rates are summed
 * by priority and used to decompose the tax portion out of the tax-inclusive selling price
 * (see `taxFromSelling` in @yohobed/domain). A property with no rows here has zero tax — the
 * common case, and the exact current behaviour, so nothing changes for untaxed properties.
 */

/** A named tax (e.g. "VAT", "NBT", "Service Charge"). */
export const taxTypes = pgTable('tax_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A time-bounded rate for a tax type. `rate_percent` is a percentage: 10 = 10%. */
export const taxDurations = pgTable('tax_durations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  taxTypeId: uuid('tax_type_id')
    .notNull()
    .references(() => taxTypes.id, { onDelete: 'cascade' }),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  ratePercent: numeric('rate_percent', { precision: 7, scale: 4 }).notNull(),
});

/** Links a property to a tax type at a legacy priority (1 service charge, 2 NBT, 3 VAT). */
export const propertyTaxTypes = pgTable(
  'property_tax_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    taxTypeId: uuid('tax_type_id')
      .notNull()
      .references(() => taxTypes.id, { onDelete: 'cascade' }),
    priority: integer('priority').notNull(),
  },
  (t) => ({
    priorityValid: check('property_tax_priority_valid', sql`${t.priority} in (1, 2, 3)`),
  }),
);
