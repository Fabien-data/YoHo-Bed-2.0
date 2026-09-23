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
  boolean,
  jsonb,
  unique,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import type { TaxLine } from '@yohobed/domain';
import { tenants, properties, users } from './identity';
import { bookings, customers } from './bookings';

/**
 * The guest account — Yanolja's folio window.
 *
 * A booking may carry several: the guest settles their own extras while the company pays the
 * room, so charges have to be movable between windows without splitting the reservation. Window 1
 * is created on demand and is where room charges land.
 */
export const folioStatus = pgEnum('folio_status', ['open', 'closed', 'void']);

export const folios = pgTable(
  'folios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    /** 1-based window number within the booking, as printed on the bill. */
    window: integer('window').notNull().default(1),
    /** Who this window bills — "Guest", "Company", "Travel agent". */
    label: text('label').notNull().default('Guest'),
    status: folioStatus('status').notNull().default('open'),
    /**
     * Inherited from the booking, never chosen per folio. A bill that mixed currencies could not
     * be totalled, and the booking is already denominated in its property's base currency.
     */
    currency: text('currency').notNull().default('LKR'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /**
     * Who this window bills (Development Phase 02, Sprint 5): the guest, or a company or travel
     * agent on the city ledger. Set from the reservation's Bill To. At check-out a ledger payer's
     * balance moves to its account (Pro).
     */
    payerType: text('payer_type').notNull().default('guest'),
    payerCustomerId: uuid('payer_customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    /** FK to ledger_accounts, added in migration 0030 (a schema-module cycle otherwise). */
    payerLedgerAccountId: uuid('payer_ledger_account_id'),
    /**
     * The charge sources this window takes by routing: `{manual,pos,inclusion}` on the guest's
     * window of "room and tax to the company, extras to the guest". Empty = nothing routed here;
     * window 1 takes whatever no window claims.
     */
    routes: text('routes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingWindowUnique: unique('folios_booking_window_uq').on(t.bookingId, t.window),
    payerTypeValid: check(
      'folios_payer_type_valid',
      sql`${t.payerType} in ('guest', 'company', 'travel_agent')`,
    ),
  }),
);

/**
 * The catalogue of things a hotel can charge for — Yanolja's "particulars".
 *
 * Per-tenant rather than global: one hotel's "Laundry" is taxed and another's is not, and the
 * codes end up on their printed bills.
 */
export const chargeCategory = pgEnum('charge_category', [
  'room',
  'food',
  'beverage',
  'service',
  'misc',
]);

export const chargeParticulars = pgTable(
  'charge_particulars',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: chargeCategory('category').notNull().default('misc'),
    defaultPrice: numeric('default_price', { precision: 12, scale: 2 }).notNull().default('0'),
    /** Percentage applied on posting, e.g. 15.00. Zero for untaxed extras. */
    taxRatePct: numeric('tax_rate_pct', { precision: 6, scale: 3 }).notNull().default('0'),
    /**
     * When true the entered price already contains the tax, and the tax is decomposed out of it —
     * the same convention the room rate uses, so a bill never mixes tax-in and tax-on lines.
     */
    taxInclusive: boolean('tax_inclusive').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('charge_particulars_tenant_code_uq').on(t.tenantId, t.code),
  }),
);

export const chargeSource = pgEnum('charge_source', [
  'room',
  'manual',
  'pos',
  'inclusion',
  // Sprint 7: Malaysia's tourism tax and any other per-room-night levy.
  'levy',
]);

/**
 * One line on the bill.
 *
 * Room charges are **copied** from the `booking_days` snapshot, never recomputed: the money engine
 * already decided what each night costs, and a second calculation is a second answer waiting to
 * disagree. `bookingDate` records which night a room charge came from, and is what makes posting
 * idempotent.
 *
 * Voiding stamps `voidedAt` rather than deleting: a bill that silently loses a line is worse than
 * one that shows a line was reversed.
 */
export const folioCharges = pgTable(
  'folio_charges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    folioId: uuid('folio_id')
      .notNull()
      .references(() => folios.id, { onDelete: 'cascade' }),
    particularId: uuid('particular_id').references(() => chargeParticulars.id, {
      onDelete: 'set null',
    }),
    source: chargeSource('source').notNull().default('manual'),
    description: text('description').notNull(),
    /** The business date the charge belongs to — what the bill and night audit group by. */
    postedFor: date('posted_for').notNull(),
    /** For `source = 'room'`: the night in `booking_days` this line was copied from. */
    bookingDate: date('booking_date'),
    quantity: numeric('quantity', { precision: 10, scale: 2 }).notNull().default('1'),
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    /** Net of tax. `net + tax = total`, always. */
    net: numeric('net', { precision: 12, scale: 2 }).notNull(),
    tax: numeric('tax', { precision: 12, scale: 2 }).notNull().default('0'),
    total: numeric('total', { precision: 12, scale: 2 }).notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
    /** Who reversed the line (UX-1a): a void is a money reversal and is always on the record. */
    voidedByUserId: uuid('voided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    postedByUserId: uuid('posted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The tax split of `tax`, per tax, adding up to it exactly (Development Phase 02). */
    taxLines: jsonb('tax_lines').$type<TaxLine[]>(),
    /**
     * The inclusion this line was posted for. FK added in migration 0030 (a schema-module cycle
     * otherwise); a partial unique index there stops one inclusion being posted twice for a night.
     */
    bookingInclusionId: uuid('booking_inclusion_id'),
    /**
     * The levy this line charges (Sprint 7), e.g. `TTX`. With `booking_date`, the night it is for;
     * a partial unique index stops a levy being posted twice for one night on one window.
     */
    levyCode: text('levy_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    folioIdx: index('folio_charges_folio_idx').on(t.folioId, t.postedFor),
    // Keyed on levy_code, not source: the 'levy' enum value is added by the same migration and
    // cannot be used in it.
    levyNightUnique: uniqueIndex('folio_charges_levy_night_uq')
      .on(t.folioId, t.levyCode, t.bookingDate)
      .where(sql`${t.levyCode} is not null and ${t.voidedAt} is null`),
    levyHasNight: check(
      'folio_charges_levy_night',
      sql`${t.levyCode} is null or ${t.bookingDate} is not null`,
    ),
  }),
);

/**
 * An audit row for every charge moved between windows — Yanolja's split/transfer bill.
 *
 * The move itself is an update to `folio_charges.folio_id`; this records that it happened, so
 * "why is the minibar on the company bill?" has an answer.
 */
export const folioTransfers = pgTable('folio_transfers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  chargeId: uuid('charge_id')
    .notNull()
    .references(() => folioCharges.id, { onDelete: 'cascade' }),
  fromFolioId: uuid('from_folio_id')
    .notNull()
    .references(() => folios.id, { onDelete: 'cascade' }),
  toFolioId: uuid('to_folio_id')
    .notNull()
    .references(() => folios.id, { onDelete: 'cascade' }),
  reason: text('reason'),
  movedByUserId: uuid('moved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
