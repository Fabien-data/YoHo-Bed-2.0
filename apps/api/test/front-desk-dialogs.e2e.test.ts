import { describe, it, expect, afterAll } from 'vitest';
import {
  PASSWORD,
  addDeskUser,
  book,
  hotelToday,
  makeTenant,
  openAndPrice,
  payInFull,
  request,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * UX Excellence Program, UX-1b — the server side of the guided check-in and check-out dialogs:
 * dry-run previews, "use a clean room instead", extending or shortening an in-house stay,
 * refunds, the double-payment guard, and the owner approving a balance on the spot.
 */

afterAll(stopApp);

async function makeUnits(fx: TenantFixture, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const res = await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: fx.roomId, code: String(i).padStart(2, '0') },
    });
    ids.push(res.body.id);
  }
  return ids;
}

async function arrival(fx: TenantFixture, nights = 2) {
  const b = await book(fx, { checkin: hotelToday(), checkout: hotelToday(nights) });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token });
  return b.body as { id: string; reference: string; amount: string };
}

const get = (fx: TenantFixture, path: string, token = fx.token) => request('GET', path, { token });
const post = (fx: TenantFixture, path: string, body?: unknown, token = fx.token) =>
  request('POST', path, { token, body });

async function booking(fx: TenantFixture, id: string) {
  return (await get(fx, `/bookings/${id}`)).body;
}

async function roomsToSell(fx: TenantFixture, date: string): Promise<number> {
  const res = await get(fx, `/rooms/${fx.roomId}/availability?from=${date}&to=${date}`);
  return res.body[0].roomsToSell;
}

async function cashMethod(fx: TenantFixture): Promise<string> {
  const methods = (await get(fx, '/payment-methods')).body as Array<{ id: string; code: string }>;
  return methods.find((m) => m.code === 'CASH')!.id;
}

describe('the check-in dialog', () => {
  it('previews the room the guest will get, and changes nothing', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await makeUnits(fx, 2);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const b = await arrival(fx);

    const preview = await get(fx, `/bookings/${b.id}/check-in-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ ok: true, problem: null });
    expect(preview.body.rooms).toEqual([{ code: '01', housekeeping: 'clean' }]);
    expect(Number(preview.body.balance)).toBeCloseTo(Number(b.amount), 2);

    // A dry run: still a reservation, still no room.
    expect((await booking(fx, b.id)).status).toBe('Approved');
    const legs = (await get(fx, `/bookings/${b.id}/rooms`)).body;
    expect(legs[0].roomUnitId).toBeNull();
  });

  it('offers a clean room instead of a dirty one', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 2);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const b = await arrival(fx);
    const legs = (await get(fx, `/bookings/${b.id}/rooms`)).body;
    await post(fx, `/bookings/${b.id}/assign`, {
      assignments: [{ legId: legs[0].id, roomUnitId: u1 }],
    });
    await post(fx, `/properties/${fx.propertyId}/housekeeping`, {
      roomUnitId: u1,
      date: hotelToday(),
      status: 'dirty',
    });

    const dirty = await get(fx, `/bookings/${b.id}/check-in-preview`);
    expect(dirty.body.ok).toBe(false);
    expect(dirty.body.problem).toMatchObject({ reason: 'room_dirty', rooms: ['01'] });

    const switched = await post(fx, `/bookings/${b.id}/rooms/switch-clean`);
    expect(switched.status, JSON.stringify(switched.body)).toBe(200);
    expect(switched.body).toEqual([{ code: '02', housekeeping: 'clean' }]);
    expect((await get(fx, `/bookings/${b.id}/check-in-preview`)).body.ok).toBe(true);
  });
});

describe('the check-out dialog', () => {
  it('previews what the guest still owes, and changes nothing', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    await post(fx, `/bookings/${b.id}/check-in`);

    const owing = await get(fx, `/bookings/${b.id}/check-out-preview`);
    expect(owing.body).toMatchObject({ ok: false, policy: 'block', unstayedNights: 2 });
    expect(owing.body.problem.reason).toBe('balance_open');
    expect(Number(owing.body.balance)).toBeCloseTo(Number(b.amount), 2);
    expect((await booking(fx, b.id)).status).toBe('CheckedIn');

    await payInFull(fx, b.id);
    const settled = await get(fx, `/bookings/${b.id}/check-out-preview`);
    expect(settled.body).toMatchObject({ ok: true, problem: null, balance: '0.00' });
  });

  it('lets the desk check out a balance with the owner approving on the spot', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const desk = await addDeskUser(fx);
    const b = await arrival(fx);
    await post(fx, `/bookings/${b.id}/check-in`);

    const approval = await post(
      fx,
      '/auth/step-up',
      { email: fx.email, password: PASSWORD, action: 'checkout_balance' },
      desk.token,
    );
    expect(approval.status).toBe(200);
    const out = await post(
      fx,
      `/bookings/${b.id}/check-out`,
      {
        allowBalance: true,
        reason: 'Company pays by transfer',
        approvalToken: approval.body.approvalToken,
      },
      desk.token,
    );
    expect(out.status, JSON.stringify(out.body)).toBe(200);
  });
});

describe('changing an in-house stay', () => {
  it('extends the stay: prices only the added nights, keeps the room, keeps the bill whole', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 2);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const b = await arrival(fx, 2);
    await post(fx, `/bookings/${b.id}/check-in`);
    const nightly = Number(b.amount) / 2;

    const res = await post(fx, `/bookings/${b.id}/change-departure`, {
      checkout: hotelToday(4),
      reason: 'Guest asked for two more nights',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.checkout).toBe(hotelToday(4));
    expect(res.body.nights).toBe(4);
    expect(Number(res.body.amount)).toBeCloseTo(nightly * 4, 2);
    expect(await roomsToSell(fx, hotelToday(3))).toBe(1);
    const legs = (await get(fx, `/bookings/${b.id}/rooms`)).body;
    expect(legs[0]).toMatchObject({ roomUnitId: u1, checkout: hotelToday(4) });

    // Every night posted to the folio adds up to the new amount, to the cent.
    await post(fx, `/bookings/${b.id}/folio/post-room-charges`);
    const folio = await get(fx, `/bookings/${b.id}/folio`);
    expect(Number(folio.body.totals.charges)).toBeCloseTo(Number(res.body.amount), 2);
  });

  it('refuses to extend into a night the room is sold to someone else, and says which', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 2);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const b = await arrival(fx, 2);
    await post(fx, `/bookings/${b.id}/check-in`);
    // Room 01 is booked from the day this guest leaves.
    const next = await book(fx, { checkin: hotelToday(2), checkout: hotelToday(4) });
    const legs = (await get(fx, `/bookings/${next.body.id}/rooms`)).body;
    await post(fx, `/bookings/${next.body.id}/approve`);
    await post(fx, `/bookings/${next.body.id}/assign`, {
      assignments: [{ legId: legs[0].id, roomUnitId: u1 }],
    });

    const res = await post(fx, `/bookings/${b.id}/change-departure`, {
      checkout: hotelToday(3),
      reason: 'One more night',
    });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('room_taken');
    expect(res.body.message).toMatch(/Room 01/);
    // Nothing changed.
    expect((await booking(fx, b.id)).checkout).toBe(hotelToday(2));
    expect(await roomsToSell(fx, hotelToday(2))).toBe(1);
  });

  it('shortens the stay: the nights go back on sale and off the bill', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const b = await arrival(fx, 4);
    await post(fx, `/bookings/${b.id}/check-in`);
    // The desk had posted the whole stay up front.
    await post(fx, `/bookings/${b.id}/folio/post-room-charges`);

    const res = await post(fx, `/bookings/${b.id}/change-departure`, {
      checkout: hotelToday(1),
      reason: 'Leaving tomorrow instead',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.nights).toBe(1);
    expect(Number(res.body.amount)).toBeCloseTo(Number(b.amount) / 4, 2);
    expect(await roomsToSell(fx, hotelToday(2))).toBe(2);
    const folio = await get(fx, `/bookings/${b.id}/folio`);
    expect(Number(folio.body.totals.charges)).toBeCloseTo(Number(res.body.amount), 2);
  });

  it('will not move a departure into the past', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx, 3);
    await post(fx, `/bookings/${b.id}/check-in`);
    const res = await post(fx, `/bookings/${b.id}/change-departure`, {
      checkout: hotelToday(-1),
      reason: 'Typo',
    });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('departure_in_past');
  });
});

describe('money at the desk', () => {
  it('refunds no more than was paid, nets it off the bill, and takes it out of the till', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    const cash = await cashMethod(fx);
    const drawer = await post(fx, `/properties/${fx.propertyId}/drawers`, { name: 'Desk' });
    const session = await post(fx, `/drawers/${drawer.body.id}/open`, { openingFloat: 1000 });
    const folio = await get(fx, `/bookings/${b.id}/folio`);
    const windowId = folio.body.windows[0].id;
    await post(fx, `/folios/${windowId}/payments`, { amount: 5000, paymentMethodId: cash });

    const tooMuch = await post(fx, `/folios/${windowId}/refunds`, {
      amount: 6000,
      paymentMethodId: cash,
      reason: 'Overpaid',
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.reason).toBe('refund_exceeds_paid');

    const refund = await post(fx, `/folios/${windowId}/refunds`, {
      amount: 2000,
      paymentMethodId: cash,
      reason: 'Deposit returned — booked a smaller room',
    });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(refund.body.direction).toBe('sent');

    const after = await get(fx, `/bookings/${b.id}/folio`);
    expect(Number(after.body.totals.paid)).toBe(3000);
    const report = await get(fx, `/drawer-sessions/${session.body.id}/report`);
    expect(Number(report.body.totals.expected)).toBe(1000 + 5000 - 2000);
  });

  it('needs the owner for a refund, approved on the spot', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const desk = await addDeskUser(fx);
    const b = await arrival(fx);
    const cash = await cashMethod(fx);
    const folio = await get(fx, `/bookings/${b.id}/folio`);
    const windowId = folio.body.windows[0].id;
    await post(fx, `/folios/${windowId}/payments`, { amount: 3000, paymentMethodId: cash });

    const body = { amount: 1000, paymentMethodId: cash, reason: 'Goodwill' };
    const refused = await post(fx, `/folios/${windowId}/refunds`, body, desk.token);
    expect(refused.status).toBe(403);
    expect(refused.body.reason).toBe('approval_required');

    const approval = await post(
      fx,
      '/auth/step-up',
      { email: fx.email, password: PASSWORD, action: 'refund' },
      desk.token,
    );
    const ok = await post(
      fx,
      `/folios/${windowId}/refunds`,
      { ...body, approvalToken: approval.body.approvalToken },
      desk.token,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('catches a payment recorded twice, and records it when the desk confirms', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    const cash = await cashMethod(fx);
    const folio = await get(fx, `/bookings/${b.id}/folio`);
    const windowId = folio.body.windows[0].id;
    const pay = { amount: 2500, paymentMethodId: cash };

    expect((await post(fx, `/folios/${windowId}/payments`, pay)).status).toBe(201);
    const twice = await post(fx, `/folios/${windowId}/payments`, pay);
    expect(twice.status).toBe(409);
    expect(twice.body.reason).toBe('possible_duplicate');
    const confirmed = await post(fx, `/folios/${windowId}/payments`, {
      ...pay,
      confirmDuplicate: true,
    });
    expect(confirmed.status).toBe(201);
    // A different amount is simply a payment.
    expect((await post(fx, `/folios/${windowId}/payments`, { ...pay, amount: 100 })).status).toBe(
      201,
    );
  });

  it('will not void a charge without saying why', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    const folio = await get(fx, `/bookings/${b.id}/folio`);
    const charge = await post(fx, `/folios/${folio.body.windows[0].id}/charges`, {
      description: 'Laundry',
      unitPrice: 800,
    });
    const res = await post(fx, `/folio-charges/${charge.body.id}/void`, {});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Reason: /);
  });
});
