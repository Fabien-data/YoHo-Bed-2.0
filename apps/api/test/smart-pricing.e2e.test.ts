import { afterAll, describe, expect, it } from 'vitest';
import type { SmartPropertyDocument } from '@yohobed/domain';
import { makeTenant, openAndPrice, request, reserve, stopApp } from './harness';

afterAll(stopApp);

describe('published smart pricing', () => {
  it('matches setup preview, quote and creation and preserves existing snapshots after publication', async () => {
    const fx = await makeTenant({ distributionMode: 'standalone' });
    await openAndPrice(fx, '2028-04-01', '2028-04-10', { base: 10000 });
    const document: SmartPropertyDocument = {
      schemaVersion: 1,
      readiness: 'clean',
      defaults: {
        capacity: {
          maxAdults: 3,
          maxChildren: 2,
          normalGuests: 4,
          absoluteGuests: 5,
          maxExtraBeds: 1,
          maxCots: 1,
        },
        includedAdults: 2,
        includedChildren: 0,
        childUsesAdultPlace: false,
        extraAdultMinor: 100000,
        extraBedMinor: 50000,
        cotMinor: 20000,
        childBands: [
          {
            id: 'child',
            label: 'Children',
            minAge: 0,
            maxAge: 17,
            accommodation: { mode: 'fixed', amountMinor: 20000 },
          },
        ],
      },
      roomOverrides: {},
      rates: {
        [fx.occupancyId]: {
          roomId: fx.roomId,
          baseOccupancyId: fx.occupancyId,
          includedAdults: 2,
          includedChildren: 0,
          meal: {
            code: 'BB',
            mode: 'independent',
            adultMealMinor: 20000,
            childMeals: { child: { mode: 'fixed', amountMinor: 10000 } },
            minimumNetMinor: 900000,
          },
        },
      },
    };
    const path = `/properties/${fx.propertyId}/smart-setup`;
    const draft = await request('PUT', `${path}/draft`, {
      token: fx.token,
      body: { expectedVersion: 0, document },
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    expect(draft.body.issues).toEqual([]);
    const dates = { checkin: '2028-04-02', checkout: '2028-04-04' };
    const guests = { adults: 2, childAges: [6], extraBeds: 0, cots: 0 };
    const preview = await request('POST', `${path}/preview`, {
      token: fx.token,
      body: { expectedVersion: 1, occupancyId: fx.occupancyId, ...dates, guests },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    expect(preview.body.guestTotalMinor).toBe(2060000);
    const published = await request('POST', `${path}/publish`, {
      token: fx.token,
      body: { expectedVersion: 1, acknowledgeChannelLimit: true },
    });
    expect(published.status, JSON.stringify(published.body)).toBe(201);
    expect(published.body.channelPublishing.supported).toBe(false);
    const line = {
      roomId: fx.roomId,
      occupancyId: fx.occupancyId,
      adults: 2,
      children: 1,
      childAges: [6],
    };
    const quote = await request('POST', '/reservations/quote', {
      token: fx.token,
      body: { propertyId: fx.propertyId, ...dates, lines: [line] },
    });
    expect(quote.status, JSON.stringify(quote.body)).toBe(200);
    expect(Number(quote.body.totals.amount) * 100).toBe(preview.body.guestTotalMinor);
    expect(quote.body.lines[0].policyVersion).toBe(1);
    const created = await reserve(fx, { ...dates, guest: { name: 'Smart guest' }, lines: [line] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.bookings[0].id;
    const before = await request('GET', `/bookings/${id}`, { token: fx.token });
    document.defaults.extraAdultMinor *= 2;
    expect(
      (
        await request('PUT', `${path}/draft`, {
          token: fx.token,
          body: { expectedVersion: 1, document },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('POST', `${path}/publish`, {
          token: fx.token,
          body: { expectedVersion: 2, acknowledgeChannelLimit: true },
        })
      ).status,
    ).toBe(201);
    const after = await request('GET', `/bookings/${id}`, { token: fx.token });
    expect(after.body.days).toEqual(before.body.days);
    expect(after.body.pricing.smart.policyVersion).toBe(1);
    const missingAge = await request('POST', '/reservations/quote', {
      token: fx.token,
      body: { propertyId: fx.propertyId, ...dates, lines: [{ ...line, childAges: undefined }] },
    });
    expect(missingAge.status).toBe(400);
    const below = await request('POST', '/reservations/quote', {
      token: fx.token,
      body: {
        propertyId: fx.propertyId,
        ...dates,
        priceReason: 'Special rate',
        lines: [{ ...line, rate: { mode: 'nightly', amount: 8000 } }],
      },
    });
    expect(below.status, JSON.stringify(below.body)).toBe(400);
    expect(below.body.reason).toBe('minimum_net_rate');
  });
});
