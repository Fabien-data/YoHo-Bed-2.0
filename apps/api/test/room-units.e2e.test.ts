import { describe, it, expect, afterAll } from 'vitest';
import { makeTenant, request, openAndPrice, book, stopApp, type TenantFixture } from './harness';

afterAll(stopApp);

/** Create `n` physical rooms in the fixture's bucket, numbered 01..0n. */
async function makeUnits(fx: TenantFixture, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const res = await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: fx.roomId, code: String(i).padStart(2, '0') },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ids.push(res.body.id);
  }
  return ids;
}

describe('physical rooms', () => {
  it('creates, lists and renames a room, ordered by its number', async () => {
    const fx = await makeTenant();
    await makeUnits(fx, 3);

    const list = await request('GET', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
    });
    expect(list.status).toBe(200);
    expect(list.body.map((u: any) => u.code)).toEqual(['01', '02', '03']);
    expect(list.body[0]).toMatchObject({ roomName: 'E2E Room', status: 'active' });

    const renamed = await request('PATCH', `/room-units/${list.body[0].id}`, {
      token: fx.token,
      body: { code: '101', floor: '1' },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ code: '101', floor: '1' });
  });

  it('refuses a duplicate room number within a property', async () => {
    const fx = await makeTenant();
    await makeUnits(fx, 1);
    const dup = await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: fx.roomId, code: '01' },
    });
    expect(dup.status).toBe(409);
  });

  it('reports where the physical count and the sellable bucket disagree', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    await makeUnits(fx, 2);

    const counts = await request('GET', `/properties/${fx.propertyId}/room-units/counts`, {
      token: fx.token,
    });
    expect(counts.status).toBe(200);
    expect(counts.body[0]).toMatchObject({ quantity: 5, activeUnits: 2, totalUnits: 2 });
  });

  it('never shows one tenant another tenant’s rooms', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await makeUnits(a, 2);

    const res = await request('GET', `/properties/${a.propertyId}/room-units`, {
      token: b.token,
      tenantId: b.tenantId,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('room assignment', () => {
  it('gives a new booking one unassigned leg per room', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    await openAndPrice(fx, '2027-02-01', '2027-02-05');
    const created = await book(fx, { checkin: '2027-02-01', checkout: '2027-02-03', rooms: 2 });
    expect(created.status).toBe(201);

    const legs = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });
    expect(legs.status).toBe(200);
    expect(legs.body).toHaveLength(2);
    expect(legs.body.map((l: any) => l.legIndex)).toEqual([0, 1]);
    expect(legs.body.every((l: any) => l.roomUnitId === null)).toBe(true);
    // Pax is seeded from the occupancy the booking was priced on.
    expect(legs.body[0].adults).toBe(2);
  });

  it('assigns a specific room and reports it back by its number', async () => {
    const fx = await makeTenant();
    const [u1] = await makeUnits(fx, 2);
    await openAndPrice(fx, '2027-02-10', '2027-02-15');
    const created = await book(fx, { checkin: '2027-02-10', checkout: '2027-02-12' });
    const legs = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });

    const res = await request('POST', `/bookings/${created.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: u1 }] },
    });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ roomUnitId: u1, code: '01' });
  });

  it('refuses to put a second guest in a room that is already occupied', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2027-03-01', '2027-03-20');

    const first = await book(fx, { checkin: '2027-03-01', checkout: '2027-03-05' });
    const firstLegs = await request('GET', `/bookings/${first.body.id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${first.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: firstLegs.body[0].id, roomUnitId: u1 }] },
    });

    const second = await book(fx, { checkin: '2027-03-03', checkout: '2027-03-08' });
    const secondLegs = await request('GET', `/bookings/${second.body.id}/rooms`, {
      token: fx.token,
    });
    const clash = await request('POST', `/bookings/${second.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: secondLegs.body[0].id, roomUnitId: u1 }] },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/already occupied/i);
  });

  it('allows a same-day turnover in the same room', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2027-04-01', '2027-04-20');

    const out = await book(fx, { checkin: '2027-04-01', checkout: '2027-04-03' });
    const outLegs = await request('GET', `/bookings/${out.body.id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${out.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: outLegs.body[0].id, roomUnitId: u1 }] },
    });

    const inn = await book(fx, { checkin: '2027-04-03', checkout: '2027-04-06' });
    const innLegs = await request('GET', `/bookings/${inn.body.id}/rooms`, { token: fx.token });
    const res = await request('POST', `/bookings/${inn.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: innLegs.body[0].id, roomUnitId: u1 }] },
    });
    expect(res.status).toBe(200);
  });

  it('refuses a room belonging to a different room type', async () => {
    const fx = await makeTenant();
    await makeUnits(fx, 1);

    const otherRoom = await request('POST', `/properties/${fx.propertyId}/rooms`, {
      token: fx.token,
      body: { name: 'Other', quantity: 1 },
    });
    const otherUnit = await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: otherRoom.body.id, code: '90' },
    });

    await openAndPrice(fx, '2027-05-01', '2027-05-05');
    const created = await book(fx, { checkin: '2027-05-01', checkout: '2027-05-03' });
    const legs = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });

    const res = await request('POST', `/bookings/${created.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: otherUnit.body.id }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not part of the room type/i);
  });

  it('auto-assigns the lowest-numbered free rooms and reports the shortfall', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    await makeUnits(fx, 2);
    await openAndPrice(fx, '2027-06-01', '2027-06-10');

    const created = await book(fx, { checkin: '2027-06-01', checkout: '2027-06-04', rooms: 3 });
    const res = await request('POST', `/bookings/${created.body.id}/auto-assign`, {
      token: fx.token,
    });
    expect(res.status).toBe(200);
    // Only two physical rooms exist for a three-room booking: place what we can, report the rest.
    expect(res.body).toMatchObject({ assigned: 2, unassigned: 1 });
    expect(res.body.legs.map((l: any) => l.code)).toEqual(['01', '02', null]);
  });

  it('frees the room when the booking is cancelled, and remembers which it was', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2027-07-01', '2027-07-20');

    const first = await book(fx, { checkin: '2027-07-01', checkout: '2027-07-05' });
    const legs = await request('GET', `/bookings/${first.body.id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${first.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: u1 }] },
    });

    const cancelled = await request('POST', `/bookings/${first.body.id}/cancel`, {
      token: fx.token,
    });
    expect(cancelled.status).toBe(200);

    // The leg still records the room, but no longer holds it.
    const after = await request('GET', `/bookings/${first.body.id}/rooms`, { token: fx.token });
    expect(after.body[0].roomUnitId).toBe(u1);
    expect(after.body[0].releasedAt).not.toBeNull();

    const next = await book(fx, { checkin: '2027-07-02', checkout: '2027-07-06' });
    const nextLegs = await request('GET', `/bookings/${next.body.id}/rooms`, { token: fx.token });
    const res = await request('POST', `/bookings/${next.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: nextLegs.body[0].id, roomUnitId: u1 }] },
    });
    expect(res.status).toBe(200);
  });

  it('refuses to assign a room to a cancelled booking', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2027-08-01', '2027-08-10');

    const created = await book(fx, { checkin: '2027-08-01', checkout: '2027-08-03' });
    const legs = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${created.body.id}/cancel`, { token: fx.token });

    const res = await request('POST', `/bookings/${created.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: u1 }] },
    });
    expect(res.status).toBe(400);
  });

  it('refuses to deactivate a room that still has a future guest', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, '2099-01-01', '2099-01-10');

    const created = await book(fx, { checkin: '2099-01-01', checkout: '2099-01-05' });
    const legs = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${created.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: u1 }] },
    });

    const res = await request('PATCH', `/room-units/${u1}`, {
      token: fx.token,
      body: { status: 'inactive' },
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/reservations/i);
  });

  it('preserves existing room assignments and leaves added rooms unassigned when amended', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    const [u1] = await makeUnits(fx, 3);
    await openAndPrice(fx, '2027-09-01', '2027-09-20');

    const created = await book(fx, { checkin: '2027-09-01', checkout: '2027-09-04' });
    const legs = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });
    await request('POST', `/bookings/${created.body.id}/assign`, {
      token: fx.token,
      body: { assignments: [{ legId: legs.body[0].id, roomUnitId: u1 }] },
    });

    const amended = await request('PATCH', `/bookings/${created.body.id}`, {
      token: fx.token,
      body: { checkin: '2027-09-05', checkout: '2027-09-08', rooms: 2 },
    });
    expect(amended.status, JSON.stringify(amended.body)).toBe(200);

    const after = await request('GET', `/bookings/${created.body.id}/rooms`, { token: fx.token });
    expect(after.body).toHaveLength(2);
    expect(after.body.every((l: any) => l.checkin === '2027-09-05')).toBe(true);
    expect(after.body.find((l: any) => l.legIndex === 0).roomUnitId).toBe(u1);
    expect(after.body.find((l: any) => l.legIndex === 1).roomUnitId).toBeNull();
  });
});
