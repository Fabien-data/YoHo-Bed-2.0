import { describe, it, expect, afterAll } from 'vitest';
import { makeTenant, makeStaff, request, stopApp } from './harness';

afterAll(stopApp);

describe('exchange rates', () => {
  it('requires authentication to read rates', async () => {
    const res = await request('GET', '/fx/rates');
    expect(res.status).toBe(401);
  });

  it('returns a self-describing rate table with LKR pinned to 1', async () => {
    const owner = await makeTenant();
    const res = await request('GET', '/fx/rates', { token: owner.token });
    expect(res.status).toBe(200);
    expect(res.body.quote).toBe('LKR');
    const lkr = res.body.rates.find((r: any) => r.base === 'LKR');
    expect(lkr).toMatchObject({ rate: 1, source: 'pivot', symbol: 'Rs' });
    // every supported currency is represented (rate may be null until a rate exists)
    expect(res.body.rates.map((r: any) => r.base).sort()).toEqual([
      'EUR',
      'GBP',
      'INR',
      'LKR',
      'USD',
    ]);
  });

  it('forbids a property owner from overriding a rate', async () => {
    const owner = await makeTenant();
    const res = await request('POST', '/fx/override', {
      token: owner.token,
      body: { base: 'USD', rate: 305 },
    });
    expect(res.status).toBe(403);
  });

  it('lets YoHo staff set a manual override that then shows up as the current USD rate', async () => {
    const staff = await makeStaff('YOHO_ADMIN');
    const set = await request('POST', '/fx/override', {
      token: staff.token,
      body: { base: 'USD', rate: 305.5, note: 'e2e manual' },
    });
    expect(set.status).toBe(201);
    expect(set.body).toMatchObject({ base: 'USD', rate: 305.5, quote: 'LKR', source: 'manual' });

    const current = await request('GET', '/fx/rates', { token: staff.token });
    const usd = current.body.rates.find((r: any) => r.base === 'USD');
    expect(usd.rate).toBe(305.5);
    expect(usd.source).toBe('manual');

    const history = await request('GET', '/fx/history?base=USD&limit=5', { token: staff.token });
    expect(history.status).toBe(200);
    expect(history.body[0]).toMatchObject({ base: 'USD', rate: 305.5, source: 'manual' });
  });

  it('rejects an invalid override (LKR pivot or non-positive rate)', async () => {
    const staff = await makeStaff('YOHO_STAFF');
    const lkr = await request('POST', '/fx/override', {
      token: staff.token,
      body: { base: 'LKR', rate: 1 },
    });
    expect(lkr.status).toBe(400);
    const neg = await request('POST', '/fx/override', {
      token: staff.token,
      body: { base: 'USD', rate: -5 },
    });
    expect(neg.status).toBe(400);
  });
});
