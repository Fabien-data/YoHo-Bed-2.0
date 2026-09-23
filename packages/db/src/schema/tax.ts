import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  check,
  unique,
} from 'drizzle-orm/pg-core';
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
  /**
   * Whether a tax-exempt reservation (an embassy, a diplomat) is excused from this tax
   * (Development Phase 02). A service charge is the hotel's, not the state's, so it never is.
   */
  exemptible: boolean('exemptible').notNull().default(true),
  /**
   * Tax engine v2 (Sprint 7), read only for `exclusive_forward` properties. `code` is the short
   * name (SC, SST, GST); `compound` charges the tax on the price plus the taxes before it;
   * `invoice_label` is what a document prints; `display_group` 'gst_split' prints India's GST as
   * CGST + SGST halves.
   */
  code: text('code'),
  compound: boolean('compound').notNull().default(false),
  invoiceLabel: text('invoice_label'),
  displayGroup: text('display_group').notNull().default('single'),
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
  /**
   * A slab (Sprint 7): the rate applies only when the pre-tax value per room per night is within
   * [min_amount, max_amount]. India's GST is two slab rows of one tax type. The legacy resolver
   * (`resolveTaxRatesForDates`) ignores slab rows; only the forward engine reads them.
   */
  minAmount: numeric('min_amount', { precision: 12, scale: 2 }),
  maxAmount: numeric('max_amount', { precision: 12, scale: 2 }),
});

/**
 * A fixed charge per room per night that is not a tax on the price (Sprint 7) — Malaysia's
 * Tourism Tax. Posted as its own folio line (`source = 'levy'`, `levy_code = code`); see
 * `@yohobed/domain/levies` for who is charged.
 */
export const propertyLevies = pgTable(
  'property_levies',
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
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    basis: text('basis').notNull().default('per_room_per_night'),
    appliesTo: text('applies_to').notNull().default('non_resident'),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    /** The operator's registration for the levy, printed beside the line (the TTx number). */
    registrationNo: text('registration_no'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('property_levies_property_code_uq').on(t.propertyId, t.code),
    basisValid: check('property_levies_basis_valid', sql`${t.basis} in ('per_room_per_night')`),
    appliesValid: check(
      'property_levies_applies_valid',
      sql`${t.appliesTo} in ('non_resident', 'all')`,
    ),
    amountValid: check('property_levies_amount_valid', sql`${t.amount} >= 0`),
  }),
);

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
