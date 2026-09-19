import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './identity';
import { bookings } from './bookings';
import { chargeParticulars } from './folio';

/**
 * What a stay includes beyond the room (Development Phase 02, Sprint 5): Yanolja's Inclusion and
 * Pick Up / Drop Off on a room line.
 */

/** The vehicles a hotel offers for transfers. Seeded per country, edited in Configuration. */
export const transportModes = pgTable(
  'transport_modes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** The usual price of one transfer, tax inclusive; the desk may change it per booking. */
    defaultPrice: numeric('default_price', { precision: 12, scale: 2 }).notNull().default('0'),
    sort: integer('sort').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ codeUnique: unique('transport_modes_tenant_code_uq').on(t.tenantId, t.code) }),
);

/** How often an inclusion is charged. */
export const INCLUSION_RHYTHMS = [
  'once',
  'per_night',
  'per_guest_per_night',
  'per_adult_per_night',
  'per_child_per_night',
] as const;

/**
 * Something a booking includes — breakfast, dinner, a driver's room, a spa credit.
 *
 * Night audit posts it to the folio as the stay goes on (`source = 'inclusion'`), routed to the
 * window that pays for extras. `includedInRate` means the room rate already pays for it: nothing is
 * posted, and the printed bill may show it separately without changing the room lines.
 */
export const bookingInclusions = pgTable(
  'booking_inclusions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    particularId: uuid('particular_id').references(() => chargeParticulars.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    rhythm: text('rhythm').notNull().default('per_night'),
    /** Tax inclusive, per unit (one night, one guest-night …). */
    unitPrice: numeric('unit_price', { precision: 12, scale: 2 }).notNull(),
    discountPct: numeric('discount_pct', { precision: 6, scale: 3 }).notNull().default('0'),
    taxRatePct: numeric('tax_rate_pct', { precision: 6, scale: 3 }).notNull().default('0'),
    includedInRate: boolean('included_in_rate').notNull().default(false),
    /** Print each posting as its own line, rather than one summary line. */
    itemize: boolean('itemize').notNull().default(true),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index('booking_inclusions_booking_idx').on(t.bookingId),
    rhythmValid: check(
      'booking_inclusions_rhythm_valid',
      sql`${t.rhythm} in ('once', 'per_night', 'per_guest_per_night', 'per_adult_per_night', 'per_child_per_night')`,
    ),
    discountValid: check(
      'booking_inclusions_discount_valid',
      sql`${t.discountPct} >= 0 and ${t.discountPct} <= 100`,
    ),
    priceValid: check('booking_inclusions_price_valid', sql`${t.unitPrice} >= 0`),
  }),
);

/**
 * A pick-up or drop-off. Its charge is posted when the transfer is marked done — a driver who
 * never went is not billed.
 */
export const bookingTransfers = pgTable(
  'booking_transfers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    transportModeId: uuid('transport_mode_id').references(() => transportModes.id, {
      onDelete: 'set null',
    }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    fromPlace: text('from_place'),
    toPlace: text('to_place'),
    flightNo: text('flight_no'),
    pax: integer('pax').notNull().default(1),
    vehicle: text('vehicle'),
    driver: text('driver'),
    /** Tax inclusive; 0 for a free transfer. */
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull().default('0'),
    status: text('status').notNull().default('planned'),
    /** The folio line posted when it was done. FK added in the migration (avoids a module cycle). */
    chargeId: uuid('charge_id'),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index('booking_transfers_booking_idx').on(t.bookingId),
    scheduledIdx: index('booking_transfers_scheduled_idx').on(t.scheduledAt),
    directionValid: check(
      'booking_transfers_direction_valid',
      sql`${t.direction} in ('pickup', 'dropoff')`,
    ),
    statusValid: check(
      'booking_transfers_status_valid',
      sql`${t.status} in ('planned', 'done', 'cancelled')`,
    ),
    paxValid: check('booking_transfers_pax_valid', sql`${t.pax} >= 1 and ${t.pax} <= 60`),
    amountValid: check('booking_transfers_amount_valid', sql`${t.amount} >= 0`),
  }),
);
