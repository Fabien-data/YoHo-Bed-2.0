import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bookings, customers } from '@yohobed/db';
import {
  addUnits,
  admin,
  book,
  hotelToday,
  makeTenant,
  openAndPrice,
  request,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * One search for the whole desk, and the same action over a selection (UX Excellence Program,
 * UX-2). A guest quotes whatever they have — a reference, a name, the number they booked with, a
 * voucher, their room — and it is one search, over every date and every status.
 */
afterAll(stopApp);

const find = (fx: TenantFixture, q: string) =>
  request('GET', `/search?propertyId=${fx.propertyId}&q=${encodeURIComponent(q)}`, {
    token: fx.token,
  });

async function stay(
  fx: TenantFixture,
  name: string,
  checkin: string,
  nights: number,
  extra: { customerPhone?: string; customerEmail?: string } = {},
) {
  const checkout = new Date(`${checkin}T00:00:00Z`);
  checkout.setUTCDate(checkout.getUTCDate() + nights);
  const res = await book(fx, {
    checkin,
    checkout: checkout.toISOString().slice(0, 10),
    customerName: name,
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await request('POST', `/bookings/${res.body.id}/approve`, { token: fx.token });
  return res.body as { id: string; reference: string; customerId: string };
}

describe('one search', () => {
  it('finds a stay by reference, guest, email and voucher, whatever its dates', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, hotelToday(-10), hotelToday(60));
    const b = await stay(fx, 'Chathuri Wickramasinghe', hotelToday(30), 2, {
      customerEmail: 'chathuri@example.test',
    });
    await admin().update(bookings).set({ voucherNo: 'BDC-99887' }).where(eq(bookings.id, b.id));

    for (const term of [b.reference, 'Wickramasinghe', 'chathuri@example', 'BDC-99887']) {
      const res = await find(fx, term);
      expect(res.status, term).toBe(200);
      expect(
        res.body.reservations.map((r: { id: string }) => r.id),
        term,
      ).toContain(b.id);
    }
  });

  it('matches a phone number however it was typed', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, hotelToday(), hotelToday(40));
    const b = await stay(fx, 'Nadeesha Perera', hotelToday(20), 1, {
      customerPhone: '+94 77 123 4567',
    });
    // The guest says "0771234567"; the booking holds "+94 77 123 4567".
    const res = await find(fx, '0771234567');
    expect(res.body.reservations.map((r: { id: string }) => r.id)).toContain(b.id);
    expect(res.body.guests.map((g: { id: string }) => g.id)).toContain(b.customerId);
  });

  it('finds the guest in a room by its number, and puts the stay in front of the desk first', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await addUnits(fx, fx.roomId, ['401', '402']);
    await openAndPrice(fx, hotelToday(-2), hotelToday(30));
    const past = await stay(fx, 'Room Searcher', hotelToday(-2), 1);
    const inHouse = await stay(fx, 'Room Searcher', hotelToday(), 2);
    const future = await stay(fx, 'Room Searcher', hotelToday(20), 2);
    expect((await request('POST', `/bookings/${inHouse.id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );

    // Same name on three stays: the one in house comes first.
    const byName = await find(fx, 'Room Searcher');
    expect(byName.body.reservations[0].id).toBe(inHouse.id);
    expect(byName.body.reservations.map((r: { id: string }) => r.id)).toEqual(
      expect.arrayContaining([past.id, future.id]),
    );

    // And the room number finds whoever is in it tonight.
    const code = byName.body.reservations[0].roomCodes as string;
    const byRoom = await find(fx, code);
    expect(byRoom.body.reservations.map((r: { id: string }) => r.id)).toContain(inHouse.id);
    expect(byRoom.body.rooms.map((r: { code: string }) => r.code)).toContain(code);
    expect(byRoom.body.rooms.find((r: { code: string }) => r.code === code).guestName).toBe(
      'Room Searcher',
    );
  });

  it('never reaches another hotel', async () => {
    const mine = await makeTenant({ roomQuantity: 4 });
    const theirs = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(theirs, hotelToday(), hotelToday(30));
    const secret = await stay(theirs, 'Someone Else Entirely', hotelToday(5), 1);

    const res = await find(mine, 'Someone Else Entirely');
    expect(res.status).toBe(200);
    expect(res.body.reservations).toHaveLength(0);
    expect(res.body.guests).toHaveLength(0);
    // Their own tenant still finds it.
    const own = await find(theirs, 'Someone Else Entirely');
    expect(own.body.reservations.map((r: { id: string }) => r.id)).toContain(secret.id);
  });

  it('says nothing for a one-character term rather than listing the hotel', async () => {
    const fx = await makeTenant();
    const res = await find(fx, 'a');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reservations: [], guests: [], rooms: [] });
  });
});

describe('a desk action over a selection', () => {
  it('checks in what it can and says why the rest were refused', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, hotelToday(), hotelToday(30));
    const today1 = await stay(fx, 'Bulk One', hotelToday(), 2);
    const today2 = await stay(fx, 'Bulk Two', hotelToday(), 2);
    // Not due until next week: check-in must refuse this one, and only this one.
    const future = await stay(fx, 'Bulk Later', hotelToday(7), 2);

    const res = await request('POST', '/bookings/bulk/check-in', {
      token: fx.token,
      body: { ids: [today1.id, today2.id, future.id] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.done).toBe(2);
    expect(res.body.failed).toBe(1);
    const refused = res.body.results.find((r: { id: string }) => r.id === future.id);
    expect(refused.ok).toBe(false);
    expect(refused.message).toMatch(/arriv/i);
    for (const id of [today1.id, today2.id]) {
      const b = await request('GET', `/bookings/${id}`, { token: fx.token });
      expect(b.body.status).toBe('CheckedIn');
    }
  });

  it('gives rooms to a selection at once', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await addUnits(fx, fx.roomId, ['501', '502']);
    await openAndPrice(fx, hotelToday(), hotelToday(30));
    const a = await stay(fx, 'Assign One', hotelToday(3), 1);
    const b = await stay(fx, 'Assign Two', hotelToday(3), 1);

    const res = await request('POST', '/bookings/bulk/assign-rooms', {
      token: fx.token,
      body: { ids: [a.id, b.id] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.done).toBe(2);
    for (const id of [a.id, b.id]) {
      const legs = await request('GET', `/bookings/${id}/room-moves`, { token: fx.token });
      expect(legs.status).toBe(200);
    }
  });

  it('refuses an empty selection', async () => {
    const fx = await makeTenant();
    const res = await request('POST', '/bookings/bulk/check-in', {
      token: fx.token,
      body: { ids: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe('the guest list', () => {
  it("counts a guest's stays and their last night", async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, hotelToday(-20), hotelToday(40));
    const name = `Repeat Guest ${Date.now().toString(36)}`;
    const first = await stay(fx, name, hotelToday(-20), 2);
    await admin()
      .update(customers)
      .set({ vip: true })
      .where(eq(customers.id, first.customerId));
    await stay(fx, name, hotelToday(10), 3);

    const res = await find(fx, name);
    const guest = res.body.guests.find((g: { name: string }) => g.name === name);
    expect(guest.vip).toBe(true);
    expect(guest.stays).toBeGreaterThanOrEqual(1);
    expect(guest.lastStay).toBeTruthy();
  });
});
