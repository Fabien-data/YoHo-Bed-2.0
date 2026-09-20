import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  bookingDays,
  exchangeRates,
  properties,
  propertyTaxTypes,
  taxDurations,
  taxTypes,
} from '@yohobed/db';
import {
  addDeskUser,
  admin,
  book,
  makeTenant,
  openAndPrice,
  request,
  reserve,
  stopApp,
  type TenantFixture,
} from './harness';

/** Tax invoices, bills, pro-formas, credit notes and the document series (Phase 02, Sprint 6). */

afterAll(stopApp);

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
const SERIAL_PREFIX = `${TODAY.slice(2, 4)}${MONTHS[Number(TODAY.slice(5, 7)) - 1]}-0001-`;

const cents = (v: string | number) => Math.round(Number(v) * 100);

/**
 * A Sri Lankan hotel with a TIN: service charge 10%, then SSCL 2.5%, then VAT 18% — the order
 * the engine compounds them in (priority 1, 2, 3). Taxes first, so the calendar is priced with them.
 */
async function lkHotel(opts: { tin?: string | null; plan?: 'starter' | 'enterprise' } = {}) {
  const fx = await makeTenant({ roomQuantity: 20, plan: opts.plan });
  const db = admin();
  for (const [name, rate, priority] of [
    ['Service Charge', '10.0000', 1],
    ['SSCL', '2.5000', 2],
    ['VAT', '18.0000', 3],
  ] as const) {
    const [type] = await db.insert(taxTypes).values({ tenantId: fx.tenantId, name }).returning();
    await db.insert(taxDurations).values({
      tenantId: fx.tenantId,
      taxTypeId: type!.id,
      startDate: '2000-01-01',
      endDate: '2099-12-31',
      ratePercent: rate,
    });
    await db.insert(propertyTaxTypes).values({
      tenantId: fx.tenantId,
      propertyId: fx.propertyId,
      taxTypeId: type!.id,
      priority,
    });
  }
  await db
    .update(properties)
    .set({
      taxIds: opts.tin === null ? {} : { tin: opts.tin ?? '114523678' },
      branchCode: '1',
      legalName: 'Lakeside Hotels (Pvt) Ltd',
      address: '12 Lake Road',
      city: 'Colombo',
    })
    .where(eq(properties.id, fx.propertyId));
  await openAndPrice(fx, TODAY, addDays(TODAY, 60), { roomsToSell: 20, base: 18000 });
  return fx;
}

/** A 2-night stay with its room charges posted, a VAT-able minibar and a transfer with no VAT. */
async function stayWithExtras(fx: TenantFixture, offset = 3) {
  const res = await reserve(fx, {
    checkin: addDays(TODAY, offset),
    checkout: addDays(TODAY, offset + 2),
    guest: { name: 'Invoice Ilangakoon' },
    lines: [{ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 }],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const bookingId = res.body.bookings[0].id as string;
  await request('POST', `/bookings/${bookingId}/folio/post-room-charges`, { token: fx.token });
  const folio = await request('GET', `/bookings/${bookingId}/folio`, { token: fx.token });
  const folioId = folio.body.windows[0].id as string;
  await request('POST', `/folios/${folioId}/charges`, {
    token: fx.token,
    body: { description: 'Minibar', unitPrice: 2360, taxRatePct: 18 },
  });
  await request('POST', `/folios/${folioId}/charges`, {
    token: fx.token,
    body: { description: 'Airport transfer', unitPrice: 12000, taxRatePct: 0 },
  });
  return { bookingId, folioId, amount: res.body.total as string };
}

describe('a Sri Lankan tax invoice (Gazette 2481/22)', () => {
  it('puts the VAT-able lines on a TAX INVOICE and the rest on a BILL', async () => {
    const fx = await lkHotel();
    const { bookingId, folioId, amount } = await stayWithExtras(fx);
    const res = await request('POST', `/folios/${folioId}/invoice`, {
      token: fx.token,
      body: { payer: { name: 'Acme Lanka (Pvt) Ltd', taxId: '134009876' } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [inv, bill] = res.body.documents;

    expect(inv).toMatchObject({
      kind: 'tax_invoice',
      profile: 'lk_vat',
      title: 'TAX INVOICE',
      currency: 'LKR',
      invoiceDate: TODAY,
      supplier: { taxId: '114523678', legalName: 'Lakeside Hotels (Pvt) Ltd', branchCode: '1' },
      payer: { name: 'Acme Lanka (Pvt) Ltd', taxId: '134009876' },
    });
    expect(inv.number).toBe(`${SERIAL_PREFIX}1`);
    expect(inv.number.length).toBeLessThanOrEqual(40);
    // In date order: the minibar was posted today, before the (future) nights.
    expect(inv.lines.map((l: { description: string }) => l.description)).toEqual([
      'Minibar',
      `Room charge — ${addDays(TODAY, 3)}`,
      `Room charge — ${addDays(TODAY, 4)}`,
    ]);
    expect(inv.taxSummary.map((t: { name: string }) => t.name)).toEqual([
      'Service Charge',
      'SSCL',
      'VAT',
    ]);

    // The room lines' taxes are the stored split, to the cent: they add up to what was booked.
    const days = await admin()
      .select()
      .from(bookingDays)
      .where(inArray(bookingDays.bookingId, [bookingId]));
    const roomLines = inv.lines.filter((l: { description: string }) =>
      l.description.startsWith('Room charge'),
    );
    const storedTax = days.reduce((s, d) => s + cents(d.tax), 0);
    expect(roomLines.reduce((s: number, l: { tax: string }) => s + cents(l.tax), 0)).toBe(
      storedTax,
    );
    for (const l of inv.lines) {
      const split = (l.taxLines as Array<{ amount: number }>).reduce(
        (s, t) => s + cents(t.amount),
        0,
      );
      expect(split).toBe(cents(l.tax));
      expect(cents(l.net) + cents(l.tax)).toBe(cents(l.amount));
    }
    expect(roomLines.reduce((s: number, l: { amount: string }) => s + cents(l.amount), 0)).toBe(
      cents(amount),
    );
    expect(cents(inv.subtotal) + cents(inv.taxTotal)).toBe(cents(inv.amount));

    expect(bill).toMatchObject({ kind: 'bill', title: 'BILL', profile: 'lk_vat' });
    expect(bill.number).toMatch(/^BL-\d{4}-\d{2}-00001$/);
    expect(bill.lines).toMatchObject([{ description: 'Airport transfer', tax: '0.00' }]);
  });

  it('invoices a bill once, and again only after a credit note with a reason', async () => {
    const fx = await lkHotel();
    const { folioId } = await stayWithExtras(fx);
    const first = await request('POST', `/folios/${folioId}/invoice`, {
      token: fx.token,
      body: {},
    });
    const inv = first.body.documents[0];

    const again = await request('POST', `/folios/${folioId}/invoice`, {
      token: fx.token,
      body: {},
    });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('already_invoiced');

    const noReason = await request('POST', `/invoices/${inv.id}/credit-note`, {
      token: fx.token,
      body: {},
    });
    expect(noReason.status).toBe(400);

    const cn = await request('POST', `/invoices/${inv.id}/credit-note`, {
      token: fx.token,
      body: { reason: 'Company name misspelt' },
    });
    expect(cn.status, JSON.stringify(cn.body)).toBe(201);
    expect(cn.body).toMatchObject({
      kind: 'credit_note',
      title: 'CREDIT NOTE',
      amount: inv.amount,
      creditReason: 'Company name misspelt',
      original: { id: inv.id, number: inv.number },
    });
    expect(cn.body.number).toMatch(/^CN-\d{4}-\d{2}-00001$/);

    const twice = await request('POST', `/invoices/${inv.id}/credit-note`, {
      token: fx.token,
      body: { reason: 'Again' },
    });
    expect(twice.status).toBe(409);
    expect(twice.body.reason).toBe('already_credited');

    // A window is invoiced again only once every live document on it is credited — the bill too.
    // The new tax invoice is the next in the series.
    const billId = first.body.documents[1].id;
    await request('POST', `/invoices/${billId}/credit-note`, {
      token: fx.token,
      body: { reason: 'Reissued with the tax invoice' },
    });
    const reissued = await request('POST', `/folios/${folioId}/invoice`, {
      token: fx.token,
      body: {},
    });
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(201);
    expect(reissued.body.documents[0].number).toBe(`${SERIAL_PREFIX}2`);

    const original = await request('GET', `/invoices/${inv.id}`, { token: fx.token });
    expect(original.body.status).toBe('issued');
    expect(original.body.creditedAt).not.toBeNull();
    expect(original.body.creditNotes).toMatchObject([{ number: cn.body.number }]);
  });

  it('numbers tax invoices without gaps or repeats, even issued at once', async () => {
    const fx = await lkHotel();
    const folios: string[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await book(fx, {
        checkin: addDays(TODAY, 10 + i),
        checkout: addDays(TODAY, 11 + i),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const f = await request('GET', `/bookings/${res.body.id}/folio`, { token: fx.token });
      folios.push(f.body.windows[0].id);
    }
    const results = await Promise.all(
      folios.map((id) => request('POST', `/folios/${id}/invoice`, { token: fx.token, body: {} })),
    );
    const numbers = results
      .map((r) => {
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        return Number(String(r.body.documents[0].number).split('-').pop());
      })
      .sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('shows the LKR equivalent of a foreign-currency invoice at the rate it was issued at', async () => {
    const fx = await lkHotel();
    await admin()
      .update(properties)
      .set({ currency: 'USD' })
      .where(eq(properties.id, fx.propertyId));
    await admin()
      .insert(exchangeRates)
      .values({ base: 'USD', quote: 'LKR', rate: '300.00000000', source: 'e2e' });
    const res = await book(fx, { checkin: addDays(TODAY, 5), checkout: addDays(TODAY, 6) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const inv = await request('POST', `/bookings/${res.body.id}/invoices`, {
      token: fx.token,
      body: {},
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.documents[0]).toMatchObject({ currency: 'USD', fxQuote: 'LKR' });
    expect(Number(inv.body.documents[0].fxRate)).toBeGreaterThan(0);
  });
});

describe('other invoices', () => {
  it('gives a hotel with no TIN one plain INVOICE with every line', async () => {
    const fx = await lkHotel({ tin: null });
    await admin()
      .update(properties)
      .set({ invoicePrefix: 'lkh' })
      .where(eq(properties.id, fx.propertyId));
    const { folioId } = await stayWithExtras(fx);
    const res = await request('POST', `/folios/${folioId}/invoice`, { token: fx.token, body: {} });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0]).toMatchObject({
      kind: 'invoice',
      profile: 'generic',
      title: 'INVOICE',
    });
    expect(res.body.documents[0].number).toMatch(/^LKH-\d{4}-\d{2}-00001$/);
    expect(res.body.documents[0].lines).toHaveLength(4);
  });

  it("invoices a booking's own nights when no room charge was ever posted (Starter)", async () => {
    const fx = await lkHotel({ plan: 'starter' });
    const res = await reserve(fx, {
      checkin: addDays(TODAY, 7),
      checkout: addDays(TODAY, 10),
      guest: { name: 'Starter Senaratne' },
      lines: [{ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 }],
    });
    const inv = await request('POST', `/bookings/${res.body.bookings[0].id}/invoices`, {
      token: fx.token,
      body: {},
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const doc = inv.body.documents[0];
    expect(doc.lines).toHaveLength(3);
    expect(doc.amount).toBe(res.body.total);
    expect(doc.payer.name).toBe('Starter Senaratne');
  });

  it('keeps pro-formas out of the tax invoice series', async () => {
    const fx = await lkHotel();
    const res = await reserve(fx, {
      checkin: addDays(TODAY, 20),
      checkout: addDays(TODAY, 22),
      guest: { name: 'Quote Quintus' },
      lines: [
        {
          roomId: fx.roomId,
          occupancyId: fx.occupancyId,
          adults: 2,
          inclusions: [{ name: 'Dinner', rhythm: 'per_guest_per_night', unitPrice: 2500 }],
        },
      ],
    });
    const id = res.body.bookings[0].id;
    const pf = await request('POST', `/bookings/${id}/proforma`, { token: fx.token, body: {} });
    expect(pf.status, JSON.stringify(pf.body)).toBe(201);
    expect(pf.body).toMatchObject({ kind: 'proforma', title: 'PRO-FORMA INVOICE' });
    expect(pf.body.number).toMatch(/^PF-\d{4}-\d{2}-00001$/);
    // 2 nights, then dinner for 2 guests × 2 nights.
    expect(
      pf.body.lines.map((l: { description: string; quantity: string }) => [
        l.description,
        l.quantity,
      ]),
    ).toEqual([
      [`Room charge — ${addDays(TODAY, 20)}`, '1.00'],
      [`Room charge — ${addDays(TODAY, 21)}`, '1.00'],
      ['Dinner', '4.00'],
    ]);

    const seq = await request('GET', `/properties/${fx.propertyId}/document-sequences`, {
      token: fx.token,
    });
    expect(seq.body.next.find((n: { docType: string }) => n.docType === 'tax_invoice').number).toBe(
      `${SERIAL_PREFIX}1`,
    );
  });

  it('still issues the one-per-booking INV-<reference>', async () => {
    const fx = await lkHotel();
    const b = await book(fx, { checkin: addDays(TODAY, 30), checkout: addDays(TODAY, 31) });
    const legacy = await request('POST', `/bookings/${b.body.id}/invoice`, { token: fx.token });
    expect(legacy.status).toBe(201);
    expect(legacy.body).toMatchObject({ number: `INV-${b.body.reference}`, kind: 'legacy' });
    await request('POST', `/bookings/${b.body.id}/invoices`, { token: fx.token, body: {} });
    const again = await request('POST', `/bookings/${b.body.id}/invoice`, { token: fx.token });
    expect(again.body.id).toBe(legacy.body.id);
    const list = await request('GET', `/invoices?bookingId=${b.body.id}`, { token: fx.token });
    expect(list.body.map((i: { kind: string }) => i.kind).sort()).toEqual([
      'legacy',
      'tax_invoice',
    ]);
  });
});

describe('the document series', () => {
  it('lets the owner continue a series from another system, forward only', async () => {
    const fx = await lkHotel();
    const period = TODAY.slice(0, 7);
    const set = await request('PATCH', `/properties/${fx.propertyId}/document-sequences`, {
      token: fx.token,
      body: { docType: 'tax_invoice', period, nextValue: 100 },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const back = await request('PATCH', `/properties/${fx.propertyId}/document-sequences`, {
      token: fx.token,
      body: { docType: 'tax_invoice', period, nextValue: 50 },
    });
    expect(back.status).toBe(409);
    expect(back.body.reason).toBe('sequence_backwards');

    const desk = await addDeskUser(fx);
    const staff = await request('PATCH', `/properties/${fx.propertyId}/document-sequences`, {
      token: desk.token,
      body: { docType: 'tax_invoice', period, nextValue: 200 },
    });
    expect(staff.status).toBe(403);

    const b = await book(fx, { checkin: addDays(TODAY, 40), checkout: addDays(TODAY, 41) });
    const inv = await request('POST', `/bookings/${b.body.id}/invoices`, {
      token: fx.token,
      body: {},
    });
    expect(inv.body.documents[0].number).toBe(`${SERIAL_PREFIX}100`);
  });

  it("never shows or invoices another hotel's documents", async () => {
    const fx = await lkHotel();
    const other = await lkHotel();
    const { folioId } = await stayWithExtras(fx);
    const inv = await request('POST', `/folios/${folioId}/invoice`, { token: fx.token, body: {} });
    const id = inv.body.documents[0].id;
    expect((await request('GET', `/invoices/${id}`, { token: other.token })).status).toBe(404);
    expect(
      (await request('POST', `/folios/${folioId}/invoice`, { token: other.token, body: {} }))
        .status,
    ).toBe(404);
    expect(
      (
        await request('POST', `/invoices/${id}/credit-note`, {
          token: other.token,
          body: { reason: 'Not mine' },
        })
      ).status,
    ).toBe(404);
    const list = await request('GET', '/invoices', { token: other.token });
    expect(list.body.find((i: { id: string }) => i.id === id)).toBeUndefined();
  });
});
