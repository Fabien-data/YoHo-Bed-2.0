import { describe, it, expect, afterAll } from 'vitest';
import { makeTenant, request, openAndPrice, book, stopApp, type TenantFixture } from './harness';

afterAll(stopApp);

function folio(fx: TenantFixture, bookingId: string) {
  return request('GET', `/bookings/${bookingId}/folio`, { token: fx.token });
}

function postRoomCharges(fx: TenantFixture, bookingId: string) {
  return request('POST', `/bookings/${bookingId}/folio/post-room-charges`, { token: fx.token });
}

describe('room charges', () => {
  /**
   * The load-bearing guarantee of this sprint: the bill reproduces the reservation exactly.
   *
   * Room charges are copied from the `booking_days` snapshot rather than recomputed, so if this
   * ever drifts, the folio and settlement have started telling two different stories about the
   * same stay.
   */
  it('sums to the booking amount, to the cent', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2031-01-01', '2031-01-31', { roomsToSell: 4 });
    const created = await book(fx, { checkin: '2031-01-10', checkout: '2031-01-14' });

    const posted = await postRoomCharges(fx, created.body.id);
    expect(posted.status).toBe(200);
    expect(posted.body.posted).toBe(4); // four nights

    const res = await folio(fx, created.body.id);
    expect(res.status).toBe(200);
    expect(Number(res.body.totals.charges)).toBeCloseTo(Number(created.body.amount), 2);
    expect(res.body.totals.charges).toBe(res.body.bookingAmount);
  });

  it('multiplies by the room count — the snapshot is per room, per night', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, '2031-02-01', '2031-02-28', { roomsToSell: 6 });
    const created = await book(fx, { checkin: '2031-02-10', checkout: '2031-02-13', rooms: 3 });

    await postRoomCharges(fx, created.body.id);
    const res = await folio(fx, created.body.id);

    expect(res.body.windows[0].lines).toHaveLength(3); // three nights, not nine lines
    expect(res.body.totals.charges).toBe(created.body.amount);
    expect(res.body.windows[0].lines[0].quantity).toBe('3.00');
  });

  it('carries the tax the money engine already decomposed', async () => {
    // The taxed demo property: slab commission + 10% service charge + 15% VAT.
    const fx = await makeTenant({ roomQuantity: 3, taxed: true });
    await openAndPrice(fx, '2031-03-01', '2031-03-28', { roomsToSell: 3 });
    const created = await book(fx, { checkin: '2031-03-10', checkout: '2031-03-12' });

    await postRoomCharges(fx, created.body.id);
    const res = await folio(fx, created.body.id);

    expect(Number(res.body.windows[0].totals.tax)).toBeCloseTo(Number(created.body.taxes), 2);
    // net + tax = total, on every line.
    for (const l of res.body.windows[0].lines) {
      expect(Number(l.net) + Number(l.tax)).toBeCloseTo(Number(l.total), 2);
    }
  });

  it('cannot double-charge: posting twice is a no-op', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, '2031-04-01', '2031-04-28', { roomsToSell: 3 });
    const created = await book(fx, { checkin: '2031-04-10', checkout: '2031-04-13' });

    const first = await postRoomCharges(fx, created.body.id);
    expect(first.body.posted).toBe(3);

    const second = await postRoomCharges(fx, created.body.id);
    expect(second.body.posted).toBe(0);
    expect(second.body.skipped).toBe(3);

    const res = await folio(fx, created.body.id);
    expect(res.body.totals.charges).toBe(created.body.amount);
  });

  it('refuses to bill a cancelled reservation', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, '2031-05-01', '2031-05-28', { roomsToSell: 3 });
    const created = await book(fx, { checkin: '2031-05-10', checkout: '2031-05-12' });
    await request('POST', `/bookings/${created.body.id}/cancel`, { token: fx.token });

    const res = await postRoomCharges(fx, created.body.id);
    expect(res.status).toBe(400);
  });
});

describe('extras and voids', () => {
  async function stay(fx: TenantFixture) {
    await openAndPrice(fx, '2031-06-01', '2031-06-28', { roomsToSell: 4 });
    const created = await book(fx, { checkin: '2031-06-10', checkout: '2031-06-12' });
    await postRoomCharges(fx, created.body.id);
    const f = await folio(fx, created.body.id);
    return { bookingId: created.body.id, folioId: f.body.windows[0].id, booking: created.body };
  }

  it('posts a tax-inclusive extra and decomposes the tax out of the price', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const { folioId } = await stay(fx);

    const res = await request('POST', `/folios/${folioId}/charges`, {
      token: fx.token,
      body: { description: 'Minibar', unitPrice: 1150, quantity: 1, taxRatePct: 15 },
    });
    expect(res.status).toBe(201);
    // 1150 inclusive of 15% => net 1000, tax 150.
    expect(Number(res.body.total)).toBeCloseTo(1150, 2);
    expect(Number(res.body.net)).toBeCloseTo(1000, 2);
    expect(Number(res.body.tax)).toBeCloseTo(150, 2);
  });

  it('adds tax on top when the price is exclusive', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const { folioId } = await stay(fx);

    const res = await request('POST', `/folios/${folioId}/charges`, {
      token: fx.token,
      body: {
        description: 'Airport transfer',
        unitPrice: 1000,
        quantity: 2,
        taxRatePct: 15,
        taxInclusive: false,
      },
    });
    expect(Number(res.body.net)).toBeCloseTo(2000, 2);
    expect(Number(res.body.tax)).toBeCloseTo(300, 2);
    expect(Number(res.body.total)).toBeCloseTo(2300, 2);
  });

  it('prices an extra from the catalogue, and lets the desk override it', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const { folioId } = await stay(fx);

    const particular = await request('POST', '/charge-particulars', {
      token: fx.token,
      body: {
        code: 'LAUNDRY',
        name: 'Laundry',
        category: 'service',
        defaultPrice: 500,
        taxRatePct: 0,
      },
    });
    expect(particular.status).toBe(201);

    const fromCatalogue = await request('POST', `/folios/${folioId}/charges`, {
      token: fx.token,
      body: { particularId: particular.body.id, quantity: 2 },
    });
    expect(fromCatalogue.body.description).toBe('Laundry');
    expect(Number(fromCatalogue.body.total)).toBeCloseTo(1000, 2);

    const overridden = await request('POST', `/folios/${folioId}/charges`, {
      token: fx.token,
      body: { particularId: particular.body.id, unitPrice: 750, quantity: 1 },
    });
    expect(Number(overridden.body.total)).toBeCloseTo(750, 2);
  });

  it('refuses a duplicate particular code', async () => {
    const fx = await makeTenant();
    const body = { code: 'SPA', name: 'Spa', defaultPrice: 100 };
    await request('POST', '/charge-particulars', { token: fx.token, body });
    const dup = await request('POST', '/charge-particulars', { token: fx.token, body });
    expect(dup.status).toBe(409);
  });

  it('keeps a voided line on the bill but takes its money off', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const { bookingId, folioId, booking } = await stay(fx);

    const extra = await request('POST', `/folios/${folioId}/charges`, {
      token: fx.token,
      body: { description: 'Mistake', unitPrice: 5000, quantity: 1 },
    });

    const withExtra = await folio(fx, bookingId);
    expect(Number(withExtra.body.totals.charges)).toBeCloseTo(Number(booking.amount) + 5000, 2);

    const voided = await request('POST', `/folio-charges/${extra.body.id}/void`, {
      token: fx.token,
      body: { reason: 'Posted to the wrong room' },
    });
    expect(voided.status).toBe(200);

    const after = await folio(fx, bookingId);
    // Back to the room total, but the line is still visible with its reason.
    expect(after.body.totals.charges).toBe(booking.amount);
    const line = after.body.windows[0].lines.find((l: any) => l.id === extra.body.id);
    expect(line.voidedAt).not.toBeNull();
    expect(line.voidReason).toBe('Posted to the wrong room');
  });

  it('refuses to void the same line twice', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    const { folioId } = await stay(fx);
    const extra = await request('POST', `/folios/${folioId}/charges`, {
      token: fx.token,
      body: { description: 'Oops', unitPrice: 100, quantity: 1 },
    });
    const reason = { reason: 'Posted twice' };
    await request('POST', `/folio-charges/${extra.body.id}/void`, {
      token: fx.token,
      body: reason,
    });
    const again = await request('POST', `/folio-charges/${extra.body.id}/void`, {
      token: fx.token,
      body: reason,
    });
    expect(again.status).toBe(409);
  });
});

describe('splitting the bill', () => {
  it('moves a charge to a second window and records why', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2031-07-01', '2031-07-28', { roomsToSell: 4 });
    const created = await book(fx, { checkin: '2031-07-10', checkout: '2031-07-12' });
    await postRoomCharges(fx, created.body.id);

    const before = await folio(fx, created.body.id);
    const guestWindow = before.body.windows[0];

    const company = await request('POST', `/bookings/${created.body.id}/folio/windows`, {
      token: fx.token,
      body: { label: 'Company' },
    });
    expect(company.status).toBe(201);
    expect(company.body.window).toBe(2);

    const moved = await request('POST', '/folio-charges/transfer', {
      token: fx.token,
      body: {
        chargeIds: [guestWindow.lines[0].id],
        toFolioId: company.body.id,
        reason: 'Company settles the room',
      },
    });
    expect(moved.status).toBe(200);
    expect(moved.body.lines).toHaveLength(1);

    const after = await folio(fx, created.body.id);
    expect(after.body.windows[0].lines).toHaveLength(1);
    expect(after.body.windows[1].lines).toHaveLength(1);
    // The bill as a whole is unchanged — splitting moves money, it does not create or destroy it.
    expect(after.body.totals.charges).toBe(before.body.totals.charges);
  });

  it('refuses to move a charge into another booking’s window', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2031-08-01', '2031-08-28', { roomsToSell: 4 });
    const a = await book(fx, { checkin: '2031-08-10', checkout: '2031-08-12' });
    const b = await book(fx, { checkin: '2031-08-10', checkout: '2031-08-12' });
    await postRoomCharges(fx, a.body.id);

    const fa = await folio(fx, a.body.id);
    const fb = await folio(fx, b.body.id);

    const res = await request('POST', '/folio-charges/transfer', {
      token: fx.token,
      body: { chargeIds: [fa.body.windows[0].lines[0].id], toFolioId: fb.body.windows[0].id },
    });
    expect(res.status).toBe(400);
  });
});

describe('settlement', () => {
  it('takes a payment and clears the balance', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2031-09-01', '2031-09-28', { roomsToSell: 4 });
    const created = await book(fx, { checkin: '2031-09-10', checkout: '2031-09-12' });
    await postRoomCharges(fx, created.body.id);

    const before = await folio(fx, created.body.id);
    const w = before.body.windows[0];
    expect(Number(w.totals.balance)).toBeGreaterThan(0);

    const paid = await request('POST', `/folios/${w.id}/payments`, {
      token: fx.token,
      body: { amount: Number(w.totals.balance), method: 'card', reference: 'VISA-1234' },
    });
    expect(paid.status).toBe(201);

    const after = await folio(fx, created.body.id);
    expect(Number(after.body.totals.balance)).toBe(0);
    expect(after.body.windows[0].payments[0].reference).toBe('VISA-1234');
  });

  it('refuses to close a window that still owes money, unless told to', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2031-10-01', '2031-10-28', { roomsToSell: 4 });
    const created = await book(fx, { checkin: '2031-10-10', checkout: '2031-10-12' });
    await postRoomCharges(fx, created.body.id);
    const f = await folio(fx, created.body.id);
    const windowId = f.body.windows[0].id;

    const refused = await request('POST', `/folios/${windowId}/close`, { token: fx.token });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/balance/i);

    const forced = await request('POST', `/folios/${windowId}/close?force=true`, {
      token: fx.token,
    });
    expect(forced.status).toBe(200);
    expect(forced.body.status).toBe('closed');

    // A closed window is frozen.
    const posting = await request('POST', `/folios/${windowId}/charges`, {
      token: fx.token,
      body: { description: 'Too late', unitPrice: 10, quantity: 1 },
    });
    expect(posting.status).toBe(400);
  });

  it('lists the stays that still owe money, in-house first', async () => {
    const fx = await makeTenant({ roomQuantity: 6 });
    await openAndPrice(fx, '2031-11-01', '2031-11-28', { roomsToSell: 6 });

    const owing = await book(fx, {
      customerName: 'Owes Money',
      checkin: '2031-11-10',
      checkout: '2031-11-12',
    });
    await postRoomCharges(fx, owing.body.id);

    const settled = await book(fx, {
      customerName: 'Paid Up',
      checkin: '2031-11-10',
      checkout: '2031-11-12',
    });
    await postRoomCharges(fx, settled.body.id);
    const sf = await folio(fx, settled.body.id);
    await request('POST', `/folios/${sf.body.windows[0].id}/payments`, {
      token: fx.token,
      body: { amount: Number(sf.body.windows[0].totals.balance), method: 'cash' },
    });

    const res = await request('GET', `/folios/unsettled?propertyId=${fx.propertyId}`, {
      token: fx.token,
    });
    expect(res.status).toBe(200);
    const names = res.body.map((r: any) => r.guestName);
    expect(names).toContain('Owes Money');
    expect(names).not.toContain('Paid Up');
  });
});

describe('folio entitlement', () => {
  it('is withheld from Starter but not from Pro', async () => {
    const starter = await makeTenant({ plan: 'starter' });
    const denied = await request('GET', `/folios/unsettled?propertyId=${starter.propertyId}`, {
      token: starter.token,
    });
    expect(denied.status).toBe(403);

    const pro = await makeTenant({ plan: 'pro' });
    const allowed = await request('GET', `/folios/unsettled?propertyId=${pro.propertyId}`, {
      token: pro.token,
    });
    expect(allowed.status).toBe(200);
  });
});
