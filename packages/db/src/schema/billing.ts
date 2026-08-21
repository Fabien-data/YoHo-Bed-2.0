import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  date,
  jsonb,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants } from './identity';
import type { PlanFeatures } from '@yohobed/domain';

/**
 * Subscription billing & entitlements (Yanolja-parity program, Sprint 0).
 *
 * YohoBed 2.0 is sold as a subscription SaaS, so what a tenant may do is a product decision, not
 * a role decision — `memberships.role` answers "who are you", these tables answer "what did you
 * buy". Resolution lives in `resolveEntitlements()` in @yohobed/domain so the API and the web app
 * cannot disagree about it.
 *
 * `plans` is a global catalogue (no tenant_id, no RLS). `subscriptions` and `tenant_features` are
 * tenant-owned and RLS-scoped like everything else.
 */

export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'cancelled',
]);

export const planStatus = pgEnum('plan_status', ['active', 'archived']);

/** A sellable tier. `features` is a `PlanFeatures` document — see @yohobed/domain/entitlements. */
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  priceMonthly: numeric('price_monthly', { precision: 12, scale: 2 }).notNull().default('0'),
  /** Billing currency of the subscription itself — unrelated to a property's base currency. */
  currency: text('currency').notNull().default('USD'),
  features: jsonb('features').$type<PlanFeatures>().notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  status: planStatus('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One row per tenant — the tier they are on right now. */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => plans.id),
  status: subscriptionStatus('status').notNull().default('trialing'),
  currentPeriodStart: date('current_period_start'),
  currentPeriodEnd: date('current_period_end'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  seats: integer('seats').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-tenant override on top of the plan — how support grants one module off-plan without
 * inventing a bespoke tier. `limit_value` is only meaningful for LIMIT_KEYS.
 */
export const tenantFeatures = pgTable(
  'tenant_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    limitValue: integer('limit_value'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantKeyUnique: unique('tenant_features_tenant_key_uq').on(t.tenantId, t.key) }),
);
