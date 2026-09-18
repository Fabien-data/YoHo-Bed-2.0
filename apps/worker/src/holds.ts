import {
  dueLifecycleTenants,
  sweepReservationLifecycle,
  withTenant,
  type Database,
} from '@yohobed/db';

/**
 * The reservation-lifecycle sweep (Development Phase 02): release holds at their release time,
 * remind the hotel before that, and cancel unconfirmed bookings past their arrival day where the
 * property asks for it.
 *
 * The worker has no tenant, so under RLS it can see no bookings. It asks one narrow question
 * without a tenant — which tenants have work due — and then does the work inside each tenant's
 * own RLS-scoped transaction, with the same function night audit uses. One tenant failing never
 * stops the others.
 */
export async function sweepHolds(
  db: Database,
  now: Date = new Date(),
): Promise<{ tenants: number; released: number; expired: number; reminded: number }> {
  const tenants = await dueLifecycleTenants(db, now);
  let released = 0;
  let expired = 0;
  let reminded = 0;
  for (const tenantId of tenants) {
    try {
      const r = await withTenant(db, tenantId, (tx) =>
        sweepReservationLifecycle(tx, tenantId, now),
      );
      released += r.released.length;
      expired += r.expired.length;
      reminded += r.reminded;
      if (r.released.length || r.expired.length) {
        console.log(
          `[holds] tenant=${tenantId} released=${r.released.map((b) => b.reference).join(',') || '-'} ` +
            `expired=${r.expired.map((b) => b.reference).join(',') || '-'} reminded=${r.reminded}`,
        );
      }
    } catch (e) {
      console.error(`[holds] sweep failed tenant=${tenantId}:`, e instanceof Error ? e.message : e);
    }
  }
  return { tenants: tenants.length, released, expired, reminded };
}
