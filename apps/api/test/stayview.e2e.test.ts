import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  admin,
  payInFull,
  makeTenant,
  request,
  openAndPrice,
  book,
  hotelToday,
  stopApp,
  type TenantFixture,
} from './harness';

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
  return request('POST', `/bookings/${bookingId}/assign`, {
    token: fx.token,
    body: { assignments: [{ legId: legs.body[0].id, roomUnitId: unitId }] },
  });
}

function stayview(fx: TenantFixture, from: string, to: string) {
  return request('GET', `/stayview?propertyId=${fx.propertyId}&from=${from}&to=${to}`, {
    token: fx.token,
  });
}

describe('stay view', () => {
  it('returns the room types, their rooms and the date window', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await makeUnits(fx, 3);

    const res = await stayview(fx, '2028-01-01', '2028-01-08');
    expect(res.status).toBe(200);
    expect(res.body.dates).toHaveLength(7);
    expect(res.body.dates[0]).toBe('2028-01-01');
    expect(res.body.roomTypes).toHaveLength(1);
    expect(res.body.roomTypes[0].units.map((u: any) => u.code)).toEqual(['01', '02', '03']);
  });

  it('returns a populated 200-room calendar without losing units', async () => {
    const fx = await makeTenant({ roomQuantity: 200 });
    const units = Array.from({ length: 200 }, (_, index) => ({
      roomId: fx.roomId,
      code: String(index + 1).padStart(3, '0'),
      displayName: index % 25 === 0 ? `Named room ${index + 1}` : undefined,
      floor: String(Math.floor(index / 20) + 1),
      displayOrder: index,
    }));
    const created = await request('POST', `/properties/${fx.propertyId}/room-units/bulk`, {
      token: fx.token,
      body: { units },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toHaveLength(200);

    const res = await stayview(fx, '2028-01-01', '2028-01-31');
    expect(res.status).toBe(200);
    expect(res.body.dates).toHaveLength(30);
    expect(res.body.roomTypes[0].units).toHaveLength(200);
    expect(res.body.roomTypes[0].units[0]).toMatchObject({ code: '001', floor: '1' });
    expect(res.body.roomTypes[0].units[199]).toMatchObject({ code: '200', floor: '10' });
  });

  it('draws an assigned booking as a bar on its room', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await makeUnits(fx, 2);
    await openAndPrice(fx, '2028-02-01', '2028-02-20');
    const created = await book(fx, { checkin: '2028-02-05', checkout: '2028-02-08' });
    await assignFirstLeg(fx, created.body.id, u1!);

    const res = await stayview(fx, '2028-02-01', '2028-02-15');
    const unit = res.body.roomTypes[0].units.find((u: any) => u.id === u1);
    expect(unit.bars).toHaveLength(1);
    expect(unit.bars[0]).toMatchObject({
      kind: 'booking',
      from: '2028-02-05',
      to: '2028-02-08',
      guestName: 'E2E Guest',
      status: 'Pending',
      source: 'Extranet',
      balanceDue: true,
    });
  });

  it('puts an unassigned booking in the unassigned row, not on a room', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await makeUnits(fx, 2);
    await openAndPrice(fx, '2028-03-01', '2028-03-10');
    await book(fx, { checkin: '2028-03-02', checkout: '2028-03-05' });

    const res = await stayview(fx, '2028-03-01', '2028-03-10');
    expect(res.body.unassigned).toHaveLength(1);
    expect(res.body.roomTypes[0].units.every((u: any) => u.bars.length === 0)).toBe(true);
  });

  it('excludes a stay that ends on the first day of the window', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2028-04-01', '2028-04-20');
    const created = await book(fx, { checkin: '2028-04-01', checkout: '2028-04-05' });
    await assignFirstLeg(fx, created.body.id, u1!);

    // Half-open: the guest is gone on the 5th, so a window starting then must not show them.
    const res = await stayview(fx, '2028-04-05', '2028-04-10');
    expect(res.body.roomTypes[0].units[0].bars).toHaveLength(0);
  });

  it('divides occupancy by SELLABLE rooms, so a blocked room lifts the percentage', async () => {
    // Reproduces Yanolja exactly: 8 rooms, 1 blocked, 5 sold reads 71% (5/7), not 63% (5/8).
    const fx = await makeTenant({ roomQuantity: 8 });
    const units = await makeUnits(fx, 8);
    await openAndPrice(fx, '2028-05-01', '2028-05-20', { roomsToSell: 8 });

    await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: {
        roomUnitId: units[7],
        blockFrom: '2028-05-01',
        blockTo: '2028-05-10',
        reason: 'WATER LEAK',
      },
    });

    for (let i = 0; i < 5; i++) {
      const b = await book(fx, { checkin: '2028-05-02', checkout: '2028-05-04' });
      await assignFirstLeg(fx, b.body.id, units[i]!);
    }

    const res = await stayview(fx, '2028-05-02', '2028-05-03');
    expect(res.body.footer[0]).toMatchObject({
      soldRooms: 5,
      blocked: 1,
      totalRooms: 8,
      availableInventory: 2,
      occupancyPct: 71,
    });
  });

  it('counts the filter chips for the first day of the window', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const units = await makeUnits(fx, 4);
    await openAndPrice(fx, hotelToday(), hotelToday(20), { roomsToSell: 4 });

    // Both arrive today, so one of them can actually be checked in.
    const reserved = await book(fx, { checkin: hotelToday(), checkout: hotelToday(3) });
    await assignFirstLeg(fx, reserved.body.id, units[0]!);

    const inHouse = await book(fx, { checkin: hotelToday(), checkout: hotelToday(3) });
    await assignFirstLeg(fx, inHouse.body.id, units[1]!);
    await request('POST', `/bookings/${inHouse.body.id}/approve`, { token: fx.token });
    await request('POST', `/bookings/${inHouse.body.id}/check-in`, { token: fx.token });

    await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: {
        roomUnitId: units[3],
        blockFrom: hotelToday(),
        blockTo: hotelToday(8),
        reason: 'Repaint',
      },
    });

    const res = await stayview(fx, hotelToday(), hotelToday(4));
    expect(res.body.counts).toMatchObject({
      all: 4,
      occupied: 1,
      reserved: 1,
      blocked: 1,
      vacant: 1,
    });
  });

  it('rejects an inverted or absurdly wide window', async () => {
    const fx = await makeTenant();
    const inverted = await stayview(fx, '2028-07-10', '2028-07-01');
    expect(inverted.status).toBe(400);
    const tooWide = await stayview(fx, '2028-01-01', '2028-12-31');
    expect(tooWide.status).toBe(400);
  });

  it('never shows one tenant another tenant’s chart', async () => {
    const a = await makeTenant({ roomQuantity: 2 });
    const b = await makeTenant();
    await makeUnits(a, 2);

    const res = await request(
      'GET',
      `/stayview?propertyId=${a.propertyId}&from=2028-08-01&to=2028-08-05`,
      { token: b.token, tenantId: b.tenantId },
    );
    expect(res.status).toBe(200);
    expect(res.body.roomTypes).toEqual([]);
  });
});

describe('maintenance blocks', () => {
  it('blocks a room, shows it as a hatched bar, then releases it', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 2);

    const created = await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: {
        roomUnitId: u1,
        blockFrom: '2028-09-01',
        blockTo: '2028-09-05',
        reason: 'WATER LEAK',
      },
    });
    expect(created.status).toBe(201);

    const chart = await stayview(fx, '2028-09-01', '2028-09-08');
    const unit = chart.body.roomTypes[0].units.find((u: any) => u.id === u1);
    expect(unit.bars[0]).toMatchObject({ kind: 'block', reason: 'WATER LEAK' });

    const released = await request('POST', `/blocks/${created.body.id}/release`, {
      token: fx.token,
    });
    expect(released.status).toBe(200);

    const after = await stayview(fx, '2028-09-01', '2028-09-08');
    expect(after.body.roomTypes[0].units.find((u: any) => u.id === u1).bars).toHaveLength(0);
  });

  it('refuses to block a room over an existing block', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);
    const body = (from: string, to: string) => ({
      roomUnitId: u1,
      blockFrom: from,
      blockTo: to,
      reason: 'Works',
    });

    await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: body('2028-10-01', '2028-10-10'),
    });
    const clash = await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: body('2028-10-05', '2028-10-15'),
    });
    expect(clash.status).toBe(409);
  });

  it('refuses to block a room a guest is staying in', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2028-11-01', '2028-11-20');
    const created = await book(fx, { checkin: '2028-11-05', checkout: '2028-11-08' });
    await assignFirstLeg(fx, created.body.id, u1!);

    const res = await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: {
        roomUnitId: u1,
        blockFrom: '2028-11-06',
        blockTo: '2028-11-10',
        reason: 'Deep clean',
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/guest/i);
  });

  it('stops auto-assign putting a guest into a blocked room', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1, u2] = await makeUnits(fx, 2);
    await openAndPrice(fx, '2028-12-01', '2028-12-20', { roomsToSell: 2 });

    await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: { roomUnitId: u1, blockFrom: '2028-12-01', blockTo: '2028-12-20', reason: 'Refurb' },
    });

    const created = await book(fx, { checkin: '2028-12-05', checkout: '2028-12-08' });
    const res = await request('POST', `/bookings/${created.body.id}/auto-assign`, {
      token: fx.token,
    });
    // 01 is blocked, so first-fit must skip to 02.
    expect(res.body.assigned).toBe(1);
    expect(res.body.legs[0].roomUnitId).toBe(u2);
  });
});

describe('the day at the desk (owner brief, 2026-09-26)', () => {
  it('names the rooms guests leave today, and counts the rooms with money owed', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await makeUnits(fx, 3);
    const today = hotelToday();
    await openAndPrice(fx, today, hotelToday(10), { roomsToSell: 3 });

    // A guest who stayed last night in 01 and is due out this morning, still checked in.
    const leaving = await book(fx, { checkin: today, checkout: hotelToday(1) });
    await request('POST', `/bookings/${leaving.body.id}/approve`, { token: fx.token });
    await assignFirstLeg(fx, leaving.body.id, u1!);
    const inn = await request('POST', `/bookings/${leaving.body.id}/check-in`, {
      token: fx.token,
    });
    expect(inn.status, JSON.stringify(inn.body)).toBe(200);
    await admin().execute(sql`
      update bookings set checkin = ${hotelToday(-1)}::date, checkout = ${today}::date
       where id = ${leaving.body.id}`);
    await admin().execute(sql`
      update booking_rooms set checkin = ${hotelToday(-1)}::date, checkout = ${today}::date
       where booking_id = ${leaving.body.id}`);

    // A guest arriving today in 02, nothing paid yet.
    const arriving = await book(fx, { checkin: today, checkout: hotelToday(2) });
    await request('POST', `/bookings/${arriving.body.id}/approve`, { token: fx.token });
    await assignFirstLeg(fx, arriving.body.id, u2!);

    // The window starts today, so the departing stay has no night on screen...
    const res = await stayview(fx, today, hotelToday(7));
    expect(res.status).toBe(200);
    const units = res.body.roomTypes[0].units;
    const room1 = units.find((u: { id: string }) => u.id === u1);
    expect(room1.bars).toHaveLength(0);
    // ...but the room still says who is due out, so the Due out chip can find it.
    expect(room1.departures).toEqual([
      expect.objectContaining({ bookingId: leaving.body.id, balanceDue: true }),
    ]);
    expect(res.body.counts.dueOut).toBe(1);
    expect(res.body.counts.paymentDue).toBe(2);
    expect(res.body.dayClose).toMatchObject({
      autoCheckout: true,
      nightAudit: 'auto',
      auditTime: '02:00',
    });

    // Paid in full: the departing room owes nothing now.
    await payInFull(fx, leaving.body.id);
    const after = await stayview(fx, today, hotelToday(7));
    const room1After = after.body.roomTypes[0].units.find((u: { id: string }) => u.id === u1);
    expect(room1After.departures[0].balanceDue).toBe(false);
    expect(after.body.counts.paymentDue).toBe(1);
  });

  it('draws a failed online booking in its room, and crowns a VIP stay', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2028-05-01', '2028-05-20', { roomsToSell: 3 });
    const res = await request('POST', '/reservations', {
      token: fx.token,
      body: {
        propertyId: fx.propertyId,
        checkin: '2028-05-03',
        checkout: '2028-05-05',
        kind: 'online_failed',
        vip: true,
        guest: { name: 'Booked Online' },
        lines: [{ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2, roomUnitId: u1 }],
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const view = await stayview(fx, '2028-05-01', '2028-05-08');
    const bar = view.body.roomTypes[0].units[0].bars[0];
    expect(bar).toMatchObject({ reservationKind: 'online_failed', vip: true, vipStay: true });
    expect(view.body.tentative).toHaveLength(0);
  });
});
