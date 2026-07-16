import { afterAll, describe, expect, it } from 'vitest';
import { makeTenant, makeStaff, request, login, stopApp, PASSWORD } from './harness';

afterAll(stopApp);

describe('auth & tenancy guard', () => {
  it('logs in and returns the principal', async () => {
    const fx = await makeTenant();
    const me = await request('GET', '/auth/me', { token: fx.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(fx.email);
  });

  it('rejects a wrong password and an unknown email with 401', async () => {
    const fx = await makeTenant();
    expect(
      (await request('POST', '/auth/login', { body: { email: fx.email, password: 'nope' } }))
        .status,
    ).toBe(401);
    expect(
      (
        await request('POST', '/auth/login', {
          body: { email: 'ghost@nowhere.test', password: PASSWORD },
        })
      ).status,
    ).toBe(401);
  });

  it('rejects unauthenticated access to tenant data', async () => {
    expect((await request('GET', '/properties')).status).toBe(401);
  });

  /** The legacy hole: trusting a client-supplied property/tenant id. */
  it('refuses an x-tenant-id the caller is not a member of', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const res = await request('GET', '/properties', {
      token: a.token,
      headers: { 'x-tenant-id': b.tenantId },
    });
    expect(res.status).toBe(403);
  });

  it('blocks login for a suspended tenant', async () => {
    const fx = await makeTenant({ status: 'suspended' });
    const res = await request('POST', '/auth/login', {
      body: { email: fx.email, password: PASSWORD },
    });
    expect(res.status).toBe(403);
  });

  it('lets a pending tenant sign in (they see the awaiting-approval banner)', async () => {
    const fx = await makeTenant({ status: 'pending' });
    const res = await request('POST', '/auth/login', {
      body: { email: fx.email, password: PASSWORD },
    });
    expect(res.status).toBe(200);
  });
});

describe('self-serve registration', () => {
  it('creates a pending tenant that can sign in immediately', async () => {
    const email = `reg-${Date.now().toString(36)}-${process.pid}@test.yohobed.local`;
    const res = await request('POST', '/auth/register', {
      body: { ownerName: 'New Owner', businessName: 'New Villa', email, password: PASSWORD },
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(
      (await request('POST', '/auth/login', { body: { email, password: PASSWORD } })).status,
    ).toBe(200);
  });

  it('rejects a duplicate email', async () => {
    const email = `dup-${Date.now().toString(36)}-${process.pid}@test.yohobed.local`;
    const body = { ownerName: 'A', businessName: 'B', email, password: PASSWORD };
    expect((await request('POST', '/auth/register', { body })).status).toBe(201);
    expect((await request('POST', '/auth/register', { body })).status).toBe(409);
  });

  /**
   * Regression: registration used to create a tenant with NO message templates, so a real
   * registered owner silently sent zero guest email (confirmations and review invites both
   * queue *from* a template). Only the dev seed had them.
   */
  it('gives a new tenant its starter message templates', async () => {
    const email = `tpl-${Date.now().toString(36)}-${process.pid}@test.yohobed.local`;
    await request('POST', '/auth/register', {
      body: { ownerName: 'Templated', businessName: 'Templated Villa', email, password: PASSWORD },
    });
    const token = await login(email);
    const tpls = await request('GET', '/templates', { token });
    expect(tpls.status).toBe(200);
    const keys = tpls.body.map((t: any) => `${t.key}/${t.language}`);
    expect(keys).toContain('booking_created/en');
    expect(keys).toContain('review_invite/en');
  });
});

describe('RBAC', () => {
  it('keeps owners out of the staff console', async () => {
    const fx = await makeTenant();
    expect((await request('GET', '/staff/tenants', { token: fx.token })).status).toBe(403);
  });

  it('lets YoHo staff in', async () => {
    const staff = await makeStaff();
    const res = await request('GET', '/staff/tenants', { token: staff.token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
