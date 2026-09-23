import { afterAll, describe, expect, it } from 'vitest';
import {
  addDeskUser,
  addUnits,
  book,
  hotelToday,
  makeTenant,
  openAndPrice,
  request,
  stopApp,
} from './harness';

afterAll(stopApp);

describe('smart operational controls', () => {
  it('carries previous housekeeping state into the calendar and check-in readiness', async () => {
    const fx = await makeTenant({ roomQuantity: 1 });
    const [unit] = await addUnits(fx, fx.roomId, ['101']);
    const today = hotelToday();
    await openAndPrice(fx, today, hotelToday(4), { roomsToSell: 1, base: 10000 });
    const booking = await book(fx, { checkin: today, checkout: hotelToday(2) });
    const id = booking.body.id;
    const legs = await request('GET', `/bookings/${id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: unit }] },
    });
    await request('POST', `/bookings/${id}/approve`, { token: fx.token });
    const changed = await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: unit, date: hotelToday(-1), status: 'dirty' },
    });
    expect(changed.status).toBe(200);
    const calendar = await request(
      'GET',
      `/stayview?propertyId=${fx.propertyId}&from=${today}&to=${hotelToday(3)}`,
      { token: fx.token },
    );
    expect(calendar.body.roomTypes[0].units[0].housekeeping).toBe('dirty');
    const refused = await request('POST', `/bookings/${id}/check-in`, { token: fx.token });
    expect(refused.status).toBe(409);
    await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: unit, date: today, status: 'clean' },
    });
    expect((await request('POST', `/bookings/${id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );
  });
  it('scopes custom roles to granted properties and revokes access with the same token', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const second = await request('POST', '/properties', {
      token: fx.token,
      body: { name: 'Private property' },
    });
    expect(second.status).toBe(201);
    const role = await request('POST', '/hotel-roles', {
      token: fx.token,
      body: {
        name: 'Room operator',
        permissions: ['reservation_read'],
        propertyIds: [fx.propertyId],
      },
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const assigned = await request('POST', `/hotel-roles/${role.body.id}/assign`, {
      token: fx.token,
      body: { userId: desk.userId },
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    const scoped = await request('GET', '/properties', { token: desk.token });
    expect(scoped.status).toBe(200);
    expect(scoped.body.map((item: { id: string }) => item.id)).toEqual([fx.propertyId]);
    expect(scoped.body[0].commissionPercentage).toBeUndefined();
    expect(
      (
        await request(
          'GET',
          `/stayview?propertyId=${second.body.id}&from=2028-03-01&to=2028-03-15`,
          { token: desk.token },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request('GET', `/rooms/${fx.roomId}/rates?from=2028-03-01&to=2028-03-15`, {
          token: desk.token,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('POST', `/hotel-roles/${role.body.id}/assign`, {
          token: fx.token,
          body: { userId: fx.userId },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request('DELETE', `/hotel-roles/${role.body.id}/assign/${desk.userId}`, {
          token: fx.token,
        })
      ).status,
    ).toBe(200);
    expect((await request('GET', '/properties', { token: desk.token })).status).toBe(403);
    expect((await request('GET', '/properties', { token: fx.token })).body).toHaveLength(2);
  });

  it('keeps existing prices when an in-house stay extends and rejects stale reviews', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [unit] = await addUnits(fx, fx.roomId, ['101']);
    const checkin = hotelToday();
    const originalCheckout = hotelToday(2);
    const extendedCheckout = hotelToday(3);
    await openAndPrice(fx, checkin, hotelToday(8), { roomsToSell: 2, base: 10000 });
    const booking = await book(fx, { checkin, checkout: originalCheckout });
    expect(booking.status).toBe(201);
    const id = booking.body.id;
    const legs = await request('GET', `/bookings/${id}/rooms`, { token: fx.token });
    expect(
      (
        await request('POST', `/bookings/${id}/assign`, {
          token: fx.token,
          body: { assignments: [{ legId: legs.body[0].id, roomUnitId: unit }] },
        })
      ).status,
    ).toBe(200);
    expect((await request('POST', `/bookings/${id}/approve`, { token: fx.token })).status).toBe(
      200,
    );
    expect((await request('POST', `/bookings/${id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );
    await openAndPrice(fx, originalCheckout, hotelToday(8), { roomsToSell: 2, base: 15000 });
    const dates = { checkin, checkout: extendedCheckout };
    const preview = await request('POST', `/bookings/${id}/stay-change/preview`, {
      token: fx.token,
      body: dates,
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    expect(preview.body.nights.map((night: { retained: boolean }) => night.retained)).toEqual([
      true,
      true,
      false,
    ]);
    const commit = {
      ...dates,
      expectedUpdatedAt: preview.body.expectedUpdatedAt,
      expectedAmount: preview.body.proposed.amount,
    };
    const saved = await request('POST', `/bookings/${id}/stay-change`, {
      token: fx.token,
      body: commit,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    expect(saved.body.status).toBe('CheckedIn');
    expect(saved.body.checkin).toBe(dates.checkin);
    expect(saved.body.checkout).toBe(dates.checkout);
    expect(Number(saved.body.amount)).toBeGreaterThan(Number(booking.body.amount));
    const after = await request('GET', `/bookings/${id}/rooms`, { token: fx.token });
    expect(after.body[0].roomUnitId).toBe(unit);
    expect(after.body[0].checkout).toBe(dates.checkout);
    expect(
      (await request('POST', `/bookings/${id}/stay-change`, { token: fx.token, body: commit }))
        .status,
    ).toBe(409);
    expect(
      (
        await request('POST', `/bookings/${id}/stay-change/preview`, {
          token: fx.token,
          body: { ...dates, checkout: hotelToday(1) },
        })
      ).status,
    ).toBe(400);
  });
});
