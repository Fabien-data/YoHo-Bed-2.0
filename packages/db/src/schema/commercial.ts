import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { bookings } from './bookings';

/**
 * Commercial (Compartment D) — the legacy deals/promotions/coupons/referrals surface.
 *
 * - `promotions`: owner-defined named discount campaigns (a %, a date range, a minimum stay). An
 *   applied promotion pushes its discount onto the rate calendar for its window.
 * - `coupons` + `coupon_redemptions`: guest discount codes (percentage or fixed) redeemed at
 *   booking time, with usage tracking.
 * - `referral_partners` + `referral_commissions`: referral codes that earn a commission (a % of
 *   the commissionable amount) recorded against the booking for settlement.
 */

export const couponType = pgEnum('coupon_type', ['percentage', 'fixed']);
export const referralStatus = pgEnum('referral_status', ['pending', 'paid']);

export const promotions = pgTable('promotions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  discountPct: numeric('discount_pct', { precision: 5, scale: 2 }).notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  minNights: integer('min_nights').notNull().default(1),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Null = applies to any of the tenant's properties. */
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    type: couponType('type').notNull().default('percentage'),
    /** Percent when type='percentage' (e.g. 10 = 10%), else a fixed LKR amount. */
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    /** 0 = unlimited. */
    maxUses: integer('max_uses').notNull().default(0),
    usedCount: integer('used_count').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ codeUnique: unique('coupons_tenant_code_uq').on(t.tenantId, t.code) }),
);

export const couponRedemptions = pgTable('coupon_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  couponId: uuid('coupon_id')
    .notNull()
    .references(() => coupons.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const referralPartners = pgTable(
  'referral_partners',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ codeUnique: unique('referral_partners_tenant_code_uq').on(t.tenantId, t.code) }),
);

export const referralCommissions = pgTable('referral_commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  referralPartnerId: uuid('referral_partner_id')
    .notNull()
    .references(() => referralPartners.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  status: referralStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
