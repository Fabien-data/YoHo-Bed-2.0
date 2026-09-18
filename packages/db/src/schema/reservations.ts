import { pgTable, uuid, text, jsonb, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { tenants, users } from './identity';

/**
 * Idempotency for `POST /reservations` (Development Phase 02).
 *
 * A desk on a slow connection double-clicks Reserve, or a browser retries a request whose
 * response was lost. The client sends an `Idempotency-Key`; the first request claims it inside the
 * same transaction that creates the bookings, and any repeat gets the stored response back instead
 * of a second reservation. A repeat with a different body is refused. Rows older than two days are
 * pruned as new reservations come in.
 */
export const reservationRequests = pgTable(
  'reservation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    /** SHA-256 of the request body, so a reused key with a different body is caught. */
    requestHash: text('request_hash').notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The response the first request returned. Null only inside the creating transaction. */
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    keyUnique: unique('reservation_requests_tenant_key_uq').on(t.tenantId, t.idempotencyKey),
    createdIdx: index('reservation_requests_tenant_created_idx').on(t.tenantId, t.createdAt),
  }),
);
