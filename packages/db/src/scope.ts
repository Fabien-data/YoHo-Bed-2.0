import { sql } from 'drizzle-orm';
import type { Database } from './client';

/** The transaction handle passed to `withTenant` callbacks. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The Postgres session variable RLS policies read. Set per-transaction, never trusted from input. */
export const TENANT_GUC = 'app.tenant_id';

/**
 * Run a unit of work scoped to a single tenant.
 *
 * Opens a transaction, sets `app.tenant_id` LOCAL to it (so it auto-resets on commit/rollback),
 * then runs `fn` with the transaction handle. Every query inside is filtered by the RLS policies
 * in rls.sql — so even a query that forgets its `where tenant_id = ...` cannot leak another
 * tenant's rows. Pass a tenant id resolved from the authenticated context, never from the request.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, tenantId);
    return fn(tx);
  });
}

/**
 * Set the RLS tenant context on an ALREADY-OPEN transaction.
 *
 * For work that creates a tenant and then writes its first tenant-owned rows in the same
 * transaction (registration), where `withTenant` can't be used because the tenant id doesn't
 * exist until mid-transaction. This satisfies RLS rather than bypassing it: the context is
 * LOCAL to the transaction and can only ever be the row we just created.
 */
export async function setTenantContext(tx: Tx, tenantId: string): Promise<void> {
  // set_config(key, value, is_local=true) — scoped to this transaction only.
  await tx.execute(sql`select set_config(${TENANT_GUC}, ${tenantId}, true)`);
}
