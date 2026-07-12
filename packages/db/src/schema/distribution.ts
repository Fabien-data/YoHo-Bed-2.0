import { pgTable, pgEnum, uuid, text, integer, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { tenants } from './identity';

/**
 * Distribution / channel-manager (Phase 6).
 *
 * The `outbox` is the fix for BUG #3 (silent channel-sync failures). Every rate/availability
 * change writes an outbox row IN THE SAME TRANSACTION as the change, so nothing is ever lost.
 * A worker drains it to the channel manager with retries; exhausted attempts land in `failed`
 * (a dead letter) and raise an alert — never a silent drop.
 *
 * Not tenant-RLS-scoped: the worker drains every tenant's events on one connection.
 */
export const outboxStatus = pgEnum('outbox_status', ['pending', 'processing', 'sent', 'failed']);

export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  /** e.g. 'availability' | 'rate' | 'booking' */
  aggregate: text('aggregate').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: outboxStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
