import { sql } from 'drizzle-orm';
import type { Database } from './client';
import type { Tx } from './scope';

/**
 * Properties whose day needs closing (owner brief, 2026-09-26): a stay still in house after its
 * departure day, or the automatic night audit's time come round. The only question the API's
 * day-close scheduler asks without a tenant — `day_close_due` is SECURITY DEFINER, and everything
 * it then does runs inside that tenant's own RLS transaction.
 */
export interface DayCloseDue {
  tenantId: string;
  propertyId: string;
  /** `checkout`: a stay is in house after its departure day. `audit`: the audit's time came. */
  reason: 'checkout' | 'audit';
}

export async function dayCloseDueProperties(
  db: Database | Tx,
  at: Date = new Date(),
): Promise<DayCloseDue[]> {
  return (await db.execute(
    sql`select * from day_close_due(${at.toISOString()}::timestamptz)`,
  )) as unknown as DayCloseDue[];
}
