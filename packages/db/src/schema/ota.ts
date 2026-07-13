import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { rooms } from './inventory';
import { bookings } from './bookings';

/**
 * OTA reservation inbox (Compartment F) — the inbound half of distribution.
 *
 * The channel manager pushes reservations to us (POST /cm/reservations). Every push is recorded
 * in `ota_reservations` FIRST, then imported as a booking through the same code path as a walk-in
 * (atomic inventory, correct occupancy key, safe reference, tax decomposition). A failed import
 * (no availability, no rates) keeps the inbox row with the error so the owner can see and retry —
 * an incoming reservation is never silently dropped (the inbound mirror of the Phase 6 outbox).
 *
 * `cm_room_mappings` routes a channel-manager room code to a tenant/room. Like `outbox`, it is
 * deliberately NOT tenant-scoped by RLS: the webhook must resolve the tenant *from* the code
 * before any tenant context exists. Owner-facing reads/writes filter by tenant in the service.
 */

export const otaReservationStatus = pgEnum('ota_reservation_status', [
  'received',
  'imported',
  'failed',
  'cancelled',
  'ignored',
]);

/** Channel-manager room code → our tenant/property/room. Infra routing table (no RLS). */
export const cmRoomMappings = pgTable('cm_room_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id')
    .notNull()
    .references(() => properties.id, { onDelete: 'cascade' }),
  roomId: uuid('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' })
    .unique(),
  /** The room code the channel manager sends, e.g. 'CM-DLX-001'. Globally unique per CM account. */
  code: text('code').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Every reservation event the channel manager ever pushed at us, and what became of it. */
export const otaReservations = pgTable(
  'ota_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'set null' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    /** Set once the reservation is imported as a booking. */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    /** Source OTA, e.g. 'booking.com', 'expedia'. */
    channel: text('channel').notNull(),
    /** The OTA's own reservation reference — the idempotency key together with `channel`. */
    externalRef: text('external_ref').notNull(),
    guestName: text('guest_name').notNull(),
    guestEmail: text('guest_email'),
    guestPhone: text('guest_phone'),
    checkin: date('checkin').notNull(),
    checkout: date('checkout').notNull(),
    rooms: integer('rooms').notNull().default(1),
    /** What the OTA says the guest paid (informational; we book at our calendar prices). */
    otaAmount: numeric('ota_amount', { precision: 12, scale: 2 }),
    /** The raw webhook payload, verbatim, for audit/debugging. */
    payload: jsonb('payload').notNull(),
    status: otaReservationStatus('status').notNull().default('received'),
    error: text('error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    channelRefUnique: unique('ota_reservations_channel_ref_uq').on(t.channel, t.externalRef),
  }),
);
