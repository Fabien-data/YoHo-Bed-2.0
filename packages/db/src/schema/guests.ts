import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './identity';
import { bookings, customers } from './bookings';

/**
 * The other people in a room (Development Phase 02, Sprint 4).
 *
 * A booking's `customer_id` is the guest the room is booked for. Anyone else sharing the room
 * (a spouse, a colleague, the driver in a twin) is a row here, so the registration card, the
 * police/Form C return and the guest history all know who actually stayed.
 */
export const bookingGuests = pgTable(
  'booking_guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingCustomerUnique: unique('booking_guests_booking_customer_uq').on(
      t.bookingId,
      t.customerId,
    ),
    customerIdx: index('booking_guests_customer_idx').on(t.customerId),
  }),
);

/**
 * A guest's identity documents: what the desk looked at on arrival.
 *
 * Aadhaar is kept as its last four digits only (UIDAI forbids keeping the number), enforced here
 * as well as in the API so no code path can store more. Scans are not kept here: they go to the
 * private file store (Sprint 5), never to the public `media` table.
 */
export const guestDocuments = pgTable(
  'guest_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    /** One of @yohobed/locale's ID_DOCUMENT_TYPES. */
    type: text('type').notNull(),
    number: text('number').notNull(),
    /** ISO 3166-1 alpha-2 of the issuing country. */
    issuingCountry: text('issuing_country'),
    placeOfIssue: text('place_of_issue'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    /** Visa details, for a foreign passport (India Form C, Malaysia registration). */
    visaNumber: text('visa_number'),
    visaType: text('visa_type'),
    visaExpiresOn: date('visa_expires_on'),
    /** How the desk checked it: looked at the original, a copy, or an official app (DigiLocker). */
    verification: text('verification'),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /** The document shown for bookings from now on, when a guest has several. */
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    customerIdx: index('guest_documents_customer_idx').on(t.customerId),
    typeValid: check(
      'guest_documents_type_valid',
      sql`${t.type} in ('nic', 'mykad', 'mypr', 'aadhaar', 'passport', 'driving_licence', 'voter_id', 'oci', 'other')`,
    ),
    aadhaarLastFour: check(
      'guest_documents_aadhaar_last_four',
      sql`${t.type} <> 'aadhaar' or ${t.number} ~ '^[0-9]{4}$'`,
    ),
    verificationValid: check(
      'guest_documents_verification_valid',
      sql`${t.verification} is null or ${t.verification} in ('original', 'copy', 'digital')`,
    ),
  }),
);

/** The remark types, each printed or shown in one place (eZee's remark types). */
export const REMARK_TYPES = [
  'general',
  'front_desk',
  'housekeeping',
  'accounts',
  'kitchen',
  'preference',
] as const;

/**
 * Notes on a booking. Typed, because each type goes somewhere: a housekeeping remark shows on the
 * housekeeping board, an accounts remark on the folio, a preference on the guest's next stay.
 */
export const bookingRemarks = pgTable(
  'booking_remarks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('general'),
    text: text('text').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bookingIdx: index('booking_remarks_booking_idx').on(t.bookingId, t.createdAt),
    typeValid: check(
      'booking_remarks_type_valid',
      sql`${t.type} in ('general', 'front_desk', 'housekeeping', 'accounts', 'kitchen', 'preference')`,
    ),
    textNotBlank: check('booking_remarks_text_not_blank', sql`length(btrim(${t.text})) > 0`),
  }),
);
