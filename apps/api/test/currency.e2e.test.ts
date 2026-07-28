import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  makeTenant,
  makeStaff,
  addProperty,
  setFxRate,
  openAndPrice,
  openAndPriceProperty,
  book,
  request,
  stopApp,
  type TenantFixture,
  type PropertyFixture,
} from './harness';
import { resolveAggCurrency } from '../src/common/currency';

/**
 * Multi-currency Phase 4 — cross-property aggregation correctness.
 *
 * The bug this pins down: a tenant with an LKR property and a USD property had every cross-property
 * total computed as `sum(amount)`, silently adding dollars to rupees. The fix denominates each
 * aggregate: native when one currency is in play, LKR-consolidated (via each booking's snapshotted
 * rate) when more than one is.
 *
 * The single-currency assertions matter as much as the mixed ones — they're the regression guard
 * proving the fix is a no-op for every existing LKR-only tenant.
 */

const USD_RATE = 300; // 1 USD = 300 LKR, published before any booking so it gets snapshotted.

// A quiet future window, so these bookings never collide with another suite's dates.
const FROM = '2027-03-01';
const TO = '2027-03-10';
const CHECKIN = '2027-03-02';
const CHECKOUT = '2027-03-04'; // 2 nights

describe('multi-currency aggregation', () => {
  afterAll(async () => {
    await stopApp();
  });

  describe('resolveAggCurrency (the fold rule)', () => {
    it('reports natively and exactly when one currency is in play', () => {
      expect(resolveAggCurrency(['LKR', 'LKR'])).toEqual({ currency: 'LKR', approximate: false });
      expect(resolveAggCurrency(['USD'])).toEqual({ currency: 'USD', approximate: false });
    });

    it('consolidates to LKR and flags approximate when currencies differ', () => {
      expect(resolveAggCurrency(['LKR', 'USD'])).toEqual({ currency: 'LKR', approximate: true });
    });

    it('defaults an empty set to LKR rather than throwing', () => {
      expect(resolveAggCurrency([])).toEqual({ currency: 'LKR', approximate: false });
    });

    it('treats an unknown or null currency as LKR, matching the column default', () => {
      expect(resolveAggCurrency([null, undefined, 'XYZ'])).toEqual({
        currency: 'LKR',
        approximate: false,
      });
    });
  });

  describe('single-currency tenant (regression guard)', () => {
    let fx: TenantFixture;

    beforeAll(async () => {
      fx = await makeTenant();
      await openAndPrice(fx, FROM, TO, { base: 18000 });
      const res = await book(fx, { checkin: CHECKIN, checkout: CHECKOUT });
      expect(res.status).toBe(201);
      await request('POST', `/bookings/${res.body.id}/approve`, { token: fx.token });
    });

    it('reports revenue natively in LKR with no approximation', async () => {
      const res = await request('GET', `/finance/revenue?from=${FROM}&to=${TO}`, {
        token: fx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('LKR');
      expect(res.body.approximate).toBe(false);
      expect(res.body.approvedGross).toBeGreaterThan(0);
    });

    it('reports the dashboard month gross natively', async () => {
      const res = await request('GET', `/dashboard?date=${CHECKIN}`, { token: fx.token });
      expect(res.status).toBe(200);
      expect(res.body.month.currency).toBe('LKR');
      expect(res.body.month.approximate).toBe(false);
    });

    it('reports customer spend natively', async () => {
      const res = await request('GET', '/customers', { token: fx.token });
      expect(res.status).toBe(200);
      const [c] = res.body;
      expect(c.currency).toBe('LKR');
      expect(c.approximate).toBe(false);
      expect(Number(c.totalSpend)).toBeGreaterThan(0);
    });
  });

  describe('mixed-currency tenant', () => {
    let fx: TenantFixture;
    let usd: PropertyFixture;
    let lkrGross: number;
    let usdGross: number;

    beforeAll(async () => {
      await setFxRate('USD', USD_RATE);
      fx = await makeTenant();
      usd = await addProperty(fx, { currency: 'USD', name: 'E2E USD Property' });

      // LKR property: base 18,000/night.
      await openAndPrice(fx, FROM, TO, { base: 18000 });
      // USD property: base 100/night — same guest name, so the customer row spans both.
      await openAndPriceProperty(fx, usd, FROM, TO, { base: 100 });

      const a = await book(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        customerName: 'Dual Currency Guest',
        customerEmail: 'dual@test.yohobed.local',
      });
      const b = await book(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        customerName: 'Dual Currency Guest',
        customerEmail: 'dual@test.yohobed.local',
        roomId: usd.roomId,
        occupancyId: usd.occupancyId,
      });
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      lkrGross = Number(a.body.amount);
      usdGross = Number(b.body.amount);

      await request('POST', `/bookings/${a.body.id}/approve`, { token: fx.token });
      await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token });
    });

    it('stamps each booking with its property currency and snapshots the FX rate', async () => {
      const res = await request('GET', '/bookings', { token: fx.token });
      const currencies = res.body.map((b: { currency: string }) => b.currency).sort();
      expect(currencies).toEqual(['LKR', 'USD']);
    });

    it('consolidates revenue to LKR using the snapshotted rate, flagged approximate', async () => {
      const res = await request('GET', `/finance/revenue?from=${FROM}&to=${TO}`, {
        token: fx.token,
      });
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('LKR');
      expect(res.body.approximate).toBe(true);
      // The whole point: the USD booking is worth 300× its face value in the consolidated total,
      // NOT added raw. Pre-fix this equalled lkrGross + usdGross.
      expect(res.body.approvedGross).toBeCloseTo(lkrGross + usdGross * USD_RATE, 2);
      expect(res.body.approvedGross).not.toBeCloseTo(lkrGross + usdGross, 2);
    });

    it('consolidates the cross-property dashboard month gross', async () => {
      const res = await request('GET', `/dashboard?date=${CHECKIN}`, { token: fx.token });
      expect(res.status).toBe(200);
      expect(res.body.month.currency).toBe('LKR');
      expect(res.body.month.approximate).toBe(true);
      expect(res.body.month.gross).toBeCloseTo(lkrGross + usdGross * USD_RATE, 2);
    });

    it('keeps the dashboard exact and native when scoped to the USD property', async () => {
      const res = await request('GET', `/dashboard?date=${CHECKIN}&propertyId=${usd.propertyId}`, {
        token: fx.token,
      });
      expect(res.status).toBe(200);
      // Scoped to one property there is only one currency, so no FX is applied at all.
      expect(res.body.month.currency).toBe('USD');
      expect(res.body.month.approximate).toBe(false);
      expect(res.body.month.gross).toBeCloseTo(usdGross, 2);
    });

    it('consolidates spend for a guest who stayed at both properties', async () => {
      const res = await request('GET', '/customers', { token: fx.token });
      const guest = res.body.find((c: { email: string }) => c.email === 'dual@test.yohobed.local');
      expect(guest).toBeDefined();
      expect(guest.currency).toBe('LKR');
      expect(guest.approximate).toBe(true);
      expect(Number(guest.totalSpend)).toBeCloseTo(lkrGross + usdGross * USD_RATE, 2);
    });

    it('keeps per-property settlement exact and native — never FX-converted', async () => {
      const res = await request(
        'GET',
        `/finance/payout-statement?propertyId=${usd.propertyId}&from=${FROM}&to=${TO}`,
        { token: fx.token },
      );
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('USD');
      expect(res.body.grossSelling).toBeCloseTo(usdGross, 2);
      // A settlement must still reconcile by construction, in its own currency.
      expect(
        res.body.propertyBase + res.body.yohoCommission + res.body.otaCommission + res.body.taxes,
      ).toBeCloseTo(res.body.grossSelling, 2);
    });

    it('persists the currency on a created payout', async () => {
      const res = await request('POST', '/finance/payouts', {
        token: fx.token,
        body: { propertyId: usd.propertyId, from: FROM, to: TO },
      });
      expect(res.status).toBe(201);
      expect(res.body.currency).toBe('USD');
    });
  });

  describe('payment currency guard', () => {
    let fx: TenantFixture;
    let usd: PropertyFixture;
    let bookingId: string;
    let amount: number;

    beforeAll(async () => {
      await setFxRate('USD', USD_RATE);
      fx = await makeTenant();
      usd = await addProperty(fx, { currency: 'USD' });
      await openAndPriceProperty(fx, usd, FROM, TO, { base: 100 });
      const res = await book(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        roomId: usd.roomId,
        occupancyId: usd.occupancyId,
      });
      expect(res.status).toBe(201);
      bookingId = res.body.id;
      amount = Number(res.body.amount);
      await request('POST', `/bookings/${bookingId}/invoice`, { token: fx.token });
    });

    it('rejects a payment asserting a currency the booking is not denominated in', async () => {
      const res = await request('POST', `/bookings/${bookingId}/payments`, {
        token: fx.token,
        body: { direction: 'received', amount, currency: 'LKR', method: 'bank' },
      });
      expect(res.status).toBe(400);
      expect(res.body.message?.error ?? res.body.error).toBe('currency_mismatch');
    });

    it('accepts a payment in the booking currency and stores that denomination', async () => {
      const res = await request('POST', `/bookings/${bookingId}/payments`, {
        token: fx.token,
        body: { direction: 'received', amount, currency: 'USD', method: 'bank' },
      });
      expect(res.status).toBe(201);
      expect(res.body.currency).toBe('USD');
    });

    it('marks the invoice paid once the same-currency total covers it', async () => {
      const res = await request('GET', `/bookings/${bookingId}/payments`, { token: fx.token });
      expect(res.status).toBe(200);
      const invoices = await request('GET', '/invoices', { token: fx.token });
      const inv = invoices.body.find((i: { bookingId: string }) => i.bookingId === bookingId);
      expect(inv.status).toBe('paid');
      expect(inv.currency).toBe('USD');
    });
  });

  describe('staff-only base currency control', () => {
    let fx: TenantFixture;
    let staffToken: string;

    beforeAll(async () => {
      fx = await makeTenant();
      staffToken = (await makeStaff()).token;
    });

    it('is not exposed to the owner — no owner route can change it', async () => {
      const res = await request('PATCH', `/properties/${fx.propertyId}`, {
        token: fx.token,
        body: { name: 'Renamed', currency: 'USD' },
      });
      // The rename succeeds; the currency is simply not a field an owner can set.
      expect(res.status).toBe(200);
      const check = await request('GET', '/properties', { token: fx.token });
      expect(check.body[0].currency).toBe('LKR');
    });

    it('refuses a non-staff caller', async () => {
      const res = await request(
        'POST',
        `/staff/tenants/${fx.tenantId}/properties/${fx.propertyId}/currency`,
        { token: fx.token, body: { currency: 'USD' } },
      );
      expect(res.status).toBe(403);
    });

    it('lets staff set it while the property has no bookings', async () => {
      const res = await request(
        'POST',
        `/staff/tenants/${fx.tenantId}/properties/${fx.propertyId}/currency`,
        { token: staffToken, body: { currency: 'USD' } },
      );
      expect(res.status).toBe(200);
      expect(res.body.currency).toBe('USD');
    });

    it('rejects a display-only currency as a base currency', async () => {
      const res = await request(
        'POST',
        `/staff/tenants/${fx.tenantId}/properties/${fx.propertyId}/currency`,
        { token: staffToken, body: { currency: 'EUR' } },
      );
      expect(res.status).toBe(400);
    });

    it('locks the currency once the property has bookings', async () => {
      await openAndPrice(fx, FROM, TO, { base: 100 });
      const booked = await book(fx, { checkin: CHECKIN, checkout: CHECKOUT });
      expect(booked.status).toBe(201);

      const res = await request(
        'POST',
        `/staff/tenants/${fx.tenantId}/properties/${fx.propertyId}/currency`,
        { token: staffToken, body: { currency: 'LKR' } },
      );
      expect(res.status).toBe(409);
      expect(res.body.message?.error ?? res.body.error).toBe('currency_locked');

      // And the stored currency is untouched.
      const list = await request('GET', `/staff/tenants/${fx.tenantId}/properties`, {
        token: staffToken,
      });
      const prop = list.body.find((p: { id: string }) => p.id === fx.propertyId);
      expect(prop.currency).toBe('USD');
      expect(prop.locked).toBe(true);
    });
  });
});
