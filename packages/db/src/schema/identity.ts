import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

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
export const roleKey = pgEnum('role_key', ['OWNER', 'OWNER_STAFF', 'YOHO_STAFF', 'YOHO_ADMIN']);

/** A tenant = a property owner (legacy `propertyowners`). The root of every ownership chain. */
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  legacyId: integer('legacy_id').unique(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  status: tenantStatus('status').notNull().default('active'),
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
export const properties = pgTable('properties', {
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
