import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { seedDefaultPlans } from './default-plans';

const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/yohobed';

const { db, sql: client, close } = createDb(url, { max: 1 });

try {
  console.log('→ Running Drizzle migrations…');
  await migrate(db, { migrationsFolder: join(here, '..', 'drizzle') });

  console.log('→ Applying RLS policies + app role…');
  const rls = readFileSync(join(here, 'rls.sql'), 'utf8');
  await client.unsafe(rls);

  /**
   * The plan catalogue is reference data the entitlement system cannot work without, so it is
   * migrated, not seeded.
   *
   * `db:seed` is destructive — it deletes the demo tenant's properties — so `deploy.sh`
   * deliberately never runs it. That left production with an EMPTY `plans` table, which in turn
   * made migration 0022's grandfathering a silent no-op: it CROSS JOINs the enterprise plan, and
   * a cross join against nothing inserts nothing. Every tenant would then resolve to deny-all
   * entitlements and every gated screen would 403. Caught rehearsing the migration on a copy of
   * the live database on 2026-08-21.
   *
   * `seedDefaultPlans` upserts by code, so this is safe on every re-run.
   */
  console.log('→ Upserting the plan catalogue…');
  await seedDefaultPlans(db);

  /**
   * Then make sure every tenant actually has a subscription. Idempotent, and deliberately only
   * fills the gap — a tenant that already has one (of any status) is left alone.
   */
  const granted = await db.execute(sql`
    insert into subscriptions (tenant_id, plan_id, status)
    select t.id, p.id, 'active'
    from tenants t
    cross join (select id from plans where code = 'enterprise' limit 1) p
    where not exists (select 1 from subscriptions s where s.tenant_id = t.id)
    returning tenant_id
  `);
  const count = Array.isArray(granted) ? granted.length : 0;
  if (count > 0) {
    console.log(`  grandfathered ${count} tenant(s) onto the enterprise plan`);
  }

  console.log('✓ Database migrated and secured.');
} finally {
  await close();
}
