import { describe, it, expect, afterAll } from 'vitest';
import { makeTenant, request, openAndPrice, book, stopApp, type TenantFixture } from './harness';

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

async function assignFirstLeg(fx: TenantFixture, bookingId: string, unitId: string) {
  const legs = await request('GET', `/bookings/${bookingId}/rooms`, { token: fx.token });
  await request('POST', `/bookings/${bookingId}/assign`, {
    token: fx.token,
    body: { assignments: [{ legId: legs.body[0].id, roomUnitId: unitId }] },
  });
}

function roomView(fx: TenantFixture, date: string) {
  return request('GET', `/room-view?propertyId=${fx.propertyId}&date=${date}`, {
    token: fx.token,
  });
}

describe('room view', () => {
  it('shows every room as vacant and clean when nothing is happening', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await makeUnits(fx, 3);

    const res = await roomView(fx, '2029-01-10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({
      code: '01',
      state: 'Vacant',
      // A room nobody has touched is clean, not dirty — there is no row for it at all.
      housekeeping: 'clean',
      guestName: null,
    });
  });

  it('derives Occupied, PendingCheckout and ArrivingToday from the reservations', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const units = await makeUnits(fx, 3);
    await openAndPrice(fx, '2029-02-01', '2029-02-20', { roomsToSell: 4 });

    // In-house, staying on.
    const staying = await book(fx, { checkin: '2029-02-08', checkout: '2029-02-14' });
    await assignFirstLeg(fx, staying.body.id, units[0]!);
    await request('POST', `/bookings/${staying.body.id}/approve`, { token: fx.token });
    await request('POST', `/bookings/${staying.body.id}/check-in`, { token: fx.token });

    // In-house, leaving on the 10th.
    const leaving = await book(fx, { checkin: '2029-02-08', checkout: '2029-02-10' });
    await assignFirstLeg(fx, leaving.body.id, units[1]!);
    await request('POST', `/bookings/${leaving.body.id}/approve`, { token: fx.token });
    await request('POST', `/bookings/${leaving.body.id}/check-in`, { token: fx.token });

    // Arriving on the 10th, not yet checked in.
    const arriving = await book(fx, { checkin: '2029-02-10', checkout: '2029-02-12' });
    await assignFirstLeg(fx, arriving.body.id, units[2]!);

    const res = await roomView(fx, '2029-02-10');
    const by = Object.fromEntries(res.body.map((c: any) => [c.code, c]));
    expect(by['01'].state).toBe('Occupied');
    expect(by['02'].state).toBe('PendingCheckout');
    expect(by['03'].state).toBe('ArrivingToday');
    expect(by['01'].guestName).toBe('E2E Guest');
  });

  it('reads a maintenance block as out of order', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 2);
    await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: { roomUnitId: u1, blockFrom: '2029-03-01', blockTo: '2029-03-10', reason: 'Rewire' },
    });

    const res = await roomView(fx, '2029-03-05');
    const card = res.body.find((c: any) => c.unitId === u1);
    expect(card.state).toBe('OutOfOrder');
    expect(card.blockReason).toBe('Rewire');
  });
});

describe('housekeeping status', () => {
  it('marks a room dirty then clean, and remembers the remark', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);

    const dirty = await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: {
        roomUnitId: u1,
        date: '2029-04-01',
        status: 'dirty',
        remarks: 'Late checkout, needs a deep clean',
      },
    });
    expect(dirty.status).toBe(200);

    let view = await roomView(fx, '2029-04-01');
    expect(view.body[0]).toMatchObject({
      housekeeping: 'dirty',
      remarks: 'Late checkout, needs a deep clean',
    });

    // Upsert, not insert: the same room and date is updated in place.
    const clean = await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: u1, date: '2029-04-01', status: 'clean' },
    });
    expect(clean.status).toBe(200);

    view = await roomView(fx, '2029-04-01');
    expect(view.body[0].housekeeping).toBe('clean');

    // The status is per-date, so the next day is unaffected.
    const nextDay = await roomView(fx, '2029-04-02');
    expect(nextDay.body[0].housekeeping).toBe('clean');
  });

  it('treats an out-of-order housekeeping flag as an out-of-order room', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);
    await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: u1, date: '2029-05-01', status: 'out_of_order' },
    });

    const res = await roomView(fx, '2029-05-01');
    expect(res.body[0].state).toBe('OutOfOrder');
  });

  it('marks every room a guest left today as dirty, and no others', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const units = await makeUnits(fx, 3);
    await openAndPrice(fx, '2029-06-01', '2029-06-20', { roomsToSell: 4 });

    const departing = await book(fx, { checkin: '2029-06-05', checkout: '2029-06-08' });
    await assignFirstLeg(fx, departing.body.id, units[0]!);

    const staying = await book(fx, { checkin: '2029-06-05', checkout: '2029-06-12' });
    await assignFirstLeg(fx, staying.body.id, units[1]!);

    const res = await request(
      'POST',
      `/properties/${fx.propertyId}/housekeeping/mark-departures-dirty?date=2029-06-08`,
      { token: fx.token },
    );
    expect(res.status).toBe(200);
    expect(res.body.marked).toBe(1);

    const view = await roomView(fx, '2029-06-08');
    const by = Object.fromEntries(view.body.map((c: any) => [c.code, c]));
    expect(by['01'].housekeeping).toBe('dirty');
    // Still in-house — must not be dirtied.
    expect(by['02'].housekeeping).toBe('clean');
    expect(by['03'].housekeeping).toBe('clean');
  });

  it('counts a guest departing today as due out, not as gone', async () => {
    // Regression: the stay-view window excludes a stay ending exactly on `from` (checkout is
    // exclusive), so deriving due-out from the drawn bars returned 0 on the very date the chips
    // describe. The guest is still in the room until they physically leave.
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2029-11-01', '2029-11-20', { roomsToSell: 2 });

    const leaving = await book(fx, { checkin: '2029-11-05', checkout: '2029-11-08' });
    await assignFirstLeg(fx, leaving.body.id, u1!);
    await request('POST', `/bookings/${leaving.body.id}/approve`, { token: fx.token });
    await request('POST', `/bookings/${leaving.body.id}/check-in`, { token: fx.token });

    const chart = await request(
      'GET',
      `/stayview?propertyId=${fx.propertyId}&from=2029-11-08&to=2029-11-12`,
      { token: fx.token },
    );
    expect(chart.body.counts.dueOut).toBe(1);

    const view = await roomView(fx, '2029-11-08');
    expect(view.body[0].state).toBe('PendingCheckout');
    expect(view.body[0].guestName).toBe('E2E Guest');
  });

  it('summarises the house for the status chips', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const units = await makeUnits(fx, 3);
    await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: units[0], date: '2029-07-01', status: 'dirty' },
    });

    const res = await request(
      'GET',
      `/house-status/summary?propertyId=${fx.propertyId}&date=2029-07-01`,
      { token: fx.token },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ all: 3, vacant: 3, dirty: 1, clean: 2 });
  });

  it('feeds the dirty count into the stay view chips', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 2);
    await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: u1, date: '2029-08-01', status: 'dirty' },
    });

    const res = await request(
      'GET',
      `/stayview?propertyId=${fx.propertyId}&from=2029-08-01&to=2029-08-05`,
      { token: fx.token },
    );
    expect(res.body.counts.dirty).toBe(1);
  });
});

describe('work orders', () => {
  it('raises a work order against a room and completes it', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);

    const created = await request('POST', `/properties/${fx.propertyId}/work-orders`, {
      token: fx.token,
      body: {
        roomUnitId: u1,
        title: 'Air-con dripping',
        priority: 'high',
        deadline: '2029-09-05',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'open', priority: 'high' });

    const list = await request('GET', `/properties/${fx.propertyId}/work-orders`, {
      token: fx.token,
    });
    expect(list.body[0]).toMatchObject({ title: 'Air-con dripping', code: '01' });

    const done = await request('PATCH', `/work-orders/${created.body.id}`, {
      token: fx.token,
      body: { status: 'done' },
    });
    expect(done.status).toBe(200);
    expect(done.body.completedAt).not.toBeNull();

    const reopen = await request('PATCH', `/work-orders/${created.body.id}`, {
      token: fx.token,
      body: { status: 'open' },
    });
    expect(reopen.status).toBe(409);
  });

  it('allows a work order with no room — the lobby, the pool, the lift', async () => {
    const fx = await makeTenant();
    const res = await request('POST', `/properties/${fx.propertyId}/work-orders`, {
      token: fx.token,
      body: { title: 'Lobby lightbulbs', priority: 'low' },
    });
    expect(res.status).toBe(201);
    expect(res.body.roomUnitId).toBeNull();
  });

  it('counts open work orders on the room card', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);
    for (const title of ['Tap leaking', 'TV remote missing']) {
      await request('POST', `/properties/${fx.propertyId}/work-orders`, {
        token: fx.token,
        body: { roomUnitId: u1, title },
      });
    }

    const view = await roomView(fx, '2029-10-01');
    expect(view.body[0].openWorkOrders).toBe(2);
  });
});

describe('entitlements', () => {
  it('gives every plan housekeeping — even a Starter hotel has to clean rooms', async () => {
    const starter = await makeTenant({ plan: 'starter' });
    const res = await request('GET', `/room-view?propertyId=${starter.propertyId}`, {
      token: starter.token,
    });
    expect(res.status).toBe(200);
  });

  it('withholds work orders from Starter but not from Pro', async () => {
    const starter = await makeTenant({ plan: 'starter' });
    const denied = await request('GET', `/properties/${starter.propertyId}/work-orders`, {
      token: starter.token,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.message).toMatch(/work_orders/);

    const pro = await makeTenant({ plan: 'pro' });
    const allowed = await request('GET', `/properties/${pro.propertyId}/work-orders`, {
      token: pro.token,
    });
    expect(allowed.status).toBe(200);
  });
});
