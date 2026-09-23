import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bookingApprovals, housekeepingStatus, housekeepingTasks } from '@yohobed/db';
import {
  addDeskUser,
  addUnits,
  admin,
  book,
  hotelToday,
  makeTenant,
  openAndPrice,
  request,
  startApp,
  stopApp,
  type TenantFixture,
} from './harness';
import { PropertyEventsService } from '../src/stayview/property-events.service';

/**
 * Stay View as the front desk's workspace: room and date changes made on the calendar are safe,
 * priced exactly as they will be saved, and on the reservation's own record.
 */
afterAll(stopApp);

async function legsOf(fx: TenantFixture, bookingId: string) {
  const res = await request('GET', `/bookings/${bookingId}/rooms`, { token: fx.token });
  return (res.body as Array<Record<string, any>>).filter((leg) => !leg.releasedAt);
}

async function assign(fx: TenantFixture, bookingId: string, unitId: string) {
  const [leg] = await legsOf(fx, bookingId);
  const res = await request('POST', `/bookings/${bookingId}/assign`, {
    token: fx.token,
    body: { assignments: [{ legId: leg!.id, roomUnitId: unitId }] },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A confirmed stay in `unitId`, optionally checked in. */
async function stay(
  fx: TenantFixture,
  unitId: string,
  checkin: string,
  checkout: string,
  opts: { checkIn?: boolean } = {},
) {
  const created = await book(fx, { checkin, checkout });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  await assign(fx, id, unitId);
  expect((await request('POST', `/bookings/${id}/approve`, { token: fx.token })).status).toBe(200);
  if (opts.checkIn) {
    const res = await request('POST', `/bookings/${id}/check-in`, { token: fx.token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  return id;
}

function trail(bookingId: string) {
  return admin().select().from(bookingApprovals).where(eq(bookingApprovals.bookingId, bookingId));
}

function calendar(fx: TenantFixture, from: string, to: string, token = fx.token) {
  return request('GET', `/stayview?propertyId=${fx.propertyId}&from=${from}&to=${to}`, { token });
}

describe('room changes on the calendar', () => {
  it('records who assigned and moved a room on the reservation trail', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await addUnits(fx, fx.roomId, ['101', '102']);
    await openAndPrice(fx, hotelToday(), hotelToday(30), { roomsToSell: 3 });
    const created = await book(fx, { checkin: hotelToday(10), checkout: hotelToday(12) });
    const id = created.body.id as string;

    await assign(fx, id, u1!);
    const [leg] = await legsOf(fx, id);
    const moved = await request('POST', `/bookings/${id}/room-move`, {
      token: fx.token,
      body: { legId: leg!.id, toRoomUnitId: u2, expectedUpdatedAt: leg!.updatedAt },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    const rows = await trail(id);
    const assigned = rows.find((r) => r.action === 'room_assigned');
    const relocated = rows.find((r) => r.action === 'room_moved');
    expect(assigned?.reason).toBe('Room 101 assigned');
    expect(relocated?.reason).toBe('Room 101 → 102');
    expect(assigned?.actorUserId).toBe(fx.userId);
    expect(relocated?.actorUserId).toBe(fx.userId);
  });

  it('moves an overdue arrival whole, leaving no nights it never stayed on the old room', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await addUnits(fx, fx.roomId, ['101', '102']);
    await openAndPrice(fx, hotelToday(-5), hotelToday(10), { roomsToSell: 3 });
    const id = await stay(fx, u1!, hotelToday(-2), hotelToday(2));
    const [leg] = await legsOf(fx, id);

    const moved = await request('POST', `/bookings/${id}/room-move`, {
      token: fx.token,
      body: { legId: leg!.id, toRoomUnitId: u2 },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    const legs = await legsOf(fx, id);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      roomUnitId: u2,
      checkin: hotelToday(-2),
      checkout: hotelToday(2),
    });
  });

  it('splits an in-house move at today and turns the vacated room over', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await addUnits(fx, fx.roomId, ['101', '102']);
    await openAndPrice(fx, hotelToday(-5), hotelToday(10), { roomsToSell: 3 });
    const id = await stay(fx, u1!, hotelToday(-1), hotelToday(2), { checkIn: true });
    const [leg] = await legsOf(fx, id);

    const moved = await request('POST', `/bookings/${id}/room-move`, {
      token: fx.token,
      body: { legId: leg!.id, toRoomUnitId: u2, expectedUpdatedAt: leg!.updatedAt },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    // Last night stays on 101's record; tonight onwards is 102.
    const legs = (await legsOf(fx, id)).sort((a, b) => a.checkin.localeCompare(b.checkin));
    expect(legs.map((l) => [l.roomUnitId, l.checkin, l.checkout])).toEqual([
      [u1, hotelToday(-1), hotelToday()],
      [u2, hotelToday(), hotelToday(2)],
    ]);
    const [status] = await admin()
      .select()
      .from(housekeepingStatus)
      .where(
        and(eq(housekeepingStatus.roomUnitId, u1!), eq(housekeepingStatus.date, hotelToday())),
      );
    expect(status?.status).toBe('dirty');
    const tasks = await admin()
      .select()
      .from(housekeepingTasks)
      .where(and(eq(housekeepingTasks.roomUnitId, u1!), eq(housekeepingTasks.bookingId, id)));
    expect(tasks.some((t) => t.kind === 'departure')).toBe(true);

    // The calendar draws two segments of one stay, each knowing its place in it.
    const chart = await calendar(fx, hotelToday(-2), hotelToday(5));
    const segments = chart.body.roomTypes[0].units
      .flatMap((u: any) => u.bars)
      .filter((b: any) => b.bookingId === id)
      .sort((a: any, b: any) => a.from.localeCompare(b.from));
    expect(segments.map((b: any) => b.segment)).toEqual([
      { index: 0, of: 2 },
      { index: 1, of: 2 },
    ]);
    expect(chart.body.roomTypes[0].units.find((u: any) => u.id === u1).housekeeping).toBe('dirty');
    // Leaving room 101 today is a room change, not a departure.
    expect(chart.body.counts).toMatchObject({ date: hotelToday(), dueOut: 0, occupied: 1 });
  });
});

describe('date changes on the calendar', () => {
  it('refuses to shift a split stay as one block and leaves it untouched', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await addUnits(fx, fx.roomId, ['101', '102']);
    await openAndPrice(fx, hotelToday(-5), hotelToday(15), { roomsToSell: 3 });
    const id = await stay(fx, u1!, hotelToday(-2), hotelToday(3));
    const [leg] = await legsOf(fx, id);
    // An explicit move date splits even a stay that has not arrived.
    const split = await request('POST', `/bookings/${id}/room-move`, {
      token: fx.token,
      body: { legId: leg!.id, toRoomUnitId: u2, effectiveDate: hotelToday() },
    });
    expect(split.status, JSON.stringify(split.body)).toBe(200);
    expect(await legsOf(fx, id)).toHaveLength(2);

    const preview = await request('POST', `/bookings/${id}/stay-change/preview`, {
      token: fx.token,
      body: { checkin: hotelToday(1), checkout: hotelToday(6) },
    });
    expect(preview.status).toBe(409);
    expect(preview.body.reason).toBe('split_stay');

    const b = await request('GET', `/bookings/${id}`, { token: fx.token });
    const commit = await request('POST', `/bookings/${id}/stay-change`, {
      token: fx.token,
      body: {
        checkin: hotelToday(1),
        checkout: hotelToday(6),
        expectedUpdatedAt: new Date(b.body.updatedAt).toISOString(),
        expectedAmount: '1.00',
      },
    });
    expect(commit.status).toBe(409);
    expect(commit.body.reason).toBe('split_stay');
    expect(await legsOf(fx, id)).toHaveLength(2);
  });

  it('records who changed the stay dates', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await addUnits(fx, fx.roomId, ['101']);
    await openAndPrice(fx, hotelToday(), hotelToday(30), { roomsToSell: 3 });
    const id = await stay(fx, u1!, hotelToday(10), hotelToday(12));
    const preview = await request('POST', `/bookings/${id}/stay-change/preview`, {
      token: fx.token,
      body: { checkin: hotelToday(11), checkout: hotelToday(14) },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(201);
    const commit = await request('POST', `/bookings/${id}/stay-change`, {
      token: fx.token,
      body: {
        checkin: hotelToday(11),
        checkout: hotelToday(14),
        expectedUpdatedAt: preview.body.expectedUpdatedAt,
        expectedAmount: preview.body.proposed.amount,
      },
    });
    expect(commit.status, JSON.stringify(commit.body)).toBe(201);
    const changed = (await trail(id)).find((r) => r.action === 'stay_changed');
    expect(changed?.actorUserId).toBe(fx.userId);
    expect(changed?.reason).toContain(`to ${hotelToday(11)}→${hotelToday(14)}`);
  });

  it('prices an in-house departure change exactly as saving it will', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await addUnits(fx, fx.roomId, ['101']);
    await openAndPrice(fx, hotelToday(-2), hotelToday(10), { roomsToSell: 3, base: 10000 });
    const id = await stay(fx, u1!, hotelToday(), hotelToday(2), { checkIn: true });

    const preview = await request(
      'GET',
      `/bookings/${id}/change-departure/preview?checkout=${hotelToday(4)}`,
      { token: fx.token },
    );
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.ok).toBe(true);
    expect(preview.body.nights).toHaveLength(4);
    expect(preview.body.nights.filter((n: any) => n.retained)).toHaveLength(2);
    expect(Number(preview.body.proposed.difference)).toBeGreaterThan(0);
    // Nothing was saved by the preview.
    const before = await request('GET', `/bookings/${id}`, { token: fx.token });
    expect(before.body.checkout).toBe(hotelToday(2));

    const stale = await request('POST', `/bookings/${id}/change-departure`, {
      token: fx.token,
      body: {
        checkout: hotelToday(4),
        reason: 'Guest asked for two more nights',
        expectedUpdatedAt: new Date(
          Date.parse(preview.body.expectedUpdatedAt) - 1000,
        ).toISOString(),
      },
    });
    expect(stale.status).toBe(409);

    const saved = await request('POST', `/bookings/${id}/change-departure`, {
      token: fx.token,
      body: {
        checkout: hotelToday(4),
        reason: 'Guest asked for two more nights',
        expectedUpdatedAt: preview.body.expectedUpdatedAt,
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.amount).toBe(preview.body.proposed.amount);

    const shorter = await request(
      'GET',
      `/bookings/${id}/change-departure/preview?checkout=${hotelToday(1)}`,
      { token: fx.token },
    );
    expect(shorter.body.ok).toBe(true);
    expect(Number(shorter.body.proposed.difference)).toBeLessThan(0);
  });
});

describe('the calendar payload', () => {
  it('carries the hotel today, leg versions and block kinds', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await addUnits(fx, fx.roomId, ['101', '102']);
    await openAndPrice(fx, hotelToday(), hotelToday(20), { roomsToSell: 3 });
    const id = await stay(fx, u1!, hotelToday(2), hotelToday(4));
    const blocked = await request('POST', `/properties/${fx.propertyId}/blocks`, {
      token: fx.token,
      body: {
        roomUnitId: u2,
        blockFrom: hotelToday(1),
        blockTo: hotelToday(3),
        reason: 'Owner visit',
        kind: 'blocked',
      },
    });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(201);
    expect(blocked.body.kind).toBe('blocked');

    const chart = await calendar(fx, hotelToday(), hotelToday(7));
    expect(chart.status).toBe(200);
    expect(chart.body.today).toBe(hotelToday());
    expect(chart.body.counts.date).toBe(hotelToday());
    const unit1 = chart.body.roomTypes[0].units.find((u: any) => u.id === u1);
    const unit2 = chart.body.roomTypes[0].units.find((u: any) => u.id === u2);
    const [leg] = await legsOf(fx, id);
    expect(unit1.bars[0]).toMatchObject({
      legIndex: 0,
      legUpdatedAt: leg!.updatedAt,
      segment: { index: 0, of: 1 },
    });
    expect(unit2.bars[0]).toMatchObject({ kind: 'block', blockKind: 'blocked' });

    const edited = await request('PATCH', `/blocks/${blocked.body.id}`, {
      token: fx.token,
      body: { kind: 'out_of_service', reason: 'Leak found' },
    });
    expect(edited.status).toBe(200);
    expect(edited.body.kind).toBe('out_of_service');
  });
});

describe('custom hotel roles at the desk', () => {
  async function customDesk(fx: TenantFixture, permissions: string[]) {
    const desk = await addDeskUser(fx);
    const role = await request('POST', '/hotel-roles', {
      token: fx.token,
      body: { name: `Desk ${permissions.length}`, permissions, propertyIds: [fx.propertyId] },
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    const assigned = await request('POST', `/hotel-roles/${role.body.id}/assign`, {
      token: fx.token,
      body: { userId: desk.userId },
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    return desk;
  }

  it('reaches the check-in dry runs, date changes and search, but not payments', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await addUnits(fx, fx.roomId, ['101']);
    await openAndPrice(fx, hotelToday(-2), hotelToday(10), { roomsToSell: 3 });
    const id = await stay(fx, u1!, hotelToday(), hotelToday(2));
    const desk = await customDesk(fx, [
      'reservation_read',
      'reservation_change',
      'check_in_out',
      'room_assignment',
      'financial_read',
    ]);

    for (const path of [`/bookings/${id}/check-in-preview`, `/bookings/${id}/balance`]) {
      const res = await request('GET', path, { token: desk.token });
      expect(res.status, `${path} ${JSON.stringify(res.body)}`).toBe(200);
    }
    const found = await request('GET', `/search?propertyId=${fx.propertyId}&q=E2E`, {
      token: desk.token,
    });
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.reservations.length).toBeGreaterThan(0);
    expect(found.body.reservations[0].amount).not.toBeNull();

    const checkIn = await request('POST', `/bookings/${id}/check-in`, { token: desk.token });
    expect(checkIn.status, JSON.stringify(checkIn.body)).toBe(200);
    const extend = await request(
      'GET',
      `/bookings/${id}/change-departure/preview?checkout=${hotelToday(3)}`,
      { token: desk.token },
    );
    expect(extend.status, JSON.stringify(extend.body)).toBe(200);

    const folio = await request('GET', `/bookings/${id}/folio`, { token: fx.token });
    const payment = await request('POST', `/folios/${folio.body.windows[0].id}/payments`, {
      token: desk.token,
      body: { amount: 100, method: 'cash' },
    });
    expect(payment.status).toBe(403);
  });

  it('finds stays without money or contact details when the role cannot see them', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1] = await addUnits(fx, fx.roomId, ['101']);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 3 });
    await stay(fx, u1!, hotelToday(1), hotelToday(3));
    const desk = await customDesk(fx, ['reservation_read']);

    const found = await request('GET', `/search?propertyId=${fx.propertyId}&q=E2E`, {
      token: desk.token,
    });
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body.reservations[0]).toMatchObject({ amount: null, guestPhone: null });
    expect(found.body.guests.every((g: any) => g.email === null && g.phone === null)).toBe(true);
    // Money stays out of the calendar too.
    const chart = await calendar(fx, hotelToday(), hotelToday(5), desk.token);
    expect(chart.status).toBe(200);
    expect(chart.body.roomTypes[0].units[0].bars[0].amount).toBeUndefined();
  });
});

describe('live calendar updates', () => {
  /** Collect the change signals one property's calendar would receive. */
  async function listen(fx: TenantFixture) {
    const app = await startApp();
    const seen: string[] = [];
    const sub = app
      .get(PropertyEventsService)
      .changes(fx.tenantId, fx.propertyId)
      .subscribe((e) => e.kind === 'change' && seen.push(e.kind));
    return { seen, stop: () => sub.unsubscribe() };
  }
  const settle = () => new Promise((r) => setTimeout(r, 900));

  it('tells a property’s open calendars about a committed change, and only that property’s', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const other = await makeTenant({ roomQuantity: 3 });
    const [u1] = await addUnits(fx, fx.roomId, ['101']);
    await openAndPrice(fx, hotelToday(), hotelToday(20), { roomsToSell: 3 });
    const mine = await listen(fx);
    const theirs = await listen(other);
    await settle();
    mine.seen.length = 0;
    theirs.seen.length = 0;

    await stay(fx, u1!, hotelToday(5), hotelToday(7));
    await settle();
    expect(mine.seen.length).toBeGreaterThan(0);
    expect(theirs.seen).toHaveLength(0);
    mine.stop();
    theirs.stop();
  });

  it('says nothing about a change that was written and then rolled back', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const [u1, u2] = await addUnits(fx, fx.roomId, ['101', '102']);
    await openAndPrice(fx, hotelToday(), hotelToday(20), { roomsToSell: 3 });
    await stay(fx, u2!, hotelToday(5), hotelToday(8));
    const two = await book(fx, { checkin: hotelToday(5), checkout: hotelToday(7), rooms: 2 });
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    const legs = await legsOf(fx, two.body.id);
    const listener = await listen(fx);
    await settle();
    listener.seen.length = 0;

    // The first room is written, the second clashes: the whole assignment rolls back, and a
    // rolled-back write must not tell anyone anything.
    const refused = await request('POST', `/bookings/${two.body.id}/assign`, {
      token: fx.token,
      body: {
        assignments: [
          { legId: legs[0]!.id, roomUnitId: u1 },
          { legId: legs[1]!.id, roomUnitId: u2 },
        ],
      },
    });
    expect(refused.status).toBe(409);
    await settle();
    expect(listener.seen).toHaveLength(0);
    listener.stop();
  });
});
