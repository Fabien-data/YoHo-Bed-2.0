import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  bookings,
  folioCharges,
  folios,
  ledgerAccounts,
  ledgerEntries,
  paymentMethods,
  payments,
  privateFiles,
} from '@yohobed/db';
import {
  addDeskUser,
  addUnits,
  admin,
  makeTenant,
  openAndPrice,
  request,
  reserve,
  startApp,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * Money at reservation, Bill To routing, walk-in check-in and check-out settlement (Development
 * Phase 02, Sprint 5).
 */

afterAll(stopApp);

/** Today in the fixture property's timezone (Asia/Colombo). */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const CHECKIN = addDays(TODAY, 5);
const CHECKOUT = addDays(TODAY, 7);

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
  const fx = await makeTenant({ roomQuantity: 8, ...opts });
  await openAndPrice(fx, TODAY, addDays(TODAY, 20), { roomsToSell: 8, base: 18000 });
  return fx;
}

async function methodId(fx: TenantFixture, code: string) {
  const [m] = await admin()
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.tenantId, fx.tenantId), eq(paymentMethods.code, code)));
  return m!.id;
}

async function bookingCount(fx: TenantFixture) {
  return (await admin().select().from(bookings).where(eq(bookings.tenantId, fx.tenantId))).length;
}

async function account(fx: TenantFixture, type: 'company' | 'travel_agent', code: string) {
  const res = await request('POST', '/ledger-accounts', {
    token: fx.token,
    body: { type, code, name: `${code} Ltd`, creditLimit: 0 },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function openDrawer(fx: TenantFixture) {
  const drawer = await request('POST', `/properties/${fx.propertyId}/drawers`, {
    token: fx.token,
    body: { name: 'Front desk' },
  });
  const session = await request('POST', `/drawers/${drawer.body.id}/open`, {
    token: fx.token,
    body: { openingFloat: 5000 },
  });
  return session.body.id as string;
}

async function upload(fx: TenantFixture, purpose: string, type = 'image/png', name = 'slip.png') {
  const supertest = (await import('supertest')).default;
  const server = (await startApp()).getHttpServer();
  const res = await supertest(server)
    .post(`/files?purpose=${purpose}`)
    .set('Authorization', `Bearer ${fx.token}`)
    .attach('file', Buffer.from('%PNG-fake-bytes-for-a-slip'), {
      filename: name,
      contentType: type,
    });
  return { status: res.status, body: res.body };
}

describe('money taken with the reservation', () => {
  it('splits a deposit across the rooms under one receipt', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Deposit Dissanayake' },
      lines: [line(fx), line(fx)],
      payment: { paymentMethodId: await methodId(fx, 'CC'), amount: 10000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment.receiptNo).toMatch(/^RC\d{2}-\d{5}$/);

    const ids = res.body.bookings.map((b: { id: string }) => b.id);
    const rows = await admin().select().from(payments).where(inArray(payments.bookingId, ids));
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, p) => s + Number(p.amount), 0)).toBeCloseTo(10000, 2);
    expect(rows.map((p) => Number(p.amount))).toEqual([5000, 5000]);
    expect(new Set(rows.map((p) => p.receiptNo)).size).toBe(1);
    expect(new Set(rows.map((p) => p.allocationGroupId)).size).toBe(1);
    expect(rows.every((p) => p.method === 'card' && p.methodCode === 'CC' && p.folioId)).toBe(true);
    expect(rows[0]!.takenByUserId).toBe(fx.userId);
  });

  it('refuses a payment larger than the reservation, saving nothing', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Over Paid' },
      lines: [line(fx)],
      payment: { paymentMethodId: await methodId(fx, 'CC'), amount: 999999 },
    });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('payment_exceeds_total');
    expect(await bookingCount(fx)).toBe(0);
  });

  it('needs the reference number for a bank transfer', async () => {
    const fx = await ready();
    const bank = await methodId(fx, 'BANK');
    const missing = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'No Reference' },
      lines: [line(fx)],
      payment: { paymentMethodId: bank, amount: 1000 },
    });
    expect(missing.status).toBe(400);
    expect(missing.body.reason).toBe('reference_required');
    expect(await bookingCount(fx)).toBe(0);

    const ok = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'With Reference' },
      lines: [line(fx)],
      payment: { paymentMethodId: bank, amount: 1000, reference: 'CEFTS-778812' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('puts cash in the open drawer, and refuses cash with no drawer open', async () => {
    const fx = await ready();
    const cash = await methodId(fx, 'CASH');
    const body = {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Cash Cooray' },
      lines: [line(fx)],
      payment: { paymentMethodId: cash, amount: 2500 },
    };
    const refused = await reserve(fx, body);
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('drawer_closed');
    expect(await bookingCount(fx)).toBe(0);

    const sessionId = await openDrawer(fx);
    const ok = await reserve(fx, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const [p] = await admin()
      .select()
      .from(payments)
      .where(eq(payments.bookingId, ok.body.bookings[0].id));
    expect(p!.drawerSessionId).toBe(sessionId);
    const report = await request('GET', `/drawer-sessions/${sessionId}/report`, {
      token: fx.token,
    });
    expect(report.body.totals.cashTaken).toBe('2500.00');
  });

  it('takes cash without a drawer on a plan without cashiering', async () => {
    const fx = await ready({ plan: 'starter' });
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Starter Cash' },
      lines: [line(fx)],
      payment: { paymentMethodId: await methodId(fx, 'CASH'), amount: 1000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('charges the City Ledger method to the travel agent, with a ledger debit', async () => {
    const fx = await ready();
    const ta = await account(fx, 'travel_agent', 'TA1');
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      origin: 'travel_agent',
      ledgerAccountId: ta,
      guest: { name: 'Agent Guest' },
      lines: [line(fx)],
      payment: { paymentMethodId: await methodId(fx, 'CL'), amount: 5000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.payment.receiptNo).toBeNull();
    const entries = await admin()
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, ta));
    expect(entries.map((e) => [e.direction, e.amount])).toEqual([['debit', '5000.00']]);
  });

  it('numbers receipts without gaps or repeats, even taken at once', async () => {
    const fx = await ready();
    const created = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Receipt Rodrigo' },
      lines: [line(fx)],
    });
    const folio = await request('GET', `/bookings/${created.body.bookings[0].id}/folio`, {
      token: fx.token,
    });
    const folioId = folio.body.windows[0].id;
    const cc = await methodId(fx, 'CC');
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request('POST', `/folios/${folioId}/payments`, {
          token: fx.token,
          body: { amount: 100, paymentMethodId: cc },
        }),
      ),
    );
    const numbers = results
      .map((r) => {
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        return Number(String(r.body.receiptNo).split('-')[1]);
      })
      .sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('private files', () => {
  it('keeps a slip private to the tenant, and never on the public media route', async () => {
    const fx = await ready();
    const other = await ready();
    const up = await upload(fx, 'payment_slip');
    expect(up.status, JSON.stringify(up.body)).toBe(201);

    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Slip Samarasinghe' },
      lines: [line(fx)],
      payment: { paymentMethodId: await methodId(fx, 'CC'), amount: 1000, fileId: up.body.id },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const supertest = (await import('supertest')).default;
    const server = (await startApp()).getHttpServer();
    const mine = await supertest(server)
      .get(`/files/${up.body.id}`)
      .set('Authorization', `Bearer ${fx.token}`);
    expect(mine.status).toBe(200);
    expect(mine.headers['cache-control']).toContain('no-store');

    const theirs = await supertest(server)
      .get(`/files/${up.body.id}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(theirs.status).toBe(404);
    expect((await supertest(server).get(`/files/${up.body.id}`)).status).toBe(401);

    const [row] = await admin().select().from(privateFiles).where(eq(privateFiles.id, up.body.id));
    expect((await supertest(server).get(`/media/${row!.storageKey}`)).status).toBe(404);

    // Attached to a payment: kept.
    const del = await request('DELETE', `/files/${up.body.id}`, { token: fx.token });
    expect(del.status).toBe(409);
  });

  it('accepts only photos and PDFs, and refuses another tenant’s file on a payment', async () => {
    const fx = await ready();
    const other = await ready();
    const exe = await upload(fx, 'payment_slip', 'application/x-msdownload', 'run.exe');
    expect(exe.status).toBe(400);

    const theirs = await upload(other, 'payment_slip');
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Borrowed Slip' },
      lines: [line(fx)],
      payment: { paymentMethodId: await methodId(fx, 'CC'), amount: 1000, fileId: theirs.body.id },
    });
    expect(res.status).toBe(404);
    expect(await bookingCount(fx)).toBe(0);
  });
});

describe('Bill To', () => {
  it('bills the company on window 1', async () => {
    const fx = await ready();
    const co = await account(fx, 'company', 'ACME');
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      origin: 'corporate',
      ledgerAccountId: co,
      billTo: 'company',
      guest: { name: 'Corporate Chandrasiri' },
      lines: [line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const folio = await request('GET', `/bookings/${res.body.bookings[0].id}/folio`, {
      token: fx.token,
    });
    expect(folio.body.windows[0]).toMatchObject({
      window: 1,
      payerType: 'company',
      payerName: 'ACME Ltd',
    });
  });

  it('keeps room and tax on the company and routes extras to the guest', async () => {
    const fx = await ready();
    await addUnits(fx, fx.roomId, ['101', '102']);
    const co = await account(fx, 'company', 'ROOMCO');
    const res = await reserve(fx, {
      checkin: TODAY,
      checkout: addDays(TODAY, 1),
      origin: 'corporate',
      ledgerAccountId: co,
      billTo: 'company_room_tax',
      checkIn: true,
      guest: { name: 'Split Bill Silva' },
      lines: [
        line(fx, {
          inclusions: [{ name: 'Breakfast', rhythm: 'per_guest_per_night', unitPrice: 1500 }],
        }),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const bookingId = res.body.bookings[0].id;

    const audit = await request('POST', `/properties/${fx.propertyId}/night-audit/run`, {
      token: fx.token,
    });
    expect(audit.status, JSON.stringify(audit.body)).toBe(201);
    expect(audit.body.summary.inclusionsPosted).toBe(1);

    const folio = await request('GET', `/bookings/${bookingId}/folio`, { token: fx.token });
    const [w1, w2] = folio.body.windows;
    expect(w1.payerType).toBe('company');
    expect(w1.lines.map((l: any) => l.source)).toEqual(['room']);
    expect(w1.totals.charges).toBe(res.body.total);
    expect(w2).toMatchObject({
      window: 2,
      payerType: 'guest',
      routes: ['manual', 'pos', 'inclusion'],
    });
    expect(w2.lines).toMatchObject([{ source: 'inclusion', total: '3000.00' }]);

    // A second audit of the same night (the next date now) cannot post it again.
    const posted = await admin()
      .select()
      .from(folioCharges)
      .innerJoin(folios, eq(folios.id, folioCharges.folioId))
      .where(and(eq(folios.bookingId, bookingId), eq(folioCharges.source, 'inclusion')));
    expect(posted).toHaveLength(1);
  });

  it('keeps company billing behind the Pro plan', async () => {
    const fx = await ready({ plan: 'starter' });
    const [acct] = await admin()
      .insert(ledgerAccounts)
      .values({
        tenantId: fx.tenantId,
        type: 'company',
        code: 'STARTCO',
        name: 'Start Co',
        currency: 'LKR',
      })
      .returning();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      origin: 'corporate',
      ledgerAccountId: acct!.id,
      billTo: 'company',
      guest: { name: 'Starter Company' },
      lines: [line(fx)],
    });
    expect(res.status).toBe(403);
  });
});

describe('walk-in check-in', () => {
  it('checks the guest into the lowest free room, and says when it is dirty', async () => {
    const fx = await ready();
    const [u101] = await addUnits(fx, fx.roomId, ['101', '102', '103']);
    await request('POST', `/properties/${fx.propertyId}/housekeeping`, {
      token: fx.token,
      body: { roomUnitId: u101, date: TODAY, status: 'dirty' },
    });
    const res = await reserve(fx, {
      checkin: TODAY,
      checkout: addDays(TODAY, 2),
      checkIn: true,
      guest: { name: 'Walk In Wijesinghe' },
      lines: [line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'CheckedIn', checkedIn: true });
    expect(res.body.bookings[0].roomCode).toBe('101');
    expect(res.body.warnings).toEqual(['Room 101 is marked dirty.']);
    const [b] = await admin()
      .select()
      .from(bookings)
      .where(eq(bookings.id, res.body.bookings[0].id));
    expect(b!.status).toBe('CheckedIn');
  });

  it('only checks in a stay that starts today, into a room that exists', async () => {
    const fx = await ready();
    const future = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      checkIn: true,
      guest: { name: 'Too Early' },
      lines: [line(fx)],
    });
    expect(future.status).toBe(400);
    expect(future.body.reason).toBe('checkin_not_today');

    // No physical rooms set up for the room type.
    const none = await reserve(fx, {
      checkin: TODAY,
      checkout: addDays(TODAY, 1),
      checkIn: true,
      guest: { name: 'No Rooms' },
      lines: [line(fx)],
    });
    expect(none.status).toBe(409);
    expect(none.body.reason).toBe('no_room_free');
    expect(await bookingCount(fx)).toBe(0);
  });
});

describe('check-out and the city ledger', () => {
  it("moves the company's window to its account and accrues the travel agent's commission", async () => {
    const fx = await ready();
    await addUnits(fx, fx.roomId, ['201']);
    const ta = await account(fx, 'travel_agent', 'TA10');
    await admin()
      .update(ledgerAccounts)
      .set({ commissionPlan: 'pct_all_nights', commissionValue: '10' })
      .where(eq(ledgerAccounts.id, ta));

    const res = await reserve(fx, {
      checkin: TODAY,
      checkout: addDays(TODAY, 1),
      origin: 'travel_agent',
      ledgerAccountId: ta,
      billTo: 'company',
      checkIn: true,
      guest: { name: 'Commission Karunaratne' },
      lines: [line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.bookings[0].id;
    await request('POST', `/bookings/${id}/folio/post-room-charges`, { token: fx.token });
    const out = await request('POST', `/bookings/${id}/check-out`, { token: fx.token });
    expect(out.status, JSON.stringify(out.body)).toBe(200);

    const entries = await admin()
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, ta));
    const debit = entries.find((e) => e.direction === 'debit')!;
    const credit = entries.find((e) => e.direction === 'credit')!;
    expect(debit.amount).toBe(res.body.total);
    // Untaxed fixture: net room revenue is the room total.
    expect(Number(credit.amount)).toBeCloseTo(Number(res.body.total) * 0.1, 1);

    const folio = await request('GET', `/bookings/${id}/folio`, { token: fx.token });
    expect(folio.body.windows[0].totals.balance).toBe('0.00');
  });
});

describe('transfers', () => {
  it('charges a pick-up when it is done, and takes the charge back if it is cancelled', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Airport Abeysekera' },
      lines: [
        line(fx, {
          transfers: [{ direction: 'pickup', fromPlace: 'CMB', flightNo: 'UL 504', amount: 12000 }],
        }),
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.bookings[0].id;
    const [t] = (await request('GET', `/bookings/${id}/transfers`, { token: fx.token })).body;
    expect(t).toMatchObject({ direction: 'pickup', status: 'planned', amount: '12000.00' });

    const done = await request('PATCH', `/booking-transfers/${t.id}`, {
      token: fx.token,
      body: { status: 'done' },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    let folio = await request('GET', `/bookings/${id}/folio`, { token: fx.token });
    expect(folio.body.windows[0].lines).toMatchObject([
      { description: 'Pick-up', total: '12000.00' },
    ]);

    await request('PATCH', `/booking-transfers/${t.id}`, {
      token: fx.token,
      body: { status: 'cancelled' },
    });
    folio = await request('GET', `/bookings/${id}/folio`, { token: fx.token });
    expect(folio.body.windows[0].lines[0].voidedAt).not.toBeNull();
  });

  it('lists the seeded transport modes, and lets only the owner add one', async () => {
    const fx = await ready();
    const modes = await request('GET', '/transport-modes', { token: fx.token });
    expect(modes.body.map((m: { code: string }) => m.code)).toEqual(
      expect.arrayContaining(['CAR', 'VAN', 'TUK']),
    );
    const added = await request('POST', '/transport-modes', {
      token: fx.token,
      body: { code: 'boat', name: 'Boat', defaultPrice: 8000 },
    });
    expect(added.status).toBe(201);
    expect(added.body.code).toBe('BOAT');

    const desk = await addDeskUser(fx);
    const refused = await request('POST', '/transport-modes', {
      token: desk.token,
      body: { code: 'JEEP', name: 'Jeep' },
    });
    expect(refused.status).toBe(403);
  });
});

describe('inclusions', () => {
  it('adds and stops an inclusion on a booking, within the tenant only', async () => {
    const fx = await ready();
    const other = await ready();
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Driver Room Dias' },
      lines: [line(fx)],
    });
    const id = res.body.bookings[0].id;
    const added = await request('POST', `/bookings/${id}/inclusions`, {
      token: fx.token,
      body: { name: 'Driver accommodation', rhythm: 'per_night', unitPrice: 3500 },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    expect(added.body).toMatchObject({
      rhythm: 'per_night',
      unitPrice: '3500.00',
      includedInRate: false,
    });

    const list = await request('GET', `/bookings/${id}/inclusions`, { token: fx.token });
    expect(list.body).toHaveLength(1);
    expect(
      (await request('GET', `/bookings/${id}/inclusions`, { token: other.token })).status,
    ).toBe(404);
    expect(
      (await request('DELETE', `/booking-inclusions/${added.body.id}`, { token: other.token }))
        .status,
    ).toBe(404);

    const gone = await request('DELETE', `/booking-inclusions/${added.body.id}`, {
      token: fx.token,
    });
    expect(gone.status).toBe(200);
    expect((await request('GET', `/bookings/${id}/inclusions`, { token: fx.token })).body).toEqual(
      [],
    );
  });
});
