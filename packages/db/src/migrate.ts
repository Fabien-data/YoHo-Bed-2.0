import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { normalizePhone } from '@yohobed/locale';
import { createDb } from './client';
import { seedDefaultPlans } from './default-plans';
import { seedDefaultMasters } from './masters';

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

  /**
   * Give every tenant its reservation master lists (Development Phase 02) — market segments,
   * business sources and payment methods from its country's preset. Seeded once per tenant: a
   * tenant that already has segments is skipped, so an owner's edits survive every later deploy.
   * The country is taken from the tenant's oldest property.
   */
  const tenantRows = (await db.execute(sql`
    select t.id,
      (select p.country_code from properties p where p.tenant_id = t.id
        order by p.created_at limit 1) as country
    from tenants t
  `)) as unknown as Array<{ id: string; country: string | null }>;
  let seeded = 0;
  for (const t of tenantRows) {
    const did = await db.transaction((tx) => seedDefaultMasters(tx, t.id, t.country));
    if (did) seeded += 1;
  }
  if (seeded > 0) {
    console.log(`  seeded reservation master lists for ${seeded} tenant(s)`);
  }

  /**
   * Normalise guest phone numbers into `customers.mobile_e164` (Development Phase 02), which the
   * guest search and duplicate check key on. A number without a country prefix is read in the
   * tenant's home country, as the desk that typed it meant. Numbers that cannot be read stay
   * null and are simply tried again next time — there are few, and nothing depends on them.
   */
  const countryByTenant = new Map(tenantRows.map((t) => [t.id, t.country ?? 'LK']));
  const phones = (await db.execute(sql`
    select id, tenant_id as "tenantId", phone from customers
    where phone is not null and mobile_e164 is null
    limit 50000
  `)) as unknown as Array<{ id: string; tenantId: string; phone: string }>;
  let normalised = 0;
  for (const c of phones) {
    const parsed = normalizePhone(c.phone, countryByTenant.get(c.tenantId) ?? 'LK');
    if (!parsed) continue;
    await db.execute(sql`update customers set mobile_e164 = ${parsed.e164} where id = ${c.id}`);
    normalised += 1;
  }
  if (normalised > 0) {
    console.log(`  normalised ${normalised} guest phone number(s)`);
  }

  console.log('✓ Database migrated and secured.');
} finally {
  await close();
}
