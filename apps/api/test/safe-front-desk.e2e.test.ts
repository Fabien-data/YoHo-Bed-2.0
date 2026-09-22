import { describe, it, expect, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bookingApprovals, folioCharges } from '@yohobed/db';
import {
  addDeskUser,
  admin,
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
 * UX Excellence Program, UX-1a — the safe front desk (docs/UX-STANDARD.md §4). The server refuses
 * what would hurt the hotel or the guest, says what to do instead, and lets the desk recover
 * from its own mistakes — every recovery on the record.
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

async function legsOf(fx: TenantFixture, bookingId: string) {
  return (await request('GET', `/bookings/${bookingId}/rooms`, { token: fx.token })).body as Array<{
    id: string;
    roomUnitId: string | null;
  }>;
}

async function assign(fx: TenantFixture, bookingId: string, unitId: string) {
  const legs = await legsOf(fx, bookingId);
  const res = await request('POST', `/bookings/${bookingId}/assign`, {
    token: fx.token,
    body: { assignments: [{ legId: legs[0]!.id, roomUnitId: unitId }] },
  });
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
}

function setHousekeeping(fx: TenantFixture, unitId: string, date: string, status: string) {
  return request('POST', `/properties/${fx.propertyId}/housekeeping`, {
    token: fx.token,
    body: { roomUnitId: unitId, date, status },
  });
}

/** A confirmed stay arriving today (or at `offset`), `nights` long. */
async function arrival(fx: TenantFixture, nights = 2, offset = 0) {
  const b = await book(fx, { checkin: hotelToday(offset), checkout: hotelToday(offset + nights) });
  expect(b.status, JSON.stringify(b.body)).toBe(201);
  await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token });
  return b.body as { id: string; reference: string; amount: string; customerId: string };
}

const act = (fx: TenantFixture, id: string, what: string, body?: unknown, token = fx.token) =>
  request('POST', `/bookings/${id}/${what}`, { token, body });

async function roomsToSell(fx: TenantFixture, date: string): Promise<number> {
  const res = await request('GET', `/rooms/${fx.roomId}/availability?from=${date}&to=${date}`, {
    token: fx.token,
  });
  return res.body[0].roomsToSell;
}

describe('check-in guards', () => {
  it('refuses a guest before their arrival day, and says what to do', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx, 2, 3);
    const res = await act(fx, b.id, 'check-in');
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('not_arrival_day');
    expect(res.body.message).toMatch(/change the stay to start today/i);
  });

  it('gives the guest a clean room before a dirty one with a lower number', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    const [u1, u2] = await makeUnits(fx, 2);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    // Room 01 was left dirty yesterday: it is still dirty today until someone cleans it.
    await setHousekeeping(fx, u1!, hotelToday(-1), 'dirty');

    const b = await arrival(fx);
    const res = await act(fx, b.id, 'check-in');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await legsOf(fx, b.id))[0]!.roomUnitId).toBe(u2);
  });

  it('refuses a dirty room unless the desk overrides it with a reason — on the record', async () => {
    const fx = await makeTenant({ roomQuantity: 1 });
    const [u1] = await makeUnits(fx, 1);
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 1 });
    await setHousekeeping(fx, u1!, hotelToday(), 'dirty');
    const b = await arrival(fx);
    await assign(fx, b.id, u1!);

    const refused = await act(fx, b.id, 'check-in');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: 'room_dirty', rooms: ['01'] });

    const noReason = await act(fx, b.id, 'check-in', { overrideDirty: true });
    expect(noReason.status).toBe(400);
    expect(noReason.body.message).toMatch(/Reason: Say why/);

    const ok = await act(fx, b.id, 'check-in', {
      overrideDirty: true,
      reason: 'Guest asked to drop bags now',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const [row] = await admin()
      .select()
      .from(bookingApprovals)
      .where(and(eq(bookingApprovals.bookingId, b.id), eq(bookingApprovals.action, 'checked_in')));
    expect(row).toMatchObject({ reason: 'Guest asked to drop bags now', actorUserId: fx.userId });
    expect(row!.ip).toBeTruthy();
  });

  it('refuses when every numbered room of the type is taken', async () => {
    const fx = await makeTenant({ roomQuantity: 2 });
    await makeUnits(fx, 1); // two sold, only one physical room
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 2 });
    const first = await arrival(fx);
    const second = await arrival(fx);
    expect((await act(fx, first.id, 'check-in')).status).toBe(200);
    const res = await act(fx, second.id, 'check-in');
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('room_not_assigned');
  });

  it('enforces "record the ID before check-in" when the hotel asks for it', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { requireDocumentsAtCheckin: true },
    });
    const b = await arrival(fx);
    const refused = await act(fx, b.id, 'check-in');
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('documents_required');

    const doc = await request('POST', `/customers/${b.customerId}/documents`, {
      token: fx.token,
      body: { type: 'passport', number: 'N1234567' },
    });
    expect(doc.status, JSON.stringify(doc.body)).toBeLessThan(300);
    expect((await act(fx, b.id, 'check-in')).status).toBe(200);
  });
});

describe('check-out guards', () => {
  it('refuses to let a guest leave owing money, and says how much', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    await act(fx, b.id, 'check-in');

    const res = await act(fx, b.id, 'check-out');
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('balance_open');
    expect(Number(res.body.balance)).toBeCloseTo(Number(b.amount), 2);

    // Nothing moved: still in house.
    expect((await request('GET', `/bookings/${b.id}`, { token: fx.token })).body.status).toBe(
      'CheckedIn',
    );

    await payInFull(fx, b.id);
    expect((await act(fx, b.id, 'check-out')).status).toBe(200);
  });

  it('lets only the owner check out with a balance, and only with a reason', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const desk = await addDeskUser(fx);
    const b = await arrival(fx);
    await act(fx, b.id, 'check-in');

    const byDesk = await act(
      fx,
      b.id,
      'check-out',
      { allowBalance: true, reason: 'Company will pay' },
      desk.token,
    );
    expect(byDesk.status).toBe(403);

    const byOwner = await act(fx, b.id, 'check-out', {
      allowBalance: true,
      reason: 'Company will pay by transfer',
    });
    expect(byOwner.status, JSON.stringify(byOwner.body)).toBe(200);
  });

  it('follows a hotel that chose to allow check-out with a balance', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { checkoutBalancePolicy: 'allow' },
    });
    const b = await arrival(fx);
    await act(fx, b.id, 'check-in');
    expect((await act(fx, b.id, 'check-out')).status).toBe(200);
  });

  it('gives the nights a guest did not stay back for sale when they leave early', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 3 });
    const b = await arrival(fx, 4);
    await act(fx, b.id, 'check-in');
    await payInFull(fx, b.id);
    expect(await roomsToSell(fx, hotelToday(1))).toBe(2);

    expect((await act(fx, b.id, 'check-out')).status).toBe(200);
    // Tonight and the rest are back on sale.
    expect(await roomsToSell(fx, hotelToday())).toBe(3);
    expect(await roomsToSell(fx, hotelToday(1))).toBe(3);
  });
});

describe('recovering from mistakes', () => {
  it('undoes a check-in the same day, until a night has been charged', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    await act(fx, b.id, 'check-in');

    const noReason = await act(fx, b.id, 'undo-check-in', {});
    expect(noReason.status).toBe(400);

    const undone = await act(fx, b.id, 'undo-check-in', { reason: 'Checked in the wrong guest' });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.status).toBe('Approved');

    // Again, but this time a night is charged before the desk notices.
    await act(fx, b.id, 'check-in');
    await request('POST', `/bookings/${b.id}/folio/post-room-charges`, { token: fx.token });
    const late = await act(fx, b.id, 'undo-check-in', { reason: 'Wrong guest' });
    expect(late.status).toBe(409);
    expect(late.body.reason).toBe('charges_posted');
  });

  it('undoes an early check-out and takes the released nights back', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 3 });
    const b = await arrival(fx, 4);
    await act(fx, b.id, 'check-in');
    await payInFull(fx, b.id);
    await act(fx, b.id, 'check-out');
    expect(await roomsToSell(fx, hotelToday(2))).toBe(3);

    const undone = await act(fx, b.id, 'undo-check-out', { reason: 'Guest is staying after all' });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.status).toBe('CheckedIn');
    expect(await roomsToSell(fx, hotelToday(2))).toBe(2);
  });

  it('reinstates a no-show who arrives after the night audit', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 3 });
    const b = await arrival(fx, 3);
    await request('POST', `/properties/${fx.propertyId}/night-audit/run`, { token: fx.token });
    expect((await request('GET', `/bookings/${b.id}`, { token: fx.token })).body.status).toBe(
      'NoShow',
    );
    // The audit gave the later nights back for sale.
    expect(await roomsToSell(fx, hotelToday(1))).toBe(3);

    // The late guest walks in. Checking in says what to do.
    const blocked = await act(fx, b.id, 'check-in');
    expect(blocked.status).toBe(409);
    expect(blocked.body.reason).toBe('no_show');

    const back = await act(fx, b.id, 'reinstate', { reason: 'Flight delayed, arrived 1am' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.status).toBe('Approved');
    expect(await roomsToSell(fx, hotelToday(1))).toBe(2);
    expect((await act(fx, b.id, 'check-in')).status).toBe(200);
  });

  it('reinstates a cancellation while the room is still free, and refuses once it is sold', async () => {
    const fx = await makeTenant({ roomQuantity: 1 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 1 });
    const b = await arrival(fx, 2, 1);
    await act(fx, b.id, 'cancel', { reason: 'Guest called to cancel' });
    expect(await roomsToSell(fx, hotelToday(1))).toBe(1);

    const back = await act(fx, b.id, 'reinstate', { reason: 'Cancelled the wrong booking' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(await roomsToSell(fx, hotelToday(1))).toBe(0);

    // Cancel again, sell the room to someone else, and the way back is closed.
    await act(fx, b.id, 'cancel');
    await arrival(fx, 2, 1);
    const sold = await act(fx, b.id, 'reinstate', { reason: 'Too late' });
    expect(sold.status).toBe(409);
    expect(sold.body.reason).toBe('insufficient_availability');
  });
});

describe('housekeeping carries forward', () => {
  it('keeps a room dirty until someone cleans it', async () => {
    const fx = await makeTenant({ roomQuantity: 1 });
    const [u1] = await makeUnits(fx, 1);
    await setHousekeeping(fx, u1!, hotelToday(-2), 'dirty');

    const view = (date: string) =>
      request('GET', `/room-view?propertyId=${fx.propertyId}&date=${date}`, { token: fx.token });
    expect((await view(hotelToday())).body[0].housekeeping).toBe('dirty');

    await setHousekeeping(fx, u1!, hotelToday(), 'clean');
    expect((await view(hotelToday())).body[0].housekeeping).toBe('clean');
    expect((await view(hotelToday(1))).body[0].housekeeping).toBe('clean');
    // History is untouched: two days ago it was dirty.
    expect((await view(hotelToday(-2))).body[0].housekeeping).toBe('dirty');
  });
});

describe('night audit', () => {
  it("is the owner's to run", async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const res = await request('POST', `/properties/${fx.propertyId}/night-audit/run`, {
      token: desk.token,
    });
    expect(res.status).toBe(403);
    // The preview stays open to the desk.
    const preview = await request('GET', `/properties/${fx.propertyId}/night-audit/preview`, {
      token: desk.token,
    });
    expect(preview.status).toBe(200);
  });

  it('lists what is unresolved, and keeps a late arrival the desk still expects', async () => {
    const fx = await makeTenant({ roomQuantity: 3 });
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 3 });
    const late = await arrival(fx, 2);
    const gone = await arrival(fx, 2);
    const drawer = await request('POST', `/properties/${fx.propertyId}/drawers`, {
      token: fx.token,
      body: { name: 'Front desk' },
    });
    await request('POST', `/drawers/${drawer.body.id}/open`, {
      token: fx.token,
      body: { openingFloat: 1000 },
    });

    const preview = await request('GET', `/properties/${fx.propertyId}/night-audit/preview`, {
      token: fx.token,
    });
    expect(preview.body.unarrived.map((u: { id: string }) => u.id).sort()).toEqual(
      [late.id, gone.id].sort(),
    );
    expect(preview.body.openTills).toHaveLength(1);
    expect(preview.body.openTills[0].drawer).toBe('Front desk');

    const run = await request('POST', `/properties/${fx.propertyId}/night-audit/run`, {
      token: fx.token,
      body: { keep: [late.id] },
    });
    expect(run.status, JSON.stringify(run.body)).toBe(201);
    expect(run.body.noShows).toBe(1);
    expect(run.body.summary.keptAsLateArrivals).toEqual([late.reference]);
    expect(run.body.summary.tillsClosedUncounted).toBe(1);

    const status = async (id: string) =>
      (await request('GET', `/bookings/${id}`, { token: fx.token })).body.status;
    expect(await status(late.id)).toBe('Approved');
    expect(await status(gone.id)).toBe('NoShow');
  });
});

describe('the record', () => {
  it('records who voided a folio charge', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, hotelToday(), hotelToday(10));
    const b = await arrival(fx);
    const folio = await request('GET', `/bookings/${b.id}/folio`, { token: fx.token });
    const charge = await request('POST', `/folios/${folio.body.windows[0].id}/charges`, {
      token: fx.token,
      body: { description: 'Minibar', unitPrice: 1200, quantity: 1 },
    });
    expect(charge.status, JSON.stringify(charge.body)).toBe(201);
    const voided = await request('POST', `/folio-charges/${charge.body.id}/void`, {
      token: fx.token,
      body: { reason: 'Rang up the wrong room' },
    });
    expect(voided.status).toBe(200);
    const [row] = await admin()
      .select()
      .from(folioCharges)
      .where(eq(folioCharges.id, charge.body.id));
    expect(row).toMatchObject({ voidReason: 'Rang up the wrong room', voidedByUserId: fx.userId });
  });

  it('says what is wrong with a refused form, field by field', async () => {
    const fx = await makeTenant();
    const res = await request('POST', '/bookings', { token: fx.token, body: { checkin: 'soon' } });
    expect(res.status).toBe(400);
    expect(res.body.message).not.toBe('Validation failed');
    // The first few problems, each named by its field, plus how many more there are.
    expect(res.body.message).toMatch(/^Room id: Required\. Occupancy id: Required/);
    expect(res.body.message).toMatch(/\(and \d+ more\)$/);
    expect(res.body.errors.fieldErrors).toBeTruthy();
  });
});
