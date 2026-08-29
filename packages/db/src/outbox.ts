import { sql, eq } from 'drizzle-orm';
import { outbox } from './schema';
import type { Database } from './client';
import type { Tx } from './scope';

export interface OutboxEvent {
  tenantId?: string | null;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

/**
 * Enqueue a channel-manager event as part of the current transaction (the transactional-outbox
 * pattern). If the surrounding domain write commits, so does this row — atomically. If it rolls
 * back, no phantom push. This is what makes channel sync reliable instead of fire-and-forget.
 */
export async function enqueueOutbox(tx: Tx, e: OutboxEvent): Promise<void> {
  await tx.insert(outbox).values({
    tenantId: e.tenantId ?? null,
    aggregate: e.aggregate,
    aggregateId: e.aggregateId,
    eventType: e.eventType,
    payload: e.payload as never,
  });
}

export interface OutboxRow {
  id: string;
  tenantId: string | null;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
}

/**
 * Atomically claim up to `limit` pending rows for processing (FOR UPDATE SKIP LOCKED, so multiple
 * worker instances never grab the same row).
 */
export async function claimPendingOutbox(db: Database, limit: number): Promise<OutboxRow[]> {
  const res = await db.execute(sql`
    UPDATE outbox SET status = 'processing', updated_at = now()
    WHERE id IN (
      SELECT id FROM outbox WHERE status = 'pending'
      ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    RETURNING id, tenant_id AS "tenantId", aggregate, aggregate_id AS "aggregateId",
              event_type AS "eventType", payload, status, attempts, max_attempts AS "maxAttempts"
  `);
  return res as unknown as OutboxRow[];
}

export function markOutboxSent(db: Database, id: string, attempts: number): Promise<unknown> {
  return db
    .update(outbox)
    .set({ status: 'sent', attempts, lastError: null, updatedAt: new Date() })
    .where(eq(outbox.id, id));
}

export function markOutboxRetry(
  db: Database,
  id: string,
  attempts: number,
  error: string,
): Promise<unknown> {
  return db
    .update(outbox)
    .set({ attempts, lastError: error.slice(0, 500), updatedAt: new Date() })
    .where(eq(outbox.id, id));
}

export function markOutboxFailed(
  db: Database,
  id: string,
  attempts: number,
  error: string,
): Promise<unknown> {
  return db
    .update(outbox)
    .set({ status: 'failed', attempts, lastError: error.slice(0, 500), updatedAt: new Date() })
    .where(eq(outbox.id, id));
}

/**
 * Return rows stuck in 'processing' (e.g. a crashed worker) back to 'pending'.
 *
 * Only rows that still have attempts left are requeued; a row whose attempts are exhausted (the
 * worker died between the last attempt and the failed-listener bookkeeping) is dead-lettered
 * instead — without the ceiling it would loop pending → processing forever, looking "in progress"
 * while pushing nothing.
 */
export async function requeueStaleOutbox(db: Database, olderThanSeconds = 120): Promise<unknown> {
  await db.execute(sql`
    UPDATE outbox SET status = 'failed',
           last_error = coalesce(last_error, 'worker died with attempts exhausted'),
           updated_at = now()
    WHERE status = 'processing'
      AND attempts >= max_attempts
      AND updated_at < now() - make_interval(secs => ${olderThanSeconds})
  `);
  return db.execute(sql`
    UPDATE outbox SET status = 'pending', updated_at = now()
    WHERE status = 'processing'
      AND attempts < max_attempts
      AND updated_at < now() - make_interval(secs => ${olderThanSeconds})
  `);
}
