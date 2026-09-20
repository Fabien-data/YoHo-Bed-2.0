import { pgTable, uuid, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { tenants, properties, users } from './identity';
import { bookings } from './bookings';

/**
 * The guest booking page (Development Phase 02, Sprint 6 — "portal-lite"): a read-only page a
 * guest opens from the voucher email or a WhatsApp message.
 *
 * Deliberately NO RLS, like `review_invites`: the guest has no tenant context, so the unguessable
 * token IS the authorization and resolves the tenant. Everything the page shows is then read under
 * that tenant's RLS. A link expires (by default 30 days after check-out) and the desk can revoke it;
 * either way the page answers 404, the same as for a token that never existed.
 */
export const voucherTokens = pgTable(
  'voucher_tokens',
  {
    /** The token in the link. A fresh random uuid, never the booking id. */
    token: uuid('token').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** The booking the link was made from; the page shows every room of its reservation. */
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ bookingIdx: index('voucher_tokens_booking_idx').on(t.bookingId) }),
);
