import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, withTenant, tenants, properties, type DbHandle } from '../src/index';
import { appUrlFrom } from './app-url';

/**
 * Proves tenant isolation is enforced by Postgres RLS — the Phase 1 exit criterion.
 *
 * Requires a running, migrated database (`docker compose up -d postgres` + `pnpm db:migrate`).
 * Skips when DATABASE_URL is not set so the default `pnpm test` stays green offline.
 */
const superUrl = process.env.DATABASE_URL;
// Skipping silently is fine locally, but in CI a skipped integration suite is a green build that
// proved nothing — fail loudly instead.
if (!superUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: these integration tests must never be skipped.');
}
const run = superUrl ? describe : describe.skip;

run('tenant isolation (RLS)', () => {
  let sup: DbHandle; // superuser/owner — bypasses RLS, used to seed
  let app: DbHandle; // restricted role — RLS applies
  let tenantA = '';
  let tenantB = '';
  let propA = '';
  let propB = '';
  const stamp = Date.now();

  beforeAll(async () => {
    sup = createDb(superUrl as string);
    app = createDb(appUrlFrom(superUrl as string));

    const [a] = await sup.db
      .insert(tenants)
      .values({ name: 'Tenant A', email: `a+${stamp}@yohobed.test` })
      .returning();
    const [b] = await sup.db
      .insert(tenants)
      .values({ name: 'Tenant B', email: `b+${stamp}@yohobed.test` })
      .returning();
    tenantA = a!.id;
    tenantB = b!.id;

    const [pa] = await sup.db
      .insert(properties)
      .values({ tenantId: tenantA, name: 'Cinnamon Lakeside' })
      .returning();
    const [pb] = await sup.db
      .insert(properties)
      .values({ tenantId: tenantB, name: 'Jetwing Blue' })
      .returning();
    propA = pa!.id;
    propB = pb!.id;
  });

  afterAll(async () => {
    if (tenantA) await sup.db.delete(tenants).where(eq(tenants.id, tenantA));
    if (tenantB) await sup.db.delete(tenants).where(eq(tenants.id, tenantB));
    await sup?.close();
    await app?.close();
  });

  it('a tenant-A context sees only tenant-A rows', async () => {
    const rows = await withTenant(app.db, tenantA, (tx) => tx.select().from(properties));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(propA);
    expect(rows.every((r) => r.tenantId === tenantA)).toBe(true);
  });

  it('a tenant-B context sees only tenant-B rows', async () => {
    const rows = await withTenant(app.db, tenantB, (tx) => tx.select().from(properties));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(propB);
  });

  it('no tenant context (unset GUC) sees nothing — default deny', async () => {
    const rows = await app.db.select().from(properties);
    expect(rows).toHaveLength(0);
  });

  it('WITH CHECK blocks writing a row for another tenant', async () => {
    await expect(
      withTenant(app.db, tenantA, (tx) =>
        tx.insert(properties).values({ tenantId: tenantB, name: 'Smuggled' }),
      ),
    ).rejects.toThrow();
  });
});
