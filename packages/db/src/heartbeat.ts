import { sql } from 'drizzle-orm';
import { systemHeartbeats } from './schema';
import type { Database } from './client';

/** The channel pipeline's backlog, as /health reports it. */
export interface OutboxHealth {
  pending: number;
  /** Seconds the oldest pending row has waited; 0 when nothing is pending. */
  oldestPendingSeconds: number;
  /** Dead letters — pushes that gave up and need a human. */
  failed: number;
}

/**
 * Outbox backlog. Read by the worker (it owns the outbox; the table has no RLS) and carried to
 * /health inside the heartbeat, so the API never needs cross-tenant access to report it.
 */
export async function outboxHealth(db: Database): Promise<OutboxHealth> {
  const rows = (await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'pending')::int AS pending,
      coalesce(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'pending')), 0)::int
        AS "oldestPendingSeconds",
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM outbox
    WHERE status IN ('pending', 'failed')
  `)) as unknown as OutboxHealth[];
  return rows[0] ?? { pending: 0, oldestPendingSeconds: 0, failed: 0 };
}

/**
 * UX events are kept for 180 days (UX-0): long enough to see a quarter-on-quarter trend, short
 * enough that nobody's working habits are kept indefinitely. Survey answers are kept — they are
 * few, and they are the trend.
 */
export async function pruneUxEvents(db: Database, keepDays = 180): Promise<number> {
  const rows = (await db.execute(sql`
    DELETE FROM ux_events WHERE created_at < now() - make_interval(days => ${keepDays})
    RETURNING 1
  `)) as unknown as unknown[];
  return rows.length;
}

/** Record that a background process is alive and doing its work. */
export async function beat(
  db: Database,
  name: string,
  info: Record<string, unknown> = {},
): Promise<void> {
  await db
    .insert(systemHeartbeats)
    .values({ name, beatAt: new Date(), info })
    .onConflictDoUpdate({ target: systemHeartbeats.name, set: { beatAt: new Date(), info } });
}
