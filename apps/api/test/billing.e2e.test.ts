import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { plans, subscriptions, tenantFeatures, seedDefaultPlans } from '@yohobed/db';
import { admin, makeTenant, makeStaff, request, stopApp } from './harness';

afterAll(stopApp);

describe('subscription plans & entitlements', () => {
  it('requires authentication to read the catalogue', async () => {
    const res = await request('GET', '/billing/plans');
    expect(res.status).toBe(401);
  });

  it('lists the active plans cheapest first', async () => {
    await seedDefaultPlans(admin());
    const owner = await makeTenant();
    const res = await request('GET', '/billing/plans', { token: owner.token });
    expect(res.status).toBe(200);

    const codes = res.body.map((p: any) => p.code);
    expect(codes).toEqual(['starter', 'pro', 'enterprise']);
    expect(res.body[0]).toMatchObject({ name: 'Starter', currency: 'USD' });
  });

  it('denies every feature for a tenant with no subscription', async () => {
    // Every real tenant has a subscription — migration 0022 grandfathers the existing ones and
    // registration provisions new ones — so this state has to be asked for explicitly. It is
    // still worth asserting: deny-by-default is what stops a new feature key leaking to
    // everyone the moment it is added.
    const owner = await makeTenant({ plan: 'none' });
    const res = await request('GET', '/billing/entitlements', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(res.status).toBe(200);
    expect(res.body.features.stay_view).toBe(false);
    expect(res.body.features.night_audit).toBe(false);
    expect(res.body.limits.max_rooms).toBe(0);
  });

  it('grants only the Starter feature set to a Starter tenant', async () => {
    const owner = await makeTenant({ plan: 'starter' });
    const res = await request('GET', '/billing/entitlements', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(res.status).toBe(200);
    expect(res.body.features.stay_view).toBe(true);
    expect(res.body.features.housekeeping).toBe(true);
    // Starter deliberately stops short of the money core and distribution.
    expect(res.body.features.night_audit).toBe(false);
    expect(res.body.features.channel_manager).toBe(false);
    expect(res.body.features.ai_copilot).toBe(false);
    expect(res.body.limits.max_properties).toBe(1);
  });

  it('grants everything, uncapped, to an Enterprise tenant', async () => {
    const owner = await makeTenant({ plan: 'enterprise' });
    const res = await request('GET', '/billing/entitlements', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(Object.values(res.body.features).every((v) => v === true)).toBe(true);
    expect(res.body.limits.max_rooms).toBe(-1);
  });

  it('reports the plan, subscription state and distribution mode together', async () => {
    const owner = await makeTenant({ plan: 'pro' });
    const res = await request('GET', '/billing/plan', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(res.status).toBe(200);
    expect(res.body.plan).toMatchObject({ code: 'pro', name: 'Pro' });
    expect(res.body.subscription).toMatchObject({ status: 'active' });
    expect(res.body.distributionMode).toBe('yoho');
    expect(res.body.entitlements.features.folio).toBe(true);
  });

  it('revokes the plan grants when the subscription is no longer active', async () => {
    const owner = await makeTenant({ plan: 'pro' });
    await admin()
      .update(subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(subscriptions.tenantId, owner.tenantId));

    const res = await request('GET', '/billing/entitlements', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(res.body.features.folio).toBe(false);
    expect(res.body.features.stay_view).toBe(false);
  });

  it('honours a per-tenant override that grants a module off-plan', async () => {
    const owner = await makeTenant({ plan: 'starter' });
    await admin()
      .insert(tenantFeatures)
      .values({ tenantId: owner.tenantId, key: 'night_audit', enabled: true, note: 'e2e grant' });

    const res = await request('GET', '/billing/entitlements', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(res.body.features.night_audit).toBe(true);
  });

  it('never leaks another tenant’s entitlements', async () => {
    const a = await makeTenant({ plan: 'enterprise' });
    const b = await makeTenant({ plan: 'starter' });

    // B's token asking for A's tenant must be refused by TenantGuard, not answered.
    const res = await request('GET', '/billing/entitlements', {
      token: b.token,
      tenantId: a.tenantId,
    });
    expect(res.status).toBe(403);
  });
});

describe('staff plan administration', () => {
  it('forbids a property owner from changing their own plan', async () => {
    const owner = await makeTenant({ plan: 'starter' });
    const res = await request('POST', `/staff/tenants/${owner.tenantId}/plan`, {
      token: owner.token,
      body: { planCode: 'enterprise' },
    });
    expect(res.status).toBe(403);
  });

  it('lets staff move a tenant onto a plan, which takes effect immediately', async () => {
    const owner = await makeTenant();
    const staff = await makeStaff('YOHO_ADMIN');
    await seedDefaultPlans(admin());

    const set = await request('POST', `/staff/tenants/${owner.tenantId}/plan`, {
      token: staff.token,
      body: { planCode: 'pro' },
    });
    expect(set.status).toBe(201);
    expect(set.body.plan.code).toBe('pro');

    const after = await request('GET', '/billing/entitlements', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(after.body.features.cashiering).toBe(true);
  });

  it('rejects an unknown plan code', async () => {
    const owner = await makeTenant();
    const staff = await makeStaff('YOHO_ADMIN');
    const res = await request('POST', `/staff/tenants/${owner.tenantId}/plan`, {
      token: staff.token,
      body: { planCode: 'platinum-unicorn' },
    });
    expect(res.status).toBe(404);
  });

  it('lets staff switch a tenant to standalone PMS mode', async () => {
    const owner = await makeTenant({ plan: 'pro' });
    const staff = await makeStaff('YOHO_ADMIN');

    const res = await request('POST', `/staff/tenants/${owner.tenantId}/distribution-mode`, {
      token: staff.token,
      body: { mode: 'standalone' },
    });
    expect(res.status).toBe(201);
    expect(res.body.distributionMode).toBe('standalone');

    const plan = await request('GET', '/billing/plan', {
      token: owner.token,
      tenantId: owner.tenantId,
    });
    expect(plan.body.distributionMode).toBe('standalone');
  });

  it('rejects an invalid distribution mode', async () => {
    const owner = await makeTenant();
    const staff = await makeStaff('YOHO_ADMIN');
    const res = await request('POST', `/staff/tenants/${owner.tenantId}/distribution-mode`, {
      token: staff.token,
      body: { mode: 'freeloader' },
    });
    expect(res.status).toBe(400);
  });
});

describe('plan catalogue integrity', () => {
  it('is idempotent — re-seeding updates in place rather than duplicating', async () => {
    const db = admin();
    await seedDefaultPlans(db);
    await seedDefaultPlans(db);
    const rows = await db.select().from(plans).where(eq(plans.code, 'pro'));
    expect(rows).toHaveLength(1);
  });
});
