import { pgTable, uuid, text, integer, date, timestamp, jsonb, unique } from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { rooms } from './inventory';
import { bookings } from './bookings';

/**
 * Guest reviews + owner ARI change history (Compartment I).
 *
 * - `reviews`: one guest review per booking, collected after check-out. Tenant-scoped RLS.
 * - `review_invites`: the public submission route. Like `cm_room_mappings`, deliberately NO RLS —
 *   a guest submitting a review has no tenant context; the unguessable 128-bit token IS the
 *   authorization, and resolves the tenant. One invite per booking, single-use.
 * - `ari_history`: every owner-visible availability/rate/restriction change, so owners can see
 *   who changed what and when (legacy parity: ARI history view). Tenant-scoped RLS.
 */

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id')
    .notNull()
    .references(() => bookings.id, { onDelete: 'cascade' })
    .unique(),
  /** 1..5 stars (checked in the service layer). */
  rating: integer('rating').notNull(),
  comment: text('comment'),
  guestName: text('guest_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Single-use, unguessable route from a checked-out booking to a public review form. */
export const reviewInvites = pgTable(
  'review_invites',
  {
    /** The token in the emailed link. A fresh uuid, NOT the booking id. */
    token: uuid('token').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    guestName: text('guest_name').notNull(),
    propertyName: text('property_name').notNull(),
    checkin: date('checkin').notNull(),
    checkout: date('checkout').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ oneInvitePerBooking: unique('review_invites_booking_uq').on(t.bookingId) }),
);

/** Owner-facing log of ARI (availability / rate / restriction) changes. */
export const ariHistory = pgTable('ari_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  /** 'availability' | 'price' | 'drop' | 'restriction' */
  kind: text('kind').notNull(),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  /** What changed, e.g. { roomsToSell: 5, status: 'Open' } or { base: 18000, selling: 31625 }. */
  detail: jsonb('detail').notNull(),
  actorEmail: text('actor_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
