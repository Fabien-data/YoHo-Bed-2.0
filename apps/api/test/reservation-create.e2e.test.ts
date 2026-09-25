import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  bookingApprovals,
  bookings,
  customers,
  notifications,
  outbox,
  taxTypes,
  sweepReservationLifecycle,
  dueLifecycleTenants,
  withTenant,
} from '@yohobed/db';
import {
  PASSWORD,
  addDeskUser,
  addRoomType,
  addUnits,
  admin,
  book,
  makeTenant,
  openAndPrice,
  request,
  reserve,
  roomsToSell,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * The reservation engine (Development Phase 02, Sprint 2): POST /reservations, the quote, the
 * kind × inventory matrix, price authority, and the hold lifecycle.
 */

afterAll(stopApp);

const CHECKIN = '2028-03-02';
const CHECKOUT = '2028-03-05'; // 3 nights
const OPEN_FROM = '2028-03-01';
const OPEN_TO = '2028-03-20';
/** Base 18,000 + 10% commission, grossed up for the OTA: the list price of an untaxed night. */
const LIST_NIGHT = 24390.25;

const line = (
  fx: { roomId: string; occupancyId: string },
  extra: Record<string, unknown> = {},
) => ({
  roomId: fx.roomId,
  occupancyId: fx.occupancyId,
  adults: 2,
  ...extra,
});

async function ready(opts: Parameters<typeof makeTenant>[0] = {}) {
  const fx = await makeTenant({ roomQuantity: 5, ...opts });
  await openAndPrice(fx, OPEN_FROM, OPEN_TO, { roomsToSell: 5, base: 18000 });
  return fx;
}

async function bookingsOf(fx: TenantFixture) {
  return admin().select().from(bookings).where(eq(bookings.tenantId, fx.tenantId));
}

async function detail(fx: TenantFixture, id: string) {
  return (await request('GET', `/bookings/${id}`, { token: fx.token })).body;
}

describe('golden parity with the walk-in', () => {
  for (const taxed of [false, true]) {
    it(`prices a calendar stay to the cent exactly as POST /bookings did (${taxed ? 'taxed' : 'untaxed'})`, async () => {
      const fx = await ready({ taxed });
      // A last-minute drop on one night exercises the drop path too.
      const drop = await request('POST', `/occupancies/${fx.occupancyId}/last-minute-drop`, {
        token: fx.token,
        body: { from: '2028-03-03', to: '2028-03-03', dropPct: 12.5 },
      });
      expect(drop.status).toBe(200);

      const legacy = await book(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        customerName: 'Golden A',
      });
      expect(legacy.status).toBe(201);
      const created = await reserve(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guest: { name: 'Golden B' },
        lines: [line(fx)],
      });
      expect(created.status).toBe(201);

      const a = await detail(fx, legacy.body.id);
      const b = await detail(fx, created.body.bookings[0].id);
      for (const k of ['amount', 'totalBasePrice', 'taxes', 'commissionableAmount', 'discount']) {
        expect(b[k], k).toBe(a[k]);
      }
      const pick = (d: any) => ({
        date: d.date,
        basePrice: d.basePrice,
        sellingPrice: d.sellingPrice,
        commission: d.commission,
        tax: d.tax,
      });
      expect(b.days.map(pick)).toEqual(a.days.map(pick));
      expect(b.days.every((d: any) => d.rateSource === 'calendar')).toBe(true);
      if (taxed) {
        // The per-tax split adds up to the stored tax on every night.
        for (const d of b.days) {
          const sum = d.taxLines.reduce((s: number, l: any) => s + Math.round(l.amount * 100), 0);
          expect(sum).toBe(Math.round(Number(d.tax) * 100));
        }
      }
    });
  }
});

describe('a multi-room reservation', () => {
  it('books two room types as sibling bookings in one group, with their guests', async () => {
    const fx = await ready();
    const suite = await addRoomType(fx, {
      name: 'Suite',
      quantity: 2,
      from: OPEN_FROM,
      to: OPEN_TO,
      base: 30000,
    });

    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { title: 'Mr', name: 'Nimal Perera', phone: '077 123 4567', whatsapp: true },
      lines: [
        line(fx, { adults: 2, children: 1, childAges: [6] }),
        line(suite, { adults: 3, extraBeds: 1 }),
      ],
    });
    expect(res.status).toBe(201);
    const master = res.body.reference as string;
    expect(master).toMatch(/^\d{10}$/);
    expect(res.body.bookings.map((b: any) => b.reference)).toEqual([`${master}-1`, `${master}-2`]);
    expect(res.body.groupId).toBeTruthy();
    expect(res.body.guest.created).toBe(true);

    const group = await request('GET', `/booking-groups/${res.body.groupId}`, { token: fx.token });
    expect(group.body.code).toBe(master);
    expect(group.body.memberCount).toBe(2);
    expect(group.body.kind).toBe('reservation');

    const legs = await request('GET', `/bookings/${res.body.bookings[0].id}/rooms`, {
      token: fx.token,
    });
    expect(legs.body[0]).toMatchObject({ adults: 2, children: 1 });

    const [guest] = await admin()
      .select()
      .from(customers)
      .where(eq(customers.id, res.body.guest.id));
    expect(guest!.mobileE164).toBe('+94771234567');
    expect(guest!.title).toBe('Mr');

    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
    expect(await roomsToSell(fx, suite.roomId, CHECKIN)).toBe(1);

    // One channel-manager event per room type, not per room.
    const events = await admin()
      .select()
      .from(outbox)
      .where(
        and(eq(outbox.tenantId, fx.tenantId), sql`${outbox.payload}->>'origin' = 'reservation'`),
      );
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.aggregateId))).toEqual(new Set([fx.roomId, suite.roomId]));
  });

  it('saves nothing at all when one room type is sold out', async () => {
    const fx = await ready();
    const suite = await addRoomType(fx, {
      quantity: 1,
      from: OPEN_FROM,
      to: OPEN_TO,
      roomsToSell: 1,
    });
    expect(
      (
        await reserve(fx, {
          checkin: CHECKIN,
          checkout: CHECKOUT,
          guest: { name: 'First' },
          lines: [line(suite)],
        })
      ).status,
    ).toBe(201);
    const before = await bookingsOf(fx);
    const outboxBefore = await admin()
      .select()
      .from(outbox)
      .where(eq(outbox.tenantId, fx.tenantId));

    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Nobody Saved' },
      lines: [line(fx), line(suite)],
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'insufficient_availability', lines: [1] });

    expect(await bookingsOf(fx)).toHaveLength(before.length);
    expect(
      await admin().select().from(customers).where(eq(customers.name, 'Nobody Saved')),
    ).toHaveLength(0);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(5);
    expect(
      await admin().select().from(outbox).where(eq(outbox.tenantId, fx.tenantId)),
    ).toHaveLength(outboxBefore.length);
  });

  it('names the room when a chosen room is already taken', async () => {
    const fx = await ready();
    const [r101, r102] = await addUnits(fx, fx.roomId, ['101', '102']);
    const first = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'In 101' },
      lines: [line(fx, { roomUnitId: r101 })],
    });
    expect(first.status).toBe(201);
    expect(first.body.bookings[0].roomCode).toBe('101');

    const res = await reserve(fx, {
      checkin: '2028-03-03',
      checkout: '2028-03-06',
      guest: { name: 'Wants 101' },
      lines: [line(fx, { roomUnitId: r102 }), line(fx, { roomUnitId: r101 })],
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'room_taken', line: 1 });
    expect(await roomsToSell(fx, fx.roomId, '2028-03-03')).toBe(4);
  });

  it('refuses another tenant’s ids as not found', async () => {
    const fx = await ready();
    const other = await ready();
    const base = { checkin: CHECKIN, checkout: CHECKOUT, guest: { name: 'Cross' } };

    expect((await reserve(fx, { ...base, lines: [line(other)] })).status).toBe(404);
    expect(
      (await reserve(fx, { ...base, propertyId: other.propertyId, lines: [line(fx)] })).status,
    ).toBe(404);
    const theirGuest = await reserve(other, { ...base, lines: [line(other)] });
    expect(
      (
        await reserve(fx, {
          ...base,
          guest: { customerId: theirGuest.body.guest.id },
          lines: [line(fx)],
        })
      ).status,
    ).toBe(404);
    const sources = await request('GET', '/business-sources', { token: other.token });
    expect(
      (await reserve(fx, { ...base, businessSourceId: sources.body[0].id, lines: [line(fx)] }))
        .status,
    ).toBe(404);
    expect(await bookingsOf(fx)).toHaveLength(0);
  });

  it('replays a retried request instead of booking twice', async () => {
    const fx = await ready();
    const key = `key-${Date.now()}`;
    const body = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Retry' },
      lines: [line(fx)],
    };
    const a = await reserve(fx, body, { idempotencyKey: key });
    const b = await reserve(fx, body, { idempotencyKey: key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.reference).toBe(a.body.reference);
    expect(await bookingsOf(fx)).toHaveLength(1);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);

    const c = await reserve(fx, { ...body, guest: { name: 'Different' } }, { idempotencyKey: key });
    expect(c.status).toBe(409);
    expect(c.body.reason).toBe('idempotency_key_reused');
  });

  it('never oversells or deadlocks under concurrent two-room-type reservations', async () => {
    const fx = await ready();
    const suite = await addRoomType(fx, {
      quantity: 3,
      from: OPEN_FROM,
      to: OPEN_TO,
      roomsToSell: 3,
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        reserve(fx, {
          checkin: CHECKIN,
          checkout: CHECKOUT,
          guest: { name: `Racer ${i}` },
          // Half the racers list the suite first, so lock order depends on the server, not them.
          lines: i % 2 ? [line(suite), line(fx)] : [line(fx), line(suite)],
        }),
      ),
    );
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(await roomsToSell(fx, suite.roomId, CHECKIN)).toBe(0);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(2);
  });
});

describe('reservation kinds and inventory', () => {
  it('takes rooms only for the kinds that hold them', async () => {
    const fx = await ready();
    const expected = {
      confirm: { status: 'Approved', delta: 1 },
      hold_confirm: { status: 'Approved', delta: 1 },
      hold_unconfirm: { status: 'Pending', delta: 1 },
      inquiry: { status: 'Pending', delta: 0 },
      // A failed online booking keeps the guest's room until the desk sorts it out.
      online_failed: { status: 'Pending', delta: 1 },
    } as const;
    for (const [kind, want] of Object.entries(expected)) {
      const before = await roomsToSell(fx, fx.roomId, CHECKIN);
      const res = await reserve(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        kind,
        guest: { name: `Kind ${kind}` },
        lines: [line(fx)],
      });
      expect(res.status, kind).toBe(201);
      expect(res.body.status, kind).toBe(want.status);
      expect(before - (await roomsToSell(fx, fx.roomId, CHECKIN)), kind).toBe(want.delta);
      const row = await detail(fx, res.body.bookings[0].id);
      expect(row.reservationKind).toBe(kind);
      expect(row.inventoryHeld).toBe(want.delta === 1);
      if (kind.startsWith('hold')) {
        // The property's default hold: 24 hours from now.
        const hours = (Date.parse(row.holdUntil) - Date.now()) / 3_600_000;
        expect(hours).toBeGreaterThan(23.9);
        expect(hours).toBeLessThan(24.1);
      } else {
        expect(row.holdUntil).toBeNull();
      }
    }
  });

  it('gives back rooms on cancel only when the booking held them', async () => {
    const fx = await ready();
    const inquiry = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'inquiry',
      guest: { name: 'Just asking' },
      lines: [line(fx)],
    });
    const hold = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'hold_confirm',
      guest: { name: 'Holding' },
      lines: [line(fx)],
    });
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
    await request('POST', `/bookings/${inquiry.body.bookings[0].id}/cancel`, { token: fx.token });
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
    await request('POST', `/bookings/${hold.body.bookings[0].id}/cancel`, { token: fx.token });
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(5);
  });

  it('refuses a release time on a kind that is not a hold, and one in the past', async () => {
    const fx = await ready();
    const base = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Times' },
      lines: [line(fx)],
    };
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    expect((await reserve(fx, { ...base, kind: 'confirm', holdUntil: soon })).status).toBe(400);
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await reserve(fx, { ...base, kind: 'hold_confirm', holdUntil: past })).status).toBe(
      400,
    );
    const never = await reserve(fx, { ...base, kind: 'hold_confirm', holdUntil: null });
    expect(never.status).toBe(201);
    expect(never.body.holdUntil).toBeNull();
  });

  it('confirms an inquiry by taking its rooms, into the room the guest asked for', async () => {
    const fx = await ready();
    const [r101] = await addUnits(fx, fx.roomId, ['101']);
    const inquiry = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'inquiry',
      guest: { name: 'Maybe' },
      lines: [line(fx, { roomUnitId: r101 })],
    });
    const id = inquiry.body.bookings[0].id;
    // An inquiry holds nothing, so it cannot be put in a room.
    const assign = await request('POST', `/bookings/${id}/auto-assign`, { token: fx.token });
    expect(assign.status).toBe(400);

    const ok = await request('POST', `/bookings/${id}/confirm`, { token: fx.token, body: {} });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'Approved', reservationKind: 'confirm' });
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
    const legs = await request('GET', `/bookings/${id}/rooms`, { token: fx.token });
    expect(legs.body[0].code).toBe('101');
  });

  it('refuses to confirm an inquiry once its room type has sold out', async () => {
    const fx = await ready({ roomQuantity: 1 });
    await openAndPrice(fx, OPEN_FROM, OPEN_TO, { roomsToSell: 1 });
    const inquiry = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'inquiry',
      guest: { name: 'Too late' },
      lines: [line(fx)],
    });
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Got it' },
      lines: [line(fx)],
    });
    const res = await request('POST', `/bookings/${inquiry.body.bookings[0].id}/confirm`, {
      token: fx.token,
      body: {},
    });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('insufficient_availability');
  });

  it('puts a booking on hold, releases it, and never un-confirms a confirmation', async () => {
    const fx = await ready();
    const confirmed = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Hold me' },
      lines: [line(fx)],
    });
    const id = confirmed.body.bookings[0].id;
    const until = new Date(Date.now() + 6 * 3_600_000).toISOString();
    expect(
      (
        await request('POST', `/bookings/${id}/hold`, {
          token: fx.token,
          body: { until, kind: 'hold_unconfirm' },
        })
      ).status,
    ).toBe(400);
    const held = await request('POST', `/bookings/${id}/hold`, {
      token: fx.token,
      body: { until },
    });
    expect(held.status).toBe(200);
    expect(held.body.reservationKind).toBe('hold_confirm');

    const released = await request('POST', `/bookings/${id}/release-hold`, {
      token: fx.token,
      body: { reason: 'Guest went elsewhere' },
    });
    expect(released.status).toBe(200);
    expect(released.body.status).toBe('Cancelled');
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(5);
  });

  it('confirms and cancels every room of a reservation together', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'hold_unconfirm',
      guest: { name: 'Wedding party' },
      lines: [line(fx), line(fx), line(fx)],
    });
    const groupId = res.body.groupId;
    const confirmed = await request('POST', `/reservations/${groupId}/confirm`, {
      token: fx.token,
      body: {},
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmed).toHaveLength(3);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(2);

    const cancelled = await request('POST', `/reservations/${groupId}/cancel`, {
      token: fx.token,
      body: { reason: 'Postponed' },
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancelled).toHaveLength(3);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(5);
  });
});

describe('the hold lifecycle sweep', () => {
  it('releases a hold at its release time, once, and tells the hotel', async () => {
    const fx = await ready();
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'hold_confirm',
      holdUntil: soon,
      guest: { name: 'Timed out' },
      lines: [line(fx)],
    });
    const id = res.body.bookings[0].id;
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);

    // Two hours on, the hold is due.
    const later = new Date(Date.now() + 2 * 3_600_000);
    expect(await dueLifecycleTenants(admin(), later)).toContain(fx.tenantId);
    const [a, b] = await Promise.all([
      withTenant(admin(), fx.tenantId, (tx) => sweepReservationLifecycle(tx, fx.tenantId, later)),
      withTenant(admin(), fx.tenantId, (tx) => sweepReservationLifecycle(tx, fx.tenantId, later)),
    ]);
    expect(a.released.length + b.released.length).toBe(1);

    const row = await detail(fx, id);
    expect(row.status).toBe('Cancelled');
    expect(row.trail.map((t: any) => t.action)).toContain('released');
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(5);
    const notes = await admin()
      .select()
      .from(notifications)
      .where(and(eq(notifications.tenantId, fx.tenantId), eq(notifications.type, 'hold_released')));
    expect(notes).toHaveLength(1);
  });

  it('reminds the hotel once inside the reminder window', async () => {
    const fx = await ready();
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'hold_confirm',
      holdUntil: new Date(Date.now() + 10 * 3_600_000).toISOString(),
      guest: { name: 'Remind me' },
      lines: [line(fx)],
    });
    // Default window: 6 hours before release.
    const early = new Date(Date.now() + 3 * 3_600_000);
    const inWindow = new Date(Date.now() + 5 * 3_600_000);
    const sweep = (at: Date) =>
      withTenant(admin(), fx.tenantId, (tx) => sweepReservationLifecycle(tx, fx.tenantId, at));
    expect((await sweep(early)).reminded).toBe(0);
    expect((await sweep(inWindow)).reminded).toBe(1);
    expect((await sweep(inWindow)).reminded).toBe(0);
  });

  it('cancels unconfirmed bookings after their arrival day only where the property asks', async () => {
    const fx = await ready();
    const inquiry = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'hold_unconfirm',
      holdUntil: null,
      guest: { name: 'Never confirmed' },
      lines: [line(fx)],
    });
    const afterArrival = new Date('2028-03-03T12:00:00Z');
    const sweep = () =>
      withTenant(admin(), fx.tenantId, (tx) =>
        sweepReservationLifecycle(tx, fx.tenantId, afterArrival),
      );
    expect((await sweep()).expired).toHaveLength(0);

    await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { unconfirmedPolicy: 'arrival_day_end' },
    });
    const r = await sweep();
    expect(r.expired.map((e) => e.id)).toEqual([inquiry.body.bookings[0].id]);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(5);
  });
});

describe('no-shows', () => {
  it('keep the missed night and give the rest of the stay back, telling an OTA', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: '2028-03-06', // 4 nights
      guest: { name: 'Did not come' },
      lines: [line(fx)],
    });
    const id = res.body.bookings[0].id;
    // Pretend it came from a channel, to check the channel is told.
    await admin().update(bookings).set({ source: 'OTA' }).where(eq(bookings.id, id));

    const ns = await request('POST', `/bookings/${id}/no-show`, { token: fx.token });
    expect(ns.status).toBe(200);
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
    for (const d of ['2028-03-03', '2028-03-04', '2028-03-05']) {
      expect(await roomsToSell(fx, fx.roomId, d), d).toBe(5);
    }
    const row = await detail(fx, id);
    expect(row.inventoryReleasedFrom).toBe('2028-03-03');
    const legs = await request('GET', `/bookings/${id}/rooms`, { token: fx.token });
    expect(legs.body[0].checkout).toBe('2028-03-03');

    const events = await admin()
      .select()
      .from(outbox)
      .where(and(eq(outbox.aggregateId, id), eq(outbox.eventType, 'booking.no_show')));
    expect(events).toHaveLength(1);

    // Re-opening the month does not resurrect or double-count anything.
    await openAndPrice(fx, OPEN_FROM, OPEN_TO, { roomsToSell: 5 });
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
    expect(await roomsToSell(fx, fx.roomId, '2028-03-04')).toBe(5);
  });
});

describe('price authority', () => {
  async function withLimit(limit: number, canComp = false) {
    const fx = await ready();
    const set = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { rateControl: { staffMaxDiscountPct: limit, staffCanComp: canComp } },
    });
    expect(set.status).toBe(200);
    return { fx, desk: await addDeskUser(fx) };
  }
  const stay = { checkin: CHECKIN, checkout: CHECKOUT };

  it('lets the desk discount within the limit, with a reason', async () => {
    const { fx, desk } = await withLimit(10);
    const body = {
      ...stay,
      guest: { name: 'Small discount' },
      lines: [line(fx, { rate: { mode: 'nightly', amount: 23000 } })],
    };
    const noReason = await reserve(fx, body, { token: desk.token });
    expect(noReason.status).toBe(400);
    expect(noReason.body.reason).toBe('price_reason_required');
    const ok = await reserve(fx, { ...body, priceReason: 'Repeat guest' }, { token: desk.token });
    expect(ok.status).toBe(201);
    expect(ok.body.total).toBe('69000.00');
  });

  it('needs an owner’s approval beyond the limit, and records who approved', async () => {
    const { fx, desk } = await withLimit(10);
    const body = {
      ...stay,
      guest: { name: 'Big discount' },
      priceReason: 'Long-stay corporate',
      lines: [line(fx, { rate: { mode: 'nightly', amount: 18000 } })],
    };
    const quote = await request('POST', '/reservations/quote', {
      token: desk.token,
      body: { propertyId: fx.propertyId, ...body },
    });
    expect(quote.body.approvalsRequired).toEqual(['rate_override']);

    const refused = await reserve(fx, body, { token: desk.token });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ reason: 'approval_required', actions: ['rate_override'] });

    const approval = await request('POST', '/auth/step-up', {
      token: desk.token,
      body: { email: fx.email, password: PASSWORD, action: 'rate_override' },
    });
    const ok = await reserve(
      fx,
      { ...body, approvals: { rate_override: approval.body.approvalToken } },
      { token: desk.token },
    );
    expect(ok.status).toBe(201);
    const row = await detail(fx, ok.body.bookings[0].id);
    expect(row.pricing.approvedBy.rate_override).toBe(fx.userId);
    expect(row.pricing.reason).toBe('Long-stay corporate');

    // The owner is never limited.
    const owner = await reserve(fx, { ...body, guest: { name: 'Owner deal' } });
    expect(owner.status).toBe(201);
  });

  it('gives complimentary rooms only when allowed, and zeroes their money', async () => {
    const { fx, desk } = await withLimit(0, false);
    const body = {
      ...stay,
      complimentary: true,
      priceReason: 'Travel writer',
      guest: { name: 'Comp' },
      lines: [line(fx)],
    };
    const refused = await reserve(fx, body, { token: desk.token });
    expect(refused.status).toBe(403);
    expect(refused.body.actions).toEqual(['complimentary']);

    await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { rateControl: { staffCanComp: true } },
    });
    const ok = await reserve(fx, body, { token: desk.token });
    expect(ok.status).toBe(201);
    const row = await detail(fx, ok.body.bookings[0].id);
    expect(row).toMatchObject({ amount: '0.00', taxes: '0.00', totalBasePrice: '0.00' });
    expect(row.days.every((d: any) => d.rateSource === 'complimentary')).toBe(true);
    // Still a room out of inventory.
    expect(await roomsToSell(fx, fx.roomId, CHECKIN)).toBe(4);
  });

  it('scales base and commission with an override, so the payout still adds up', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      ...stay,
      guest: { name: 'Half price' },
      priceReason: 'Staff family',
      lines: [line(fx, { rate: { mode: 'nightly', amount: 12195.13 } })],
    });
    expect(res.status).toBe(201);
    const row = await detail(fx, res.body.bookings[0].id);
    for (const d of row.days) {
      expect(d).toMatchObject({
        sellingPrice: '12195.13',
        listSellingPrice: LIST_NIGHT.toFixed(2),
        basePrice: '9000.00',
        commission: '1000.00',
        rateSource: 'override',
      });
    }
    const sum = (k: string) => row.days.reduce((s: number, d: any) => s + Number(d[k]), 0);
    expect(Number(row.amount)).toBeCloseTo(sum('sellingPrice'), 2);
    // The OTA's share — what is left after base and commission — is never negative.
    expect(
      Number(row.amount) - Number(row.taxes) - sum('basePrice') - sum('commission'),
    ).toBeGreaterThanOrEqual(0);
  });

  it('gives a standalone hotel the whole tax-exclusive price with no commission', async () => {
    const fx = await makeTenant({ distributionMode: 'standalone' });
    await openAndPrice(fx, OPEN_FROM, OPEN_TO, { base: 1000 });
    const res = await reserve(fx, {
      ...stay,
      guest: { name: 'Standalone' },
      priceReason: 'Negotiated',
      lines: [line(fx, { rate: { mode: 'nightly', amount: 800 } })],
    });
    const row = await detail(fx, res.body.bookings[0].id);
    expect(row.days[0]).toMatchObject({
      sellingPrice: '800.00',
      basePrice: '800.00',
      commission: '0.00',
    });
  });

  it('excuses a tax-exempt guest from exemptible taxes only', async () => {
    const fx = await ready({ taxed: true });
    // The harness inserts its taxes directly; a service charge is never exemptible.
    await admin()
      .update(taxTypes)
      .set({ exemptible: false })
      .where(and(eq(taxTypes.tenantId, fx.tenantId), eq(taxTypes.name, 'Service Charge')));
    const base = { ...stay, guest: { name: 'Embassy' }, lines: [line(fx)] };
    const listed = await reserve(fx, { ...base, guest: { name: 'Not exempt' } });
    const exempt = await reserve(fx, {
      ...base,
      taxExempt: { exemptionId: 'DIP-2028-114' },
      priceReason: 'Diplomatic mission',
    });
    expect(exempt.status).toBe(201);
    const a = await detail(fx, listed.body.bookings[0].id);
    const b = await detail(fx, exempt.body.bookings[0].id);
    const vat = a.days.reduce(
      (s: number, d: any) =>
        s +
        d.taxLines
          .filter((l: any) => l.name === 'VAT')
          .reduce((x: number, l: any) => x + l.amount, 0),
      0,
    );
    expect(Number(b.amount)).toBeCloseTo(Number(a.amount) - vat, 2);
    expect(b.days[0].taxLines.map((l: any) => l.name)).toEqual(['Service Charge']);
    expect(b.totalBasePrice).toBe(a.totalBasePrice);
    expect(b.commissionableAmount).toBe(a.commissionableAmount);
    expect(b.pricing.taxExempt.exemptionId).toBe('DIP-2028-114');
  });

  it('keeps agreed nights and prices added nights at the current rate', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      ...stay,
      guest: { name: 'Stays longer' },
      priceReason: 'Rate agreed by phone',
      lines: [line(fx, { rate: { mode: 'nightly', amount: 20000 } })],
    });
    const id = res.body.bookings[0].id;
    const amended = await request('PATCH', `/bookings/${id}`, {
      token: fx.token,
      body: { checkout: '2028-03-06' },
    });
    expect(amended.status).toBe(200);
    const row = await detail(fx, id);
    expect(row.days.slice(0, 3).map((d: any) => d.sellingPrice)).toEqual(Array(3).fill('20000.00'));
    expect(row.days[3].rateSource).toBe('calendar');
    expect(row.days[3].sellingPrice).not.toBe('20000.00');
    expect(amended.body.amount).toBe(
      row.days.reduce((total: number, day: any) => total + Number(day.sellingPrice), 0).toFixed(2),
    );
  });
});

describe('quote', () => {
  it('prices exactly what create stores, and refuses a total that moved', async () => {
    const fx = await ready({ taxed: true });
    const suite = await addRoomType(fx, { from: OPEN_FROM, to: OPEN_TO, base: 26000 });
    const body = {
      propertyId: fx.propertyId,
      ...{ checkin: CHECKIN, checkout: CHECKOUT },
      lines: [line(fx), line(suite)],
    };
    const q = await request('POST', '/reservations/quote', { token: fx.token, body });
    expect(q.status).toBe(200);
    expect(q.body.lines.every((l: any) => l.available)).toBe(true);
    expect(q.body.totals.taxLines.length).toBeGreaterThan(0);

    const wrong = await reserve(fx, {
      ...body,
      guest: { name: 'Quoted' },
      expectedTotal: Number(q.body.totals.due) + 1,
    });
    expect(wrong.status).toBe(409);
    expect(wrong.body.reason).toBe('price_changed');

    const ok = await reserve(fx, {
      ...body,
      guest: { name: 'Quoted' },
      expectedTotal: Number(q.body.totals.due),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.due).toBe(q.body.totals.due);
    expect(ok.body.bookings.map((b: any) => b.amount)).toEqual(
      q.body.lines.map((l: any) => l.amount),
    );
  });

  it('reports a sold-out room type instead of failing', async () => {
    const fx = await ready({ roomQuantity: 1 });
    await openAndPrice(fx, OPEN_FROM, OPEN_TO, { roomsToSell: 1 });
    const q = await request('POST', '/reservations/quote', {
      token: fx.token,
      body: {
        propertyId: fx.propertyId,
        checkin: CHECKIN,
        checkout: CHECKOUT,
        lines: [line(fx), line(fx)],
      },
    });
    expect(q.status).toBe(200);
    expect(q.body.lines[0]).toMatchObject({ free: 1, available: false });
  });
});

describe('contract rates', () => {
  it('prices a travel agent’s reservation from its contract, without approval', async () => {
    const fx = await ready();
    const desk = await addDeskUser(fx);
    const account = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { type: 'travel_agent', code: 'LTOURS', name: 'Lanka Tours' },
    });
    const rate = await request('POST', `/ledger-accounts/${account.body.id}/rates`, {
      token: fx.token,
      body: {
        propertyId: fx.propertyId,
        roomId: fx.roomId,
        validFrom: '2028-03-01',
        validTo: '2028-03-31',
        mode: 'fixed',
        value: 20000,
      },
    });
    expect(rate.status).toBe(201);
    // Only owners set contract rates.
    expect(
      (
        await request('POST', `/ledger-accounts/${account.body.id}/rates`, {
          token: desk.token,
          body: {
            propertyId: fx.propertyId,
            roomId: fx.roomId,
            validFrom: '2028-03-01',
            validTo: '2028-03-31',
            value: 1,
          },
        })
      ).status,
    ).toBe(403);

    const res = await reserve(
      fx,
      {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        ledgerAccountId: account.body.id,
        useContractRates: true,
        voucherNo: 'LT-88812',
        guest: { name: 'Tour guest' },
        lines: [line(fx)],
      },
      { token: desk.token },
    );
    expect(res.status).toBe(201);
    expect(res.body.total).toBe('60000.00');
    const row = await detail(fx, res.body.bookings[0].id);
    expect(row).toMatchObject({
      origin: 'travel_agent',
      voucherNo: 'LT-88812',
      ledgerAccountId: account.body.id,
    });
    expect(row.days.every((d: any) => d.rateSource === 'contract')).toBe(true);
  });

  it('is a Pro feature', async () => {
    const fx = await ready({ plan: 'starter' });
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      ledgerAccountId: '00000000-0000-4000-8000-000000000000',
      useContractRates: true,
      guest: { name: 'Starter' },
      lines: [line(fx)],
    });
    expect(res.status).toBe(403);
  });
});

describe('local and foreign rates', () => {
  it('sells a resident rate only to a local guest', async () => {
    const fx = await ready();
    const local = await addRoomType(fx, {
      name: 'Resident Double',
      audience: 'local',
      from: OPEN_FROM,
      to: OPEN_TO,
      base: 9000,
    });
    const base = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Resident' },
      lines: [line(local)],
    };
    const unknown = await reserve(fx, base);
    expect(unknown.status).toBe(400);
    expect(unknown.body.reason).toBe('rate_audience');
    expect((await reserve(fx, { ...base, residency: 'foreign' })).status).toBe(400);
    const ok = await reserve(fx, { ...base, residency: 'local' });
    expect(ok.status).toBe(201);
    expect((await detail(fx, ok.body.bookings[0].id)).residency).toBe('local');

    const grid = await request(
      'GET',
      `/properties/${fx.propertyId}/room-availability?checkin=${CHECKIN}&checkout=${CHECKOUT}&residency=foreign`,
      { token: fx.token },
    );
    const resident = grid.body.roomTypes.find((r: any) => r.roomId === local.roomId);
    expect(resident.rateTypes).toHaveLength(0);
    expect(resident.hiddenRateTypes).toBe(1);
  });
});

describe('room availability', () => {
  it('shows free counts, priced rate types and which rooms are free', async () => {
    const fx = await ready();
    const [r101, r102] = await addUnits(fx, fx.roomId, ['101', '102']);
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'In 101' },
      lines: [line(fx, { roomUnitId: r101 })],
    });
    const res = await request(
      'GET',
      `/properties/${fx.propertyId}/room-availability?checkin=${CHECKIN}&checkout=${CHECKOUT}`,
      { token: fx.token },
    );
    expect(res.status).toBe(200);
    const std = res.body.roomTypes.find((r: any) => r.roomId === fx.roomId);
    expect(std.free).toBe(4);
    expect(std.rateTypes[0]).toMatchObject({
      rateCode: 'BB',
      priced: true,
      total: (LIST_NIGHT * 3).toFixed(2),
    });
    expect(std.units.find((u: any) => u.id === r101).free).toBe(false);
    expect(std.units.find((u: any) => u.id === r102).free).toBe(true);
  });
});

describe('guest matching', () => {
  it('reuses a returning guest with the same name, and asks when the name differs', async () => {
    const fx = await ready();
    const base = { checkin: CHECKIN, checkout: CHECKOUT, lines: [line(fx)] };
    const first = await reserve(fx, {
      ...base,
      guest: { name: 'Kumari Silva', email: 'kumari@example.lk' },
    });
    const again = await reserve(fx, {
      ...base,
      guest: { name: 'kumari  silva', email: 'KUMARI@example.lk' },
    });
    expect(again.body.guest).toMatchObject({ id: first.body.guest.id, created: false });

    const clash = await reserve(fx, {
      ...base,
      guest: { name: 'Someone Else', email: 'kumari@example.lk' },
    });
    expect(clash.status).toBe(409);
    expect(clash.body.reason).toBe('guest_exists');
    expect(clash.body.candidates[0].id).toBe(first.body.guest.id);

    const forced = await reserve(fx, {
      ...base,
      guest: { name: 'Someone Else', email: 'kumari@example.lk', createNew: true },
    });
    expect(forced.status).toBe(201);
    expect(forced.body.guest.created).toBe(true);
  });
});

describe('dashboard and stay view', () => {
  it('splits pending by kind and draws inquiries in their own lane', async () => {
    const fx = await ready();
    for (const kind of ['inquiry', 'hold_unconfirm', 'inquiry']) {
      await reserve(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        kind,
        guest: { name: kind },
        lines: [line(fx)],
      });
    }
    const dash = await request('GET', `/dashboard?date=${CHECKIN}&propertyId=${fx.propertyId}`, {
      token: fx.token,
    });
    expect(dash.body.pendingByKind).toMatchObject({ inquiry: 2, hold_unconfirm: 1 });

    const sv = await request(
      'GET',
      `/stayview?propertyId=${fx.propertyId}&from=${CHECKIN}&to=${CHECKOUT}`,
      { token: fx.token },
    );
    expect(sv.status).toBe(200);
    expect(sv.body.tentative).toHaveLength(2);
    expect(sv.body.footer[0].soldRooms).toBe(1);
  });
});

describe('the audit trail', () => {
  it('records who created each room of a reservation', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Trail' },
      lines: [line(fx), line(fx)],
    });
    const ids = res.body.bookings.map((b: any) => b.id);
    const trail = await admin()
      .select()
      .from(bookingApprovals)
      .where(inArray(bookingApprovals.bookingId, ids));
    expect(trail).toHaveLength(2);
    expect(trail.every((t) => t.action === 'created' && t.actorUserId === fx.userId)).toBe(true);
    const rows = await admin().select().from(bookings).where(inArray(bookings.id, ids));
    expect(rows.every((r) => r.createdByUserId === fx.userId)).toBe(true);
  });
});

describe('the owner brief of 2026-09-26', () => {
  it('flags every room of a VIP reservation, and the desk can clear it', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      vip: true,
      guest: { name: 'Honeymoon Couple' },
      lines: [line(fx), line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const ids: string[] = res.body.bookings.map((b: { id: string }) => b.id);
    for (const id of ids) expect((await detail(fx, id)).isVip).toBe(true);

    // The list crowns the stay, and says it is the stay (not the guest's profile) that is VIP.
    const list = await request(
      'GET',
      `/reservations?propertyId=${fx.propertyId}&date=${CHECKIN}&tab=upcoming`,
      { token: fx.token },
    );
    const rows = list.body.rows.filter((r: { id: string }) => ids.includes(r.id));
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ vip: true, vipStay: true });

    const off = await request('POST', `/bookings/${ids[0]}/vip`, {
      token: fx.token,
      body: { vip: false },
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body).toEqual({ vip: false, bookings: 2 });
    for (const id of ids) expect((await detail(fx, id)).isVip).toBe(false);

    // Each change is on its stay's record, once.
    const trail = await admin()
      .select()
      .from(bookingApprovals)
      .where(inArray(bookingApprovals.bookingId, ids));
    expect(trail.filter((t) => t.reason === 'VIP removed')).toHaveLength(2);
    const again = await request('POST', `/bookings/${ids[1]}/vip`, {
      token: fx.token,
      body: { vip: false },
    });
    expect(again.status).toBe(200);
    const trailAfter = await admin()
      .select()
      .from(bookingApprovals)
      .where(inArray(bookingApprovals.bookingId, ids));
    expect(trailAfter.filter((t) => t.reason === 'VIP removed')).toHaveLength(2);
  });

  it('keeps the room of a failed online booking until the desk sorts it out', async () => {
    const fx = await ready();
    const before = await roomsToSell(fx, fx.roomId, CHECKIN);
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'online_failed',
      guest: { name: 'Website Guest' },
      lines: [line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('Pending');
    expect(before - (await roomsToSell(fx, fx.roomId, CHECKIN))).toBe(1);
    const id = res.body.bookings[0].id;

    // Confirming it takes nothing more: the room was already kept.
    const confirmed = await request('POST', `/bookings/${id}/confirm`, {
      token: fx.token,
      body: {},
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(before - (await roomsToSell(fx, fx.roomId, CHECKIN))).toBe(1);

    // A second one, cancelled, gives its room back.
    const other = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      kind: 'online_failed',
      guest: { name: 'Second Website Guest' },
      lines: [line(fx)],
    });
    expect(before - (await roomsToSell(fx, fx.roomId, CHECKIN))).toBe(2);
    const cancelled = await request('POST', `/bookings/${other.body.bookings[0].id}/cancel`, {
      token: fx.token,
      body: { reason: 'The guest booked elsewhere' },
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(before - (await roomsToSell(fx, fx.roomId, CHECKIN))).toBe(1);
  });

  it('offers Social Media as a direct business source', async () => {
    const fx = await ready();
    const cfg = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    const social = cfg.body.businessSources.find(
      (s: { shortCode: string }) => s.shortCode === 'SOC',
    );
    expect(social).toMatchObject({ name: 'Social Media', category: 'direct' });

    // A booking from it lands with that source.
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      businessSourceId: social.id,
      guest: { name: 'Instagram Guest' },
      lines: [line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect((await detail(fx, res.body.bookings[0].id)).businessSourceId).toBe(social.id);
  });
});
