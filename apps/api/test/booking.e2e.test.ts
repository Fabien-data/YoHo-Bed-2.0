import { afterAll, describe, expect, it } from 'vitest';
import {
  makeTenant,
  addUnits,
  openAndPrice,
  book,
  hotelToday,
  payInFull,
  request,
  stopApp,
} from './harness';

afterAll(stopApp);

/** Regression guards for the four legacy bugs, over the real HTTP path. */
describe('booking core — legacy bug regressions', () => {
  /** BUG #1: the read-modify-write overbooking race. */
  it('never oversells the last room under concurrency', async () => {
    const fx = await makeTenant({ roomQuantity: 1 });
    await openAndPrice(fx, '2027-04-01', '2027-04-05', { roomsToSell: 1 });

    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        book(fx, { customerName: `Racer ${i}`, checkin: '2027-04-02', checkout: '2027-04-03' }),
      ),
    );
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    expect(attempts.filter((r) => r.status === 409)).toHaveLength(9);

    const avail = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2027-04-02&to=2027-04-02`,
      {
        token: fx.token,
      },
    );
    expect(avail.body[0].roomsToSell).toBe(0); // never negative
  });

  /** BUG #2: the walk-in priced on room_id used as occupancy_rateplan_id. */
  it('prices on the occupancy key and rejects an occupancy from another room', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2027-04-10', '2027-04-20', { base: 18000 });

    const ok = await book(fx, { checkin: '2027-04-11', checkout: '2027-04-13' });
    expect(ok.status).toBe(201);
    // 2 nights × (18000 + 10% commission → ÷0.82) = 2 × 24390.25
    expect(Number(ok.body.amount)).toBeCloseTo(48780.5, 2);
    expect(ok.body.occupancyId).toBe(fx.occupancyId);

    const other = await makeTenant();
    const mismatch = await request('POST', '/bookings', {
      token: fx.token,
      body: {
        roomId: fx.roomId,
        occupancyId: other.occupancyId, // a real occupancy, wrong room
        customerName: 'Wrong Key',
        checkin: '2027-04-11',
        checkout: '2027-04-12',
      },
    });
    expect(mismatch.status).toBe(404);
  });

  /** BUG #4: MAX(reference)+1 handed out duplicates under load. */
  it('issues unique references for concurrent bookings', async () => {
    const fx = await makeTenant({ roomQuantity: 20 });
    await openAndPrice(fx, '2027-05-01', '2027-05-05', { roomsToSell: 20 });

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        book(fx, { customerName: `Guest ${i}`, checkin: '2027-05-02', checkout: '2027-05-03' }),
      ),
    );
    const refs = results.filter((r) => r.status === 201).map((r) => r.body.reference);
    expect(refs).toHaveLength(12);
    expect(new Set(refs).size).toBe(12);
  });

  it('refuses nights that have no price set', async () => {
    const fx = await makeTenant();
    await request('POST', `/rooms/${fx.roomId}/availability`, {
      token: fx.token,
      body: { from: '2027-06-01', to: '2027-06-05', roomsToSell: 5, status: 'Open' },
    });
    const res = await book(fx, { checkin: '2027-06-02', checkout: '2027-06-03' });
    expect(res.status).toBe(400);
    expect(String(res.body.message)).toMatch(/prices are not set/i);
  });
});

describe('booking lifecycle', () => {
  it('runs approve → check-in → check-out and blocks illegal transitions', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(9));
    // Arriving today: a guest can only be checked in on the arrival day. The stay is paid
    // in full so check-out's balance guard has nothing to refuse.
    const b = await book(fx, { checkin: hotelToday(), checkout: hotelToday(2) });
    await payInFull(fx, b.body.id);
    await addUnits(fx, fx.roomId, ['101']);

    // Cannot check in before approval.
    expect(
      (await request('POST', `/bookings/${b.body.id}/check-in`, { token: fx.token })).status,
    ).toBe(400);

    expect(
      (await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token })).body.status,
    ).toBe('Approved');
    expect(
      (await request('POST', `/bookings/${b.body.id}/auto-assign`, { token: fx.token })).status,
    ).toBe(200);
    expect(
      (await request('POST', `/bookings/${b.body.id}/check-in`, { token: fx.token })).body.status,
    ).toBe('CheckedIn');
    expect(
      (await request('POST', `/bookings/${b.body.id}/check-out`, { token: fx.token })).body.status,
    ).toBe('CheckedOut');

    // Terminal: no cancelling after check-out.
    expect(
      (await request('POST', `/bookings/${b.body.id}/cancel`, { token: fx.token })).status,
    ).toBe(400);
  });

  it('returns inventory when a booking is cancelled', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, '2027-08-01', '2027-08-05', { roomsToSell: 3 });
    const b = await book(fx, { checkin: '2027-08-02', checkout: '2027-08-03' });

    const during = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2027-08-02&to=2027-08-02`,
      {
        token: fx.token,
      },
    );
    expect(during.body[0].roomsToSell).toBe(2);

    await request('POST', `/bookings/${b.body.id}/cancel`, { token: fx.token });
    const after = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2027-08-02&to=2027-08-02`,
      {
        token: fx.token,
      },
    );
    expect(after.body[0].roomsToSell).toBe(3);
  });

  /**
   * 2026-08-28 audit: `rooms_to_sell` is a live counter that bookings decrement. Re-opening a
   * range used to write the requested number absolutely, silently resurrecting sold rooms —
   * a 10-room property with 6 sold would go straight back to 10 sellable and overbook.
   */
  it('does not resurrect sold rooms when availability is re-opened over live bookings', async () => {
    const fx = await makeTenant({ roomQuantity: 10 });
    await openAndPrice(fx, '2027-10-01', '2027-10-05', { roomsToSell: 10 });

    for (let i = 0; i < 6; i++) {
      const r = await book(fx, {
        customerName: `October Guest ${i}`,
        checkin: '2027-10-02',
        checkout: '2027-10-03',
      });
      expect(r.status).toBe(201);
    }

    // The routine monthly action: the owner re-opens the whole range at full quantity.
    const reopened = await request('POST', `/rooms/${fx.roomId}/availability`, {
      token: fx.token,
      body: { from: '2027-10-01', to: '2027-10-05', roomsToSell: 10, status: 'Open' },
    });
    expect(reopened.status).toBe(200);

    const avail = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2027-10-02&to=2027-10-02`,
      { token: fx.token },
    );
    expect(avail.body[0].roomsToSell).toBe(4); // 10 requested minus the 6 already sold

    // A night with no bookings goes back to the full count.
    const untouched = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2027-10-04&to=2027-10-04`,
      { token: fx.token },
    );
    expect(untouched.body[0].roomsToSell).toBe(10);
  });

  it('re-prices and swaps inventory when the stay is amended', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2027-09-01', '2027-09-10', { base: 18000 });
    const b = await book(fx, { checkin: '2027-09-02', checkout: '2027-09-04' }); // 2 nights

    const amended = await request('PATCH', `/bookings/${b.body.id}`, {
      token: fx.token,
      body: { checkin: '2027-09-02', checkout: '2027-09-05' }, // 3 nights
    });
    expect(amended.status).toBe(200);
    expect(amended.body.nights).toBe(3);
    expect(Number(amended.body.amount)).toBeCloseTo(24390.25 * 3, 2);

    // The freed night is back in inventory, the new night is taken.
    const avail = await request(
      'GET',
      `/rooms/${fx.roomId}/availability?from=2027-09-04&to=2027-09-04`,
      {
        token: fx.token,
      },
    );
    expect(avail.body[0].roomsToSell).toBe(4);
  });
});

describe('min/max stay restrictions', () => {
  it('enforces the arrival date’s min and max stay', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2027-10-01', '2027-10-20');
    const set = await request('POST', `/rooms/${fx.roomId}/restrictions`, {
      token: fx.token,
      body: { from: '2027-10-01', to: '2027-10-20', minStay: 2, maxStay: 5 },
    });
    expect(set.status).toBe(200);

    const tooShort = await book(fx, { checkin: '2027-10-05', checkout: '2027-10-06' });
    expect(tooShort.status).toBe(400);
    expect(String(tooShort.body.message)).toMatch(/minimum stay/i);

    const tooLong = await book(fx, { checkin: '2027-10-05', checkout: '2027-10-12' });
    expect(tooLong.status).toBe(400);
    expect(String(tooLong.body.message)).toMatch(/maximum stay/i);

    expect((await book(fx, { checkin: '2027-10-05', checkout: '2027-10-08' })).status).toBe(201);
  });

  it('rejects a max below the min', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2027-11-01', '2027-11-05');
    const res = await request('POST', `/rooms/${fx.roomId}/restrictions`, {
      token: fx.token,
      body: { from: '2027-11-01', to: '2027-11-05', minStay: 5, maxStay: 2 },
    });
    expect(res.status).toBe(400);
  });
});
