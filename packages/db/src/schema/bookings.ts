import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  date,
  time,
  timestamp,
  jsonb,
  unique,
  index,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { TaxLine } from '@yohobed/domain';
import { tenants, properties, users } from './identity';
import { rooms, roomUnits } from './inventory';
import { occupancies } from './rates';
import { marketSegments } from './configuration';

/**
 * Bookings (Phase 5). Fixes two legacy bugs by construction:
 *  - BUG #2 (walk-in wrong key): a booking references its `occupancyId` explicitly — the correct
 *    pricing key — never the room id masquerading as one.
 *  - BUG #4 (reference race): references come from an atomic per-day counter, not MAX()+1.
 * The day-wise `booking_days` snapshot preserves the exact prices at the moment of booking.
 */

export const bookingStatus = pgEnum('booking_status', [
  'Pending',
  'Approved',
  'CheckedIn',
  'CheckedOut',
  'Rejected',
  'Cancelled',
  'NoShow',
]);
export const bookingSource = pgEnum('booking_source', ['Extranet', 'OTA', 'Backend']);
export const bookingAction = pgEnum('booking_action', [
  'created',
  'approved',
  'rejected',
  'cancelled',
  'no_show',
  'checked_in',
  'checked_out',
  'amended',
  // Development Phase 02: the hold lifecycle.
  'held',
  'released',
  'confirmed',
  'voided',
  // UX-1a: mistakes at the desk are recoverable, and the recovery is on the record.
  'check_in_undone',
  'check_out_undone',
  'reinstated',
  // Stay View: who put the guest in which room, and who moved their dates.
  'room_assigned',
  'room_moved',
  'stay_changed',
]);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** One full name, as the guest writes it — many Asian names have no family name. */
    name: text('name').notNull(),
    email: text('email'),
    /** The number as typed or received. `mobileE164` is its normalised form. */
    phone: text('phone'),
    // Guest depth — what a registration card and a police/immigration report need, and what the
    // front desk fills in at check-in. All nullable: an OTA booking arrives with a name and little
    // else, and demanding more would block the check-in it is meant to support.
    nationality: text('nationality'),
    idType: text('id_type'),
    idNumber: text('id_number'),
    dateOfBirth: date('date_of_birth'),
    address: text('address'),
    city: text('city'),
    country: text('country'),
    /** Flags the guest across every screen — Yanolja's crown badge on the room card. */
    vip: boolean('vip').notNull().default(false),
    notes: text('notes'),

    /**
     * Regional guest profile (Development Phase 02). `title` is a local form of address (Mr,
     * Ven., Datuk, Smt.). The given/family split is optional and only for forms that demand it
     * (India's Form C). Codes are ISO 3166: `nationalityCode` decides local vs foreign.
     */
    title: text('title'),
    givenName: text('given_name'),
    familyName: text('family_name'),
    mobileE164: text('mobile_e164'),
    /** The mobile number is on WhatsApp — the guest channel of choice in all three markets. */
    whatsapp: boolean('whatsapp').notNull().default(false),
    nationalityCode: text('nationality_code'),
    countryCode: text('country_code'),
    state: text('state'),
    zip: text('zip'),
    gender: text('gender'),
    occupation: text('occupation'),
    /** A company guest's tax number, printed on a B2B invoice (GSTIN, TIN, SST). */
    taxId: text('tax_id'),
    companyName: text('company_name'),
    /** When the guest agreed to the privacy notice, and which version (India's DPDP). */
    consentAt: timestamp('consent_at', { withTimezone: true }),
    consentVersion: text('consent_version'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('customers_tenant_email_idx').on(t.tenantId, sql`lower(${t.email})`),
    mobileIdx: index('customers_tenant_mobile_idx').on(t.tenantId, t.mobileE164),
    genderValid: check(
      'customers_gender_valid',
      sql`${t.gender} is null or ${t.gender} in ('male', 'female', 'other')`,
    ),
  }),
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** The correct pricing key (BUG #2) — never the room id. */
    occupancyId: uuid('occupancy_id')
      .notNull()
      .references(() => occupancies.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** Set when this booking is one leg of a multi-room group (Yanolja's Group ID). */
    groupId: uuid('group_id').references((): AnyPgColumn => bookingGroups.id, {
      onDelete: 'set null',
    }),
    /**
     * Where the business came from — colours the bar on Stay View. The foreign keys for this,
     * `ledgerAccountId` and `salesPersonId` are added by hand in migration 0028: the cashiering
     * schema imports this file, so declaring them here would make the two import each other.
     */
    businessSourceId: uuid('business_source_id'),
    /** The travel agent or company this stay is billed to, when it is not the guest. */
    ledgerAccountId: uuid('ledger_account_id'),
    reference: text('reference').notNull().unique(),
    checkin: date('checkin').notNull(),
    checkout: date('checkout').notNull(),
    nights: integer('nights').notNull(),
    rooms: integer('rooms').notNull().default(1),
    status: bookingStatus('status').notNull().default('Pending'),
    source: bookingSource('source').notNull().default('Extranet'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    totalBasePrice: numeric('total_base_price', { precision: 12, scale: 2 }).notNull(),
    /** Tax portion decomposed out of `amount` (legacy PricingCalculator::calculateTaxFromSelling). */
    taxes: numeric('taxes', { precision: 12, scale: 2 }).notNull().default('0'),
    /** `amount − taxes` (legacy `commissionable_amount`) — the base for the settlement split. */
    commissionableAmount: numeric('commissionable_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    /** Coupon discount off the amount (Compartment D). The guest pays amount − discount. */
    discount: numeric('discount', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('LKR'),
    /**
     * FX rate snapshotted at booking creation: 1 unit of `currency` = this many LKR (1 for LKR).
     * Frozen so the cross-property consolidated (LKR) view never drifts as live rates move. Never
     * used inside per-property finance, which stays in `currency`. numeric(18,8) for rate precision.
     */
    fxRateToLkr: numeric('fx_rate_to_lkr', { precision: 18, scale: 8 }).notNull().default('1'),
    /** Front-desk timestamps (Compartment G): set when the guest physically arrives/leaves. */
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),

    /**
     * Yanolja's "Reservation Type" (Development Phase 02) — see RESERVATION_KINDS. A second axis
     * beside `status`: the status says where the stay is in its life, the kind what sort of
     * commitment it is. CHECK-constrained text, never an enum (see configuration.ts).
     */
    // Defaults to an unconfirmed hold because `status` defaults to Pending: a row inserted with
    // every default must satisfy bookings_kind_matches_status. The application always sets both.
    reservationKind: text('reservation_kind').notNull().default('hold_unconfirm'),
    /**
     * Whether this booking has rooms out of inventory. Derived, never written: a live booking of
     * a kind that takes rooms. Every release and recount path keys off it, so it cannot be
     * allowed to disagree with the status — which is why Postgres computes it.
     *
     * Only an inquiry holds nothing. An online booking that failed still holds its rooms
     * (migration 0043): the guest believes they booked, so the hotel keeps the room for them.
     */
    inventoryHeld: boolean('inventory_held')
      .notNull()
      .generatedAlwaysAs(
        sql`status not in ('Cancelled', 'Rejected') and reservation_kind <> 'inquiry'`,
      ),
    /**
     * Nights from this date on have been given back although the booking is still live — a
     * no-show keeps the night it failed to arrive for and frees the rest. Null = held to checkout.
     */
    inventoryReleasedFrom: date('inventory_released_from'),
    /** When a hold gives its rooms back. Null on a hold = never released automatically. */
    holdUntil: timestamp('hold_until', { withTimezone: true }),
    /** Set once the "hold releases soon" reminder has gone out, so it goes out once. */
    holdRemindedAt: timestamp('hold_reminded_at', { withTimezone: true }),
    /** Yanolja's "Booking Source": direct | ota | travel_agent | corporate. */
    origin: text('origin').notNull().default('direct'),
    /** local | foreign — decides the rate types offered, and later tourism tax and Form C. */
    residency: text('residency'),
    arrivalTime: time('arrival_time'),
    departureTime: time('departure_time'),
    marketSegmentId: uuid('market_segment_id').references(() => marketSegments.id, {
      onDelete: 'set null',
    }),
    /** A `ledger_accounts` row of type sales_person. */
    salesPersonId: uuid('sales_person_id'),
    /** The agent's or company's own reference for the stay. */
    voucherNo: text('voucher_no'),
    /**
     * A VIP stay: the desk flags the reservation so every screen shows the crown. Separate from
     * the guest's own profile flag (`customers.vip`) — a honeymoon or the owner's guest is VIP for
     * this stay without being one for ever. It changes nothing about money or inventory.
     */
    isVip: boolean('is_vip').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** 1…n within a multi-room reservation: reference `<master>-<siblingIndex>`. */
    siblingIndex: integer('sibling_index'),
    /**
     * The pricing policy the stay was sold under — override, contract, complimentary, tax
     * exemption — so an amendment re-prices under the same terms instead of reverting to the list.
     */
    pricing: jsonb('pricing').$type<Record<string, unknown>>().notNull().default({}),
    /** Yanolja's "Other Information" switches — see resolveReservationOptions. */
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    /** Excused from levies such as Malaysia's tourism tax (Sprint 7). */
    levyExempt: boolean('levy_exempt').notNull().default(false),
    /** The channel collected the levy already, so the hotel must not charge it again. */
    levyCollectedByChannel: boolean('levy_collected_by_channel').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    propertyCheckinIdx: index('bookings_property_checkin_idx').on(t.propertyId, t.checkin),
    propertyCreatedIdx: index('bookings_property_created_idx').on(t.propertyId, t.createdAt),
    groupIdx: index('bookings_group_idx').on(t.groupId),
    customerIdx: index('bookings_customer_idx').on(t.customerId),
    holdIdx: index('bookings_hold_until_idx')
      .on(t.holdUntil)
      .where(sql`${t.holdUntil} is not null`),
    kindValid: check(
      'bookings_reservation_kind_valid',
      sql`${t.reservationKind} in ('confirm', 'inquiry', 'online_failed', 'hold_confirm', 'hold_unconfirm')`,
    ),
    // A pending booking is one of the unconfirmed kinds; a confirmed, arrived, departed or
    // no-show booking is a confirmed one. Cancelled and rejected bookings keep whatever they were.
    kindMatchesStatus: check(
      'bookings_kind_matches_status',
      // Compared as text: 'CheckedIn'/'CheckedOut' were added by ALTER TYPE (0013), and on a fresh
      // database every migration runs in one transaction, where Postgres 16 refuses an enum value
      // added earlier in the same transaction. The server runs 16.
      sql`(${t.status}::text <> 'Pending' or ${t.reservationKind} in ('inquiry', 'online_failed', 'hold_unconfirm')) and (${t.status}::text not in ('Approved', 'CheckedIn', 'CheckedOut', 'NoShow') or ${t.reservationKind} in ('confirm', 'hold_confirm'))`,
    ),
    holdNeedsHoldKind: check(
      'bookings_hold_until_needs_hold_kind',
      sql`${t.holdUntil} is null or ${t.reservationKind} in ('hold_confirm', 'hold_unconfirm')`,
    ),
    originValid: check(
      'bookings_origin_valid',
      sql`${t.origin} in ('direct', 'ota', 'travel_agent', 'corporate')`,
    ),
    residencyValid: check(
      'bookings_residency_valid',
      sql`${t.residency} is null or ${t.residency} in ('local', 'foreign')`,
    ),
    releasedFromInStay: check(
      'bookings_inventory_released_from_in_stay',
      sql`${t.inventoryReleasedFrom} is null or (${t.inventoryReleasedFrom} > ${t.checkin} and ${t.inventoryReleasedFrom} <= ${t.checkout})`,
    ),
  }),
);

/**
 * A group of sibling reservations — Yanolja's "Group ID", the thing that makes `3359-1` and
 * `3359-2` show up together in one Group Reservation List panel.
 *
 * Grouping is presentational: it never merges the money. Each member booking keeps its own
 * amount, folio and lifecycle.
 */
export const bookingGroups = pgTable(
  'booking_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** Short human reference shown on the card, e.g. "414". */
    code: text('code').notNull(),
    name: text('name'),
    /**
     * `reservation`: created with a multi-room reservation, coded with its master reference.
     * `manual`: made afterwards from separate bookings (Make Group).
     */
    kind: text('kind').notNull().default('manual'),
    /** The paymaster — Yanolja's "Group Owner". */
    ownerCustomerId: uuid('owner_customer_id').references(() => customers.id, {
      onDelete: 'set null',
    }),
    /** Bill To for the group (Sprint 5 applies it): guest | company | group_owner | company_room_tax. */
    billTo: text('bill_to'),
    /** Foreign key added by hand in migration 0028 (see bookings.business_source_id). */
    businessSourceId: uuid('business_source_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    kindValid: check('booking_groups_kind_valid', sql`${t.kind} in ('manual', 'reservation')`),
    billToValid: check(
      'booking_groups_bill_to_valid',
      sql`${t.billTo} is null or ${t.billTo} in ('guest', 'company', 'group_owner', 'company_room_tax')`,
    ),
  }),
);

/**
 * One physical room on a booking — the thing a tape-chart bar actually represents.
 *
 * A booking with `rooms = 3` gets three legs. Money stays entirely on `bookings`/`booking_days`,
 * so `@yohobed/domain` is untouched by any of this; a leg only carries where the guests sleep.
 *
 * `roomUnitId` is nullable: an OTA reservation arrives unassigned, and the front desk assigns it
 * later (or `auto-assign` does). `releasedAt` is stamped when the booking is cancelled or
 * rejected — that frees the unit for re-sale while preserving which unit it had been given, and
 * it is what the double-booking exclusion constraint keys off.
 */
export const bookingRooms = pgTable(
  'booking_rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    roomUnitId: uuid('room_unit_id').references(() => roomUnits.id, { onDelete: 'set null' }),
    /** 0-based position within the booking, so legs have a stable order. */
    legIndex: integer('leg_index').notNull().default(0),
    /** Denormalised from the booking so the exclusion constraint can be expressed on this row. */
    checkin: date('checkin').notNull(),
    checkout: date('checkout').notNull(),
    adults: integer('adults').notNull().default(1),
    children: integer('children').notNull().default(0),
    /** Each child's age, for child-rate rules and India's CWB/CNB (Development Phase 02). */
    childAges: integer('child_ages')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    extraBeds: integer('extra_beds').notNull().default(0),
    /**
     * The room a guest asked for on a booking that holds no inventory (an inquiry). It is not an
     * assignment — the room is not taken — and it becomes one only if still free on confirmation.
     */
    preferredRoomUnitId: uuid('preferred_room_unit_id').references(() => roomUnits.id, {
      onDelete: 'set null',
    }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // A mid-stay room move splits one logical leg into dated segments. The original segment is
    // retained, so room history and date-specific occupancy remain truthful.
    bookingLegUnique: unique('booking_rooms_booking_leg_uq').on(t.bookingId, t.legIndex, t.checkin),
    paxValid: check(
      'booking_rooms_pax_valid',
      sql`${t.adults} >= 0 and ${t.children} >= 0 and ${t.extraBeds} >= 0`,
    ),
  }),
);

/** Day-wise price snapshot at the moment of booking (for audit + parity). */
export const bookingDays = pgTable(
  'booking_days',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    basePrice: numeric('base_price', { precision: 12, scale: 2 }).notNull(),
    sellingPrice: numeric('selling_price', { precision: 12, scale: 2 }).notNull(),
    commission: numeric('commission', { precision: 12, scale: 2 }).notNull(),
    /** Per-night tax portion decomposed from the selling price (0 when no tax configured). */
    tax: numeric('tax', { precision: 12, scale: 2 }).notNull().default('0'),
    /**
     * The rate calendar's price for the night (after any last-minute drop), kept beside what was
     * actually charged so a discount is visible and reportable (Development Phase 02).
     */
    listSellingPrice: numeric('list_selling_price', { precision: 12, scale: 2 }),
    /** calendar | override | contract | complimentary — see RATE_SOURCES. */
    rateSource: text('rate_source').notNull().default('calendar'),
    /** `tax` split per tax, adding up to it exactly (splitInclusiveTax). */
    taxLines: jsonb('tax_lines').$type<TaxLine[]>(),
  },
  (t) => ({
    bookingDateUnique: unique('booking_days_booking_date_uq').on(t.bookingId, t.date),
    rateSourceValid: check(
      'booking_days_rate_source_valid',
      sql`${t.rateSource} in ('calendar', 'override', 'contract', 'complimentary')`,
    ),
  }),
);

/** Single audit trail for the booking lifecycle. */
export const bookingApprovals = pgTable('booking_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' }),
  action: bookingAction('action').notNull(),
  reason: text('reason'),
  actorUserId: uuid('actor_user_id'),
  /** Where the action came from (UX-1a) — the client IP through nginx (`trust proxy`). */
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Global per-day counter for race-free booking references (BUG #4).
 * Not tenant-scoped: references are globally unique, like the legacy scheme.
 */
export const bookingCounters = pgTable('booking_counters', {
  day: text('day').primaryKey(),
  counter: integer('counter').notNull().default(0),
});
