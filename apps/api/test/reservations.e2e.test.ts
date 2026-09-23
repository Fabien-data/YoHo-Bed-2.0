import { describe, it, expect, afterAll } from 'vitest';
import {
  addUnits,
  makeTenant,
  request,
  openAndPrice,
  book,
  hotelToday,
  stopApp,
  type TenantFixture,
} from './harness';

afterAll(stopApp);

function reservations(fx: TenantFixture, date: string, extra = '') {
  return request('GET', `/reservations?propertyId=${fx.propertyId}&date=${date}${extra}`, {
    token: fx.token,
  });
}

async function checkIn(fx: TenantFixture, bookingId: string) {
  await request('POST', `/bookings/${bookingId}/approve`, { token: fx.token });
  await addUnits(fx, fx.roomId, [`IN-${bookingId.slice(0, 8)}`]);
  await request('POST', `/bookings/${bookingId}/auto-assign`, { token: fx.token });
  const checkedIn = await request('POST', `/bookings/${bookingId}/check-in`, { token: fx.token });
  expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
}

describe('reservations list', () => {
  it('counts every tab on every request, not just the active one', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, hotelToday(), hotelToday(20), { roomsToSell: 6 });
    // Seen as of two days from now; the in-house guests arrive (and are checked in) today.
    const day = hotelToday(2);

    // Arriving on the day, not yet in.
    await book(fx, { checkin: day, checkout: hotelToday(5) });
    // In-house across the day.
    const staying = await book(fx, { checkin: hotelToday(), checkout: hotelToday(7) });
    await checkIn(fx, staying.body.id);
    // Departing on the day.
    const leaving = await book(fx, { checkin: hotelToday(), checkout: day });
    await checkIn(fx, leaving.body.id);
    // Cancelled.
    const dead = await book(fx, { checkin: hotelToday(1), checkout: hotelToday(4) });
    await request('POST', `/bookings/${dead.body.id}/cancel`, { token: fx.token });

    const res = await reservations(fx, day);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({
      arrivals: 1,
      inhouse: 1,
      departures: 1,
    });
    // Cancelled ones are counted whatever their dates, so the tab is never mysteriously empty.
    expect(res.body.counts.cancelled).toBeGreaterThanOrEqual(1);
  });

  it('returns the rows of the tab that was asked for', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, hotelToday(), hotelToday(20), { roomsToSell: 4 });
    const day = hotelToday(2);

    await book(fx, {
      customerName: 'Arriving Guest',
      checkin: day,
      checkout: hotelToday(4),
    });
    const staying = await book(fx, {
      customerName: 'Staying Guest',
      checkin: hotelToday(),
      checkout: hotelToday(6),
    });
    await checkIn(fx, staying.body.id);

    const arrivals = await reservations(fx, day, '&tab=arrivals');
    expect(arrivals.body.rows).toHaveLength(1);
    expect(arrivals.body.rows[0].guestName).toBe('Arriving Guest');

    const inhouse = await reservations(fx, day, '&tab=inhouse');
    expect(inhouse.body.rows).toHaveLength(1);
    expect(inhouse.body.rows[0].guestName).toBe('Staying Guest');
  });

  it('searches by reference, guest name, email and phone', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2030-03-01', '2030-03-28', { roomsToSell: 4 });

    const created = await book(fx, {
      customerName: 'Wilhelmina Vance',
      customerEmail: 'wilhelmina@example.test',
      checkin: '2030-03-10',
      checkout: '2030-03-14',
    });
    await book(fx, { customerName: 'Someone Else', checkin: '2030-03-10', checkout: '2030-03-14' });

    for (const term of ['wilhelmina', 'WILHELMINA', 'helmi', created.body.reference]) {
      const res = await reservations(fx, '2030-03-11', `&q=${encodeURIComponent(term)}`);
      expect(res.body.rows, `searching for ${term}`).toHaveLength(1);
      expect(res.body.rows[0].guestName).toBe('Wilhelmina Vance');
    }

    const byEmail = await reservations(fx, '2030-03-11', '&q=example.test');
    expect(byEmail.body.rows).toHaveLength(1);
  });

  it('reports the rooms a booking holds and whether it still owes money', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: fx.roomId, code: '01' },
    });
    await openAndPrice(fx, '2030-04-01', '2030-04-28', { roomsToSell: 4 });

    const created = await book(fx, { checkin: '2030-04-10', checkout: '2030-04-14' });
    await request('POST', `/bookings/${created.body.id}/auto-assign`, { token: fx.token });

    const res = await reservations(fx, '2030-04-11');
    const row = res.body.rows.find((r: any) => r.id === created.body.id);
    expect(row.roomCodes).toEqual(['01']);
    expect(row.balanceDue).toBe(true);
  });

  it('never shows one tenant another tenant’s reservations', async () => {
    const a = await makeTenant({ roomQuantity: 2 });
    const b = await makeTenant();
    await openAndPrice(a, '2030-05-01', '2030-05-10', { roomsToSell: 2 });
    await book(a, { checkin: '2030-05-02', checkout: '2030-05-05' });

    const res = await request('GET', `/reservations?propertyId=${a.propertyId}&date=2030-05-03`, {
      token: b.token,
      tenantId: b.tenantId,
    });
    // The list reads the property's timezone first, and under RLS another tenant's property does
    // not exist — the same 404 as any other foreign id, rather than an empty list.
    expect(res.status).toBe(404);
    expect(res.body.rows).toBeUndefined();
  });
});

describe('reservation groups', () => {
  async function twoBookings(fx: TenantFixture) {
    await openAndPrice(fx, '2030-06-01', '2030-06-28', { roomsToSell: 6 });
    const a = await book(fx, {
      customerName: 'Group A',
      checkin: '2030-06-10',
      checkout: '2030-06-13',
    });
    const b = await book(fx, {
      customerName: 'Group B',
      checkin: '2030-06-10',
      checkout: '2030-06-13',
    });
    return [a.body.id, b.body.id] as const;
  }

  it('makes a group without merging the money', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    const [a, b] = await twoBookings(fx);

    const res = await request('POST', `/properties/${fx.propertyId}/booking-groups`, {
      token: fx.token,
      body: { bookingIds: [a, b], name: 'Vance wedding' },
    });
    expect(res.status).toBe(201);
    expect(res.body.memberCount).toBe(2);
    expect(res.body.code).toBe('001');

    // Each member keeps its own amount — the group total is a sum, not a merged folio.
    const amounts = res.body.members.map((m: any) => Number(m.amount));
    expect(Number(res.body.total)).toBeCloseTo(amounts[0] + amounts[1], 2);

    const list = await reservations(fx, '2030-06-11');
    const row = list.body.rows.find((r: any) => r.id === a);
    expect(row.groupCode).toBe('001');
    expect(row.groupName).toBe('Vance wedding');
  });

  it('refuses a group of one', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    const [a] = await twoBookings(fx);
    const res = await request('POST', `/properties/${fx.propertyId}/booking-groups`, {
      token: fx.token,
      body: { bookingIds: [a] },
    });
    expect(res.status).toBe(400);
  });

  it('merges another booking into an existing group, and lets one leave', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    const [a, b] = await twoBookings(fx);
    const third = await book(fx, {
      customerName: 'Group C',
      checkin: '2030-06-10',
      checkout: '2030-06-13',
    });

    const group = await request('POST', `/properties/${fx.propertyId}/booking-groups`, {
      token: fx.token,
      body: { bookingIds: [a, b] },
    });

    const merged = await request('POST', `/booking-groups/${group.body.id}/merge`, {
      token: fx.token,
      body: { bookingIds: [third.body.id] },
    });
    expect(merged.status).toBe(200);
    expect(merged.body.memberCount).toBe(3);

    const left = await request('DELETE', `/bookings/${third.body.id}/group`, { token: fx.token });
    expect(left.status).toBe(200);

    const after = await request('GET', `/booking-groups/${group.body.id}`, { token: fx.token });
    expect(after.body.memberCount).toBe(2);
  });

  it('refuses to move a booking that is already grouped, unless forced', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    const [a, b] = await twoBookings(fx);
    await request('POST', `/properties/${fx.propertyId}/booking-groups`, {
      token: fx.token,
      body: { bookingIds: [a, b] },
    });

    const again = await request('POST', `/properties/${fx.propertyId}/booking-groups`, {
      token: fx.token,
      body: { bookingIds: [a, b] },
    });
    expect(again.status).toBe(400);

    const forced = await request('POST', `/properties/${fx.propertyId}/booking-groups`, {
      token: fx.token,
      body: { bookingIds: [a, b], force: true },
    });
    expect(forced.status).toBe(201);
  });
});

describe('registration card', () => {
  it('carries the guest, the property and the rooms', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: fx.roomId, code: '01' },
    });
    await openAndPrice(fx, '2030-07-01', '2030-07-28', { roomsToSell: 3 });

    const created = await book(fx, {
      customerName: 'Wilhelmina Vance',
      checkin: '2030-07-10',
      checkout: '2030-07-13',
    });
    await request('POST', `/bookings/${created.body.id}/auto-assign`, { token: fx.token });

    const card = await request('GET', `/bookings/${created.body.id}/registration-card`, {
      token: fx.token,
    });
    expect(card.status).toBe(200);
    expect(card.body.guest.name).toBe('Wilhelmina Vance');
    expect(card.body.property.name).toBeTruthy();
    expect(card.body.legs[0].code).toBe('01');
    expect(card.body.nights).toBe(3);
  });
});

describe('guest profile', () => {
  it('records the details a registration card needs', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await openAndPrice(fx, '2030-08-01', '2030-08-10', { roomsToSell: 2 });
    const created = await book(fx, { checkin: '2030-08-02', checkout: '2030-08-05' });

    const list = await request('GET', '/customers', { token: fx.token });
    const guest = list.body[0];
    expect(guest.vip).toBe(false);

    const updated = await request('PATCH', `/customers/${guest.id}`, {
      token: fx.token,
      body: {
        nationality: 'Sri Lankan',
        idType: 'Passport',
        idNumber: 'N1234567',
        dateOfBirth: '1988-04-02',
        country: 'Sri Lanka',
        vip: true,
      },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      nationality: 'Sri Lankan',
      idNumber: 'N1234567',
      vip: true,
    });

    // The card picks the new details up without any further wiring.
    const card = await request('GET', `/bookings/${created.body.id}/registration-card`, {
      token: fx.token,
    });
    expect(card.body.guest).toMatchObject({ nationality: 'Sri Lankan', vip: true });
  });

  it('flags a VIP on the reservations list and the room card', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await request('POST', `/properties/${fx.propertyId}/room-units`, {
      token: fx.token,
      body: { roomId: fx.roomId, code: '01' },
    });
    await openAndPrice(fx, '2030-09-01', '2030-09-10', { roomsToSell: 2 });
    const created = await book(fx, { checkin: '2030-09-02', checkout: '2030-09-05' });
    await request('POST', `/bookings/${created.body.id}/auto-assign`, { token: fx.token });

    const list = await request('GET', '/customers', { token: fx.token });
    await request('PATCH', `/customers/${list.body[0].id}`, {
      token: fx.token,
      body: { vip: true },
    });

    const res = await reservations(fx, '2030-09-03');
    expect(res.body.rows[0].vip).toBe(true);

    const rooms = await request('GET', `/room-view?propertyId=${fx.propertyId}&date=2030-09-03`, {
      token: fx.token,
    });
    expect(rooms.body[0].vip).toBe(true);
  });
});
