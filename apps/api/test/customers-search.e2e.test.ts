import { afterAll, describe, expect, it } from 'vitest';
import { makeTenant, request, stopApp } from './harness';

/** Finding and adding guests at the desk (Development Phase 02). */

afterAll(stopApp);

async function guest(token: string, body: Record<string, unknown>) {
  return request('POST', '/customers', { token, body });
}

describe('guest search', () => {
  it('finds a guest by name, email, or any way the phone was written', async () => {
    const fx = await makeTenant();
    const g = await guest(fx.token, {
      title: 'Mrs',
      name: 'Dilani Jayawardena',
      email: 'dilani@example.lk',
      phone: '077 123 4567',
      whatsapp: true,
      nationalityCode: 'lk',
    });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ mobileE164: '+94771234567', nationalityCode: 'LK' });

    for (const q of [
      'dilani',
      'Jayaward',
      'DILANI@EXAMPLE',
      '0771234567',
      '+94 77 123',
      '1234567',
    ]) {
      const res = await request('GET', `/customers/search?q=${encodeURIComponent(q)}`, {
        token: fx.token,
      });
      expect(res.status, q).toBe(200);
      expect(
        res.body.map((c: any) => c.id),
        q,
      ).toContain(g.body.id);
    }
    const first = await request('GET', '/customers/search?q=dil', { token: fx.token });
    expect(first.body[0]).toMatchObject({ name: 'Dilani Jayawardena', whatsapp: true, stays: 0 });
  });

  it('needs two characters and never crosses tenants', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await guest(a.token, { name: 'Tenant A Only Guest' });
    expect((await request('GET', '/customers/search?q=T', { token: a.token })).status).toBe(400);
    const res = await request('GET', '/customers/search?q=Tenant%20A%20Only', { token: b.token });
    expect(res.body).toHaveLength(0);
  });

  it('treats search syntax as plain text', async () => {
    const fx = await makeTenant();
    await guest(fx.token, { name: 'Plain Guest' });
    const res = await request('GET', `/customers/search?q=${encodeURIComponent('%_')}`, {
      token: fx.token,
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});

describe('adding a guest', () => {
  it('refuses a duplicate email or mobile unless told to create anyway', async () => {
    const fx = await makeTenant();
    const first = await guest(fx.token, { name: 'Arjun Mehta', phone: '+91 98765 43210' });
    const dupe = await guest(fx.token, { name: 'A. Mehta', phone: '98765 43210' });
    // The tenant's property is Sri Lankan, so a bare Indian number is read as a Sri Lankan one
    // and does not collide; the explicit +91 does.
    expect(dupe.status).toBe(201);
    const clash = await guest(fx.token, { name: 'Arjun M', phone: '+919876543210' });
    expect(clash.status).toBe(409);
    expect(clash.body.candidates[0].id).toBe(first.body.id);
    const forced = await guest(fx.token, {
      name: 'Arjun M',
      phone: '+919876543210',
      createNew: true,
    });
    expect(forced.status).toBe(201);
  });

  it('stamps privacy consent and keeps the phone normalised on edit', async () => {
    const fx = await makeTenant();
    const g = await guest(fx.token, { name: 'Consenting Guest' });
    const res = await request('PATCH', `/customers/${g.body.id}`, {
      token: fx.token,
      body: { phone: '0112 345 678', consentVersion: '2026-09', gender: 'female' },
    });
    expect(res.status).toBe(200);
    expect(res.body.mobileE164).toBe('+94112345678');
    expect(res.body.consentVersion).toBe('2026-09');
    expect(res.body.consentAt).toBeTruthy();
    expect(
      (await request('PATCH', `/customers/${g.body.id}`, { token: fx.token, body: { bogus: 1 } }))
        .status,
    ).toBe(400);
  });
});
