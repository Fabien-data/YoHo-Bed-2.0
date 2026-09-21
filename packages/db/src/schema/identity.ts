import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  time,
  timestamp,
  unique,
  jsonb,
  check,
  doublePrecision,
} from 'drizzle-orm/pg-core';

/**
 * The tax and business registration numbers a property prints on its documents. Sparse: a key is
 * present only when the property has that registration.
 */
export interface PropertyTaxIds {
  /** Sri Lanka: 9-digit Taxpayer Identification Number (VAT). */
  tin?: string;
  /** Sri Lanka: SSCL registration, when it differs from the TIN. */
  ssclRegNo?: string;
  /** Sri Lanka: SLTDA registration / TDL number. */
  sltdaRegNo?: string;
  /** India: 15-character GSTIN. */
  gstin?: string;
  /** Malaysia: SST registration number. */
  sstNo?: string;
  /** Malaysia: Tourism Tax registration number (printed beside the TTx line). */
  ttxNo?: string;
  /** Malaysia: business registration number (BRN), needed for MyInvois. */
  brn?: string;
}

/**
 * Identity & Tenancy (Phase 1).
 *
 * Replaces the legacy model where the authenticated principal was a `propertyowners` row and
 * tenant isolation was enforced only by a trusted `Session('property_id')` plus a hardcoded
 * admin-email backdoor. Here every tenant-owned row carries an explicit `tenant_id`, access is
 * a real role, and isolation is enforced by both an application query-scope and Postgres RLS.
 */

/** 'pending' = self-registered, awaiting YoHo staff approval (Compartment H onboarding). */
export const tenantStatus = pgEnum('tenant_status', ['pending', 'active', 'inactive', 'suspended']);
export const userStatus = pgEnum('user_status', ['active', 'invited', 'disabled']);

/** OWNER/OWNER_STAFF are tenant-scoped; YOHO_STAFF/YOHO_ADMIN are cross-tenant staff roles. */
export const roleKey = pgEnum('role_key', [
  'OWNER',
  'OWNER_STAFF',
  'HOUSEKEEPING_ATTENDANT',
  'HOUSEKEEPING_SUPERVISOR',
  'YOHO_STAFF',
  'YOHO_ADMIN',
]);

/**
 * How a tenant reaches the market — see DistributionMode in @yohobed/domain.
 * 'yoho' keeps the platform commission and payout chain; 'standalone' is a pure PMS subscriber.
 */
export const distributionMode = pgEnum('distribution_mode', ['yoho', 'standalone']);

/** A tenant = a property owner (legacy `propertyowners`). The root of every ownership chain. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  legacyId: integer('legacy_id').unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  status: tenantStatus('status').notNull().default('active'),
  /**
   * Defaults to 'yoho' so every pre-existing tenant keeps the commission/payout behaviour it had
   * before subscriptions existed. Only new PMS-only subscribers are created 'standalone'.
   */
  distributionMode: distributionMode('distribution_mode').notNull().default('yoho'),
  /** When the owner accepted the platform agreement (Compartment H; legacy property agreement). */
  agreementAcceptedAt: timestamp('agreement_accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A login identity. `tenant_id` is null for cross-tenant YoHo staff. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  status: userStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** What a user may do, and where. A staff role has `tenant_id = null` (applies platform-wide). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    role: roleKey('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userTenantUnique: unique('memberships_user_tenant_uq').on(t.userId, t.tenantId) }),
);

/** Opaque refresh/session tokens (only the hash is stored). */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Password-reset tokens (60-minute expiry, enforced in the service layer). */
export const passwordResets = pgTable('password_resets', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Minimal tenant-owned exemplar so the tenant-scope + RLS machinery is real and testable now.
 * Fleshed out into the full Property & Inventory model in Phase 3.
 */
export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legacyId: integer('legacy_id').unique(),
    name: text('name').notNull(),
    /** How the Yoho commission is derived: 'percentage' (uses commissionPercentage) or 'slab'. */
    commissionType: text('commission_type').notNull().default('percentage'),
    commissionPercentage: numeric('commission_percentage', { precision: 6, scale: 2 })
      .notNull()
      .default('10'),
    /**
     * Base currency the property prices, stores, and settles in — 'LKR' or 'USD' only
     * (BASE_CURRENCIES in @yohobed/domain). Display-only currencies (INR/GBP/EUR) are never stored
     * here. All money on this property's bookings/invoices/payouts is denominated in this currency.
     */
    currency: text('currency').notNull().default('LKR'),

    /**
     * Property identity & operating parameters (Yanolja-parity Sprint 0). Every one of these is
     * consumed downstream: `code` is the number beside the property name in Yanolja's header;
     * the address block prints on registration cards and invoices; `timezone` is what the night
     * audit rolls the business date against; the check-in/out times seed every reservation.
     */
    code: text('code'),
    propertyType: text('property_type'),
    address: text('address'),
    addressLine2: text('address_line_2'),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    zip: text('zip'),
    phone: text('phone'),
    reservationPhone: text('reservation_phone'),
    email: text('email'),
    website: text('website'),
    fax: text('fax'),
    registrationNumber: text('registration_number'),
    additionalRegistrationNumbers: jsonb('additional_registration_numbers')
      .$type<string[]>()
      .notNull()
      .default([]),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    timezone: text('timezone').notNull().default('Asia/Colombo'),
    checkinTime: time('checkin_time').notNull().default('14:00:00'),
    checkoutTime: time('checkout_time').notNull().default('11:00:00'),
    starRating: integer('star_rating'),
    /**
     * Intentionally not a foreign key: `media` already references `properties`, so a FK back would
     * make the two table modules import each other. The application resolves it.
     */
    logoMediaId: uuid('logo_media_id'),

    /**
     * Regional identity (Development Phase 02). `country_code` (ISO 3166-1 alpha-2) is what selects
     * the regional preset, the title list, the phone default and — from Phase 02 Sprint 7 — the tax
     * and invoice profile. It is locked once the property has bookings, like `currency`.
     * `state_code` is the ISO subdivision for LK/MY and the GST state code for India.
     */
    countryCode: text('country_code').notNull().default('LK'),
    stateCode: text('state_code'),
    /** The registered business name printed on tax invoices, when it differs from `name`. */
    legalName: text('legal_name'),
    taxIds: jsonb('tax_ids').$type<PropertyTaxIds>().notNull().default({}),
    /** Sri Lanka's invoice serial carries a branch code (Gazette 2481/22 "QQQQ"). */
    branchCode: text('branch_code'),
    /** First month of the invoice-numbering year: 4 (April) for India and Sri Lanka. */
    fyStartMonth: integer('fy_start_month').notNull().default(4),
    invoicePrefix: text('invoice_prefix'),
    /** Reservation-desk settings, resolved by `resolvePropertySettings` in @yohobed/domain. */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fyStartMonthValid: check(
      'properties_fy_start_month_valid',
      sql`${t.fyStartMonth} between 1 and 12`,
    ),
    countryCodeShape: check('properties_country_code_shape', sql`${t.countryCode} ~ '^[A-Z]{2}$'`),
    coordinatesPair: check(
      'properties_coordinates_pair',
      sql`(${t.latitude} is null and ${t.longitude} is null) or (${t.latitude} is not null and ${t.longitude} is not null and ${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180)`,
    ),
  }),
);
