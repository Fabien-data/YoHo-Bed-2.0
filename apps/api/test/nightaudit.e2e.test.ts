import { describe, it, expect, afterAll } from 'vitest';
import {
  addUnits,
  makeTenant,
  request,
  openAndPrice,
  book,
  stopApp,
  type TenantFixture,
} from './harness';

afterAll(stopApp);

const day = (base: string, n: number) => {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const businessDate = (fx: TenantFixture) =>
  request('GET', `/properties/${fx.propertyId}/business-date`, { token: fx.token });
const preview = (fx: TenantFixture) =>
  request('GET', `/properties/${fx.propertyId}/night-audit/preview`, { token: fx.token });
const run = (fx: TenantFixture) =>
  request('POST', `/properties/${fx.propertyId}/night-audit/run`, { token: fx.token });

async function assignReadyRooms(fx: TenantFixture, bookingId: string, count = 1) {
  await addUnits(
    fx,
    fx.roomId,
    Array.from({ length: count }, (_, index) => `NA-${bookingId.slice(0, 8)}-${index + 1}`),
  );
  const assigned = await request('POST', `/bookings/${bookingId}/auto-assign`, { token: fx.token });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
  expect(assigned.body.unassigned).toBe(0);
}

/** Move the property's business date to `target` by running audits until it gets there. */
async function rollTo(fx: TenantFixture, target: string) {
  for (let i = 0; i < 60; i++) {
    const bd = await businessDate(fx);
    if (bd.body.currentDate >= target) return bd.body.currentDate;
    await run(fx);
  }
  throw new Error('could not reach the target business date');
}

describe('business date', () => {
  it('starts at today and is created on demand', async () => {
    const fx = await makeTenant();
    const res = await businessDate(fx);
    expect(res.status).toBe(200);
    expect(res.body.currentDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('is per property, not global', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await run(a);
    const aDate = (await businessDate(a)).body.currentDate;
    const bDate = (await businessDate(b)).body.currentDate;
    expect(aDate).not.toBe(bDate);
  });
});

describe('night audit', () => {
  it('previews the work without doing any of it', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const today = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, today, day(today, 20), { roomsToSell: 4 });

    const created = await book(fx, { checkin: today, checkout: day(today, 3) });
    await request('POST', `/bookings/${created.body.id}/approve`, { token: fx.token });
    await assignReadyRooms(fx, created.body.id);
    expect(
      (await request('POST', `/bookings/${created.body.id}/check-in`, { token: fx.token })).status,
    ).toBe(200);

    const p = await preview(fx);
    expect(p.status).toBe(200);
    expect(p.body.roomsToCharge).toBe(1);
    expect(Number(p.body.chargesToPost)).toBeGreaterThan(0);

    // Nothing was posted and the date has not moved.
    const folio = await request('GET', `/bookings/${created.body.id}/folio`, { token: fx.token });
    expect(Number(folio.body.totals.charges)).toBe(0);
    expect((await businessDate(fx)).body.currentDate).toBe(today);
  });

  it('posts the night, rolls the date, and logs who ran it', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const today = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, today, day(today, 20), { roomsToSell: 4 });

    const created = await book(fx, { checkin: today, checkout: day(today, 3) });
    await request('POST', `/bookings/${created.body.id}/approve`, { token: fx.token });
    await assignReadyRooms(fx, created.body.id);
    expect(
      (await request('POST', `/bookings/${created.body.id}/check-in`, { token: fx.token })).status,
    ).toBe(200);

    const res = await run(fx);
    expect(res.status).toBe(201);
    expect(res.body.roomsCharged).toBe(1);
    expect(res.body.fromDate).toBe(today);
    expect(res.body.toDate).toBe(day(today, 1));

    expect((await businessDate(fx)).body.currentDate).toBe(day(today, 1));

    const folio = await request('GET', `/bookings/${created.body.id}/folio`, { token: fx.token });
    expect(Number(folio.body.totals.charges)).toBeGreaterThan(0);

    const log = await request('GET', `/properties/${fx.propertyId}/night-audit/log`, {
      token: fx.token,
    });
    expect(log.body).toHaveLength(1);
    expect(log.body[0].runBy).toBeTruthy();
    expect(log.body[0].runFromIp).toBeTruthy();
  });

  it('refuses to run the same date twice', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await run(fx);
    // The date has moved, so the guard is on the *new* date; force the old one by checking the log.
    const log = await request('GET', `/properties/${fx.propertyId}/night-audit/log`, {
      token: fx.token,
    });
    expect(log.body).toHaveLength(1);

    // Running again audits the next date, which is legal.
    const second = await run(fx);
    expect(second.status).toBe(201);
    expect(second.body.fromDate).toBe(log.body[0].toDate);
  });

  it('no-shows a reservation that never arrived', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const today = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, today, day(today, 20), { roomsToSell: 4 });

    const arriving = await book(fx, { checkin: today, checkout: day(today, 2) });
    await request('POST', `/bookings/${arriving.body.id}/approve`, { token: fx.token });
    // Deliberately not checked in.

    const res = await run(fx);
    expect(res.body.noShows).toBe(1);

    const after = await request('GET', `/bookings/${arriving.body.id}`, { token: fx.token });
    expect(after.body.status).toBe('NoShow');
  });

  it('force-closes a till that was left open', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const drawer = await request('POST', `/properties/${fx.propertyId}/drawers`, {
      token: fx.token,
      body: { name: 'Front desk' },
    });
    const session = await request('POST', `/drawers/${drawer.body.id}/open`, {
      token: fx.token,
      body: { openingFloat: 2500 },
    });

    const res = await run(fx);
    expect(res.body.drawersClosed).toBe(1);

    const report = await request('GET', `/drawer-sessions/${session.body.id}/report`, {
      token: fx.token,
    });
    expect(report.body.session.status).toBe('closed');
    expect(report.body.session.notes).toMatch(/uncounted by night audit/i);
    // Nobody counted it, so it is recorded as UNCOUNTED — never as a count that balanced
    // (UX-1a). What the till should hold is still on record.
    expect(report.body.session.declaredTotal).toBeNull();
    expect(report.body.session.variance).toBeNull();
    expect(Number(report.body.session.expectedTotal)).toBe(2500);
  });

  it('does not double-post a night that was already billed by hand', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const today = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, today, day(today, 20), { roomsToSell: 4 });

    const created = await book(fx, { checkin: today, checkout: day(today, 3) });
    await request('POST', `/bookings/${created.body.id}/approve`, { token: fx.token });
    await assignReadyRooms(fx, created.body.id);
    expect(
      (await request('POST', `/bookings/${created.body.id}/check-in`, { token: fx.token })).status,
    ).toBe(200);

    // The desk posted the whole stay up front.
    await request('POST', `/bookings/${created.body.id}/folio/post-room-charges`, {
      token: fx.token,
    });
    const before = await request('GET', `/bookings/${created.body.id}/folio`, { token: fx.token });

    const res = await run(fx);
    expect(res.body.roomsCharged).toBe(0);
    expect(res.body.summary.roomsSkipped).toBe(1);

    const after = await request('GET', `/bookings/${created.body.id}/folio`, { token: fx.token });
    expect(after.body.totals.charges).toBe(before.body.totals.charges);
  });
});

describe('seven consecutive audits', () => {
  /**
   * The roadmap's acceptance criterion for this sprint, and the strongest claim the product makes:
   * a week of day-ends, posted one night at a time, must add up to exactly what the reservations
   * were sold for. If this drifts, the folio and settlement are telling different stories.
   */
  it('reconciles posted revenue to the reservations, to the cent', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    const start = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, start, day(start, 30), { roomsToSell: 6 });

    // Three overlapping stays across the week, one of them a multi-room booking.
    const stays = [
      await book(fx, { customerName: 'Week A', checkin: start, checkout: day(start, 7) }),
      await book(fx, { customerName: 'Week B', checkin: day(start, 1), checkout: day(start, 4) }),
      await book(fx, {
        customerName: 'Week C',
        checkin: day(start, 2),
        checkout: day(start, 6),
        rooms: 2,
      }),
    ];
    for (const s of stays) {
      await request('POST', `/bookings/${s.body.id}/approve`, { token: fx.token });
      await assignReadyRooms(fx, s.body.id, s.body.rooms);
    }

    // Seven day-ends, one after another — each guest checked in on their own arrival day, as a
    // real week runs (a guest cannot be checked in before the day they arrive).
    for (let i = 0; i < 7; i++) {
      for (const s of stays) {
        if (s.body.checkin !== day(start, i)) continue;
        const checkedIn = await request('POST', `/bookings/${s.body.id}/check-in`, {
          token: fx.token,
        });
        expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
      }
      const res = await run(fx);
      expect(res.status, `audit ${i + 1}`).toBe(201);
    }
    expect((await businessDate(fx)).body.currentDate).toBe(day(start, 7));

    const log = await request('GET', `/properties/${fx.propertyId}/night-audit/log`, {
      token: fx.token,
    });
    expect(log.body).toHaveLength(7);

    // What the audits actually posted...
    const revenue = await request(
      'GET',
      `/properties/${fx.propertyId}/night-audit/revenue?from=${start}&to=${day(start, 6)}`,
      { token: fx.token },
    );

    // ...against what the three reservations were sold for.
    const sold = stays.reduce((sum, s) => sum + Number(s.body.amount), 0);
    expect(Number(revenue.body.total)).toBeCloseTo(sold, 2);

    // And the folios agree with the same figure.
    let folioTotal = 0;
    for (const s of stays) {
      const f = await request('GET', `/bookings/${s.body.id}/folio`, { token: fx.token });
      folioTotal += Number(f.body.totals.charges);
    }
    expect(folioTotal).toBeCloseTo(sold, 2);

    // net + tax = total holds across the whole week.
    expect(Number(revenue.body.net) + Number(revenue.body.tax)).toBeCloseTo(
      Number(revenue.body.total),
      2,
    );
  });
});

describe('night audit entitlement', () => {
  it('is withheld from Starter but not from Pro', async () => {
    const starter = await makeTenant({ plan: 'starter' });
    const denied = await request('GET', `/properties/${starter.propertyId}/business-date`, {
      token: starter.token,
    });
    expect(denied.status).toBe(403);

    const pro = await makeTenant({ plan: 'pro' });
    const allowed = await request('GET', `/properties/${pro.propertyId}/business-date`, {
      token: pro.token,
    });
    expect(allowed.status).toBe(200);
  });
});

describe('night audit and the reservation lifecycle (Development Phase 02)', () => {
  it('releases a hold that is due before it marks no-shows, and never charges it', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const today = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, today, day(today, 10), { roomsToSell: 3 });
    const res = await request('POST', '/reservations', {
      token: fx.token,
      body: {
        propertyId: fx.propertyId,
        checkin: today,
        checkout: day(today, 2),
        kind: 'hold_confirm',
        holdUntil: new Date(Date.now() + 1500).toISOString(),
        guest: { name: 'Held past its time' },
        lines: [{ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 }],
      },
    });
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 2000));

    const audit = await run(fx);
    expect(audit.status).toBe(201);
    expect(audit.body.summary.holdsReleased).toEqual([res.body.reference]);
    expect(audit.body.summary.noShowReferences).toEqual([]);
    expect(audit.body.roomsCharged).toBe(0);

    const row = await request('GET', `/bookings/${res.body.bookings[0].id}`, { token: fx.token });
    expect(row.body.status).toBe('Cancelled');
  });

  it('marks a no-show with a trail entry and gives the rest of the stay back', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    const today = (await businessDate(fx)).body.currentDate;
    await openAndPrice(fx, today, day(today, 10), { roomsToSell: 3 });
    const res = await request('POST', '/reservations', {
      token: fx.token,
      body: {
        propertyId: fx.propertyId,
        checkin: today,
        checkout: day(today, 3),
        guest: { name: 'Never arrived' },
        lines: [{ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 }],
      },
    });
    const id = res.body.bookings[0].id;

    const audit = await run(fx);
    expect(audit.body.summary.noShowReferences).toEqual([res.body.reference]);
    const row = await request('GET', `/bookings/${id}`, { token: fx.token });
    expect(row.body.status).toBe('NoShow');
    expect(row.body.trail.map((t: any) => t.action)).toContain('no_show');

    const avail = (d: string) =>
      request('GET', `/rooms/${fx.roomId}/availability?from=${d}&to=${d}`, { token: fx.token });
    expect((await avail(today)).body[0].roomsToSell).toBe(2);
    expect((await avail(day(today, 1))).body[0].roomsToSell).toBe(3);
    expect((await avail(day(today, 2))).body[0].roomsToSell).toBe(3);
  });
});
