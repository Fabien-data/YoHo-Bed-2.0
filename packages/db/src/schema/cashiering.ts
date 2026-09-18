import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  numeric,
  integer,
  boolean,
  date,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { tenants, properties, users } from './identity';
import { bookings } from './bookings';
import { folios } from './folio';
import { marketSegments } from './configuration';
import { rooms } from './inventory';
import { ratePlans } from './rates';

/** The commission plans a travel agent or business source can carry (COMMISSION_PLANS). */
const COMMISSION_PLAN_CHECK = sql`in ('none', 'pct_all_nights', 'pct_first_night', 'fixed_per_night', 'fixed_per_stay')`;

/**
 * Who the hotel bills other than the guest in front of them — the city ledger.
 *
 * Deliberately one table for all three of Yanolja's kinds. A travel agent, a corporate account and
 * a sales person differ only in what they are called: each has a code, a credit limit and a running
 * balance, and every screen that touches them wants the same columns.
 *
 * Not to be confused with `referral_partners`, which is the opposite direction — a referrer *earns*
 * commission from us, while a ledger account *owes* us money.
 */
export const ledgerAccountType = pgEnum('ledger_account_type', [
  'travel_agent',
  'company',
  'sales_person',
  'other',
]);

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Null = available to every property of the tenant. */
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    type: ledgerAccountType('type').notNull().default('company'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    taxId: text('tax_id'),
    /** 0 means no limit is enforced. Checked when charging a folio to the account. */
    creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('LKR'),
    active: boolean('active').notNull().default(true),

    /**
     * Profile depth for invoicing and agent terms (Development Phase 02). The legal name and
     * registration numbers print on a company's tax invoice; the commission plan and discount are
     * a travel agent's contract terms.
     */
    legalName: text('legal_name'),
    countryCode: text('country_code'),
    stateCode: text('state_code'),
    city: text('city'),
    zip: text('zip'),
    mobile: text('mobile'),
    registrationNo: text('registration_no'),
    commissionPlan: text('commission_plan').notNull().default('none'),
    commissionValue: numeric('commission_value', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    discountPct: numeric('discount_pct', { precision: 6, scale: 3 }).notNull().default('0'),
    defaultMarketSegmentId: uuid('default_market_segment_id').references(() => marketSegments.id, {
      onDelete: 'set null',
    }),
    paymentTermsDays: integer('payment_terms_days').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('ledger_accounts_tenant_code_uq').on(t.tenantId, t.code),
    commissionPlanValid: check(
      'ledger_accounts_commission_plan_valid',
      sql`${t.commissionPlan} ${COMMISSION_PLAN_CHECK}`,
    ),
  }),
);

/**
 * A travel agent's or company's contract rates — Yanolja's "Rate Offered: Contract"
 * (Development Phase 02, Pro).
 *
 * A row prices one room type (optionally one meal plan) over a date range, either as a fixed
 * tax-inclusive nightly rate or as a percentage off the list rate. When several rows cover a
 * night, the one naming the meal plan wins, then the one starting latest.
 */
export const ledgerAccountRates = pgTable(
  'ledger_account_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ledgerAccountId: uuid('ledger_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** Null = every meal plan of the room type. */
    ratePlanId: uuid('rate_plan_id').references(() => ratePlans.id, { onDelete: 'cascade' }),
    /** Inclusive on both ends. */
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').notNull(),
    /** fixed: `value` is the tax-inclusive nightly rate. discount_pct: `value` percent off the list. */
    mode: text('mode').notNull().default('fixed'),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(true),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index('ledger_account_rates_lookup_idx').on(
      t.ledgerAccountId,
      t.roomId,
      t.validFrom,
    ),
    rangeValid: check('ledger_account_rates_range_valid', sql`${t.validTo} >= ${t.validFrom}`),
    modeValid: check(
      'ledger_account_rates_mode_valid',
      sql`${t.mode} in ('fixed', 'discount_pct')`,
    ),
    valueValid: check(
      'ledger_account_rates_value_valid',
      sql`${t.value} >= 0 and (${t.mode} <> 'discount_pct' or ${t.value} <= 100)`,
    ),
  }),
);

/** `debit` increases what the account owes us; `credit` is money they have paid. */
export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);

/**
 * The running account. Balance is the sum of debits minus credits — never stored, because a stored
 * balance and its entries are two answers to the same question.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'cascade' }),
    direction: ledgerDirection('direction').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('LKR'),
    description: text('description').notNull(),
    /** What put it here, when it came from a stay. */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    folioId: uuid('folio_id').references(() => folios.id, { onDelete: 'set null' }),
    reference: text('reference'),
    postedByUserId: uuid('posted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ accountIdx: index('ledger_entries_account_idx').on(t.accountId, t.createdAt) }),
);

/**
 * Where the business came from — Yanolja's colour-coded source, which is what makes a tape chart
 * readable at a glance ("the blue ones are all Booking.com").
 */
export const businessSources = pgTable(
  'business_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    shortCode: text('short_code').notNull(),
    name: text('name').notNull(),
    /**
     * Legacy free hex colour (Sprint 6). Superseded by `palette`, which resolves to theme-aware
     * tokens; kept so nothing that still reads it breaks.
     */
    color: text('color').notNull().default('#5b7cfa'),
    active: boolean('active').notNull().default(true),

    /**
     * Yanolja's "Booking Source" is the category of a business source: a reservation picks the
     * category first, then a source within it (Development Phase 02).
     * direct | ota | travel_agent | corporate
     */
    category: text('category').notNull().default('direct'),
    registrationNo: text('registration_no'),
    /** The segment a reservation from this source starts with (the user may change it). */
    defaultMarketSegmentId: uuid('default_market_segment_id').references(() => marketSegments.id, {
      onDelete: 'set null',
    }),
    commissionPlan: text('commission_plan').notNull().default('none'),
    commissionValue: numeric('commission_value', { precision: 12, scale: 4 })
      .notNull()
      .default('0'),
    /** A TAG_COLORS key — the bar and chip colour on Stay View and the reservation list. */
    palette: text('palette').notNull().default('slate'),
    /** The channel already collected Malaysia's tourism tax, so the hotel must not charge it. */
    collectsTourismTax: boolean('collects_tourism_tax').notNull().default(false),
    sort: integer('sort').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('business_sources_tenant_code_uq').on(t.tenantId, t.shortCode),
    categoryValid: check(
      'business_sources_category_valid',
      sql`${t.category} in ('direct', 'ota', 'travel_agent', 'corporate')`,
    ),
    commissionPlanValid: check(
      'business_sources_commission_plan_valid',
      sql`${t.commissionPlan} ${COMMISSION_PLAN_CHECK}`,
    ),
  }),
);

/** A physical till. A property may run several — front desk, restaurant, spa. */
export const cashDrawers = pgTable(
  'cash_drawers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ nameUnique: unique('cash_drawers_property_name_uq').on(t.propertyId, t.name) }),
);

export const drawerSessionStatus = pgEnum('drawer_session_status', ['open', 'closed']);

/**
 * One cashier's shift on one till — Yanolja's Cashier Report.
 *
 * `declaredTotal` is what the cashier counted; the expected total is derived from the payments and
 * expenses attached to the session. The gap between them is the whole point of the screen, so the
 * variance is computed at close and frozen rather than recalculated later from moving data.
 */
export const drawerSessions = pgTable(
  'drawer_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    drawerId: uuid('drawer_id')
      .notNull()
      .references(() => cashDrawers.id, { onDelete: 'cascade' }),
    status: drawerSessionStatus('status').notNull().default('open'),
    openingFloat: numeric('opening_float', { precision: 14, scale: 2 }).notNull().default('0'),
    openedByUserId: uuid('opened_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    /** What the cashier physically counted at close. */
    declaredTotal: numeric('declared_total', { precision: 14, scale: 2 }),
    /** What the system says should be there. Frozen at close. */
    expectedTotal: numeric('expected_total', { precision: 14, scale: 2 }),
    /** declared − expected. Negative is a shortfall. */
    variance: numeric('variance', { precision: 14, scale: 2 }),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ drawerIdx: index('drawer_sessions_drawer_idx').on(t.drawerId, t.status) }),
);

export const expenseCategory = pgEnum('expense_category', [
  'supplies',
  'maintenance',
  'transport',
  'staff',
  'utilities',
  'other',
]);

/** Money out of the till — Yanolja's Expense Voucher. Counts against the drawer at close. */
export const expenseVouchers = pgTable('expense_vouchers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  /** Null for an expense paid outside a till (bank transfer, card). */
  drawerSessionId: uuid('drawer_session_id').references(() => drawerSessions.id, {
    onDelete: 'set null',
  }),
  voucherNo: text('voucher_no').notNull(),
  category: expenseCategory('category').notNull().default('other'),
  payee: text('payee').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('LKR'),
  reference: text('reference'),
  note: text('note'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
