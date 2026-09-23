import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { bookingDays, bookings, businessDates, customers, guestDocuments } from '@yohobed/db';
import {
  admin,
  book,
  hotelToday,
  makeTenant,
  openAndPrice,
  request,
  setFxRate,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * Malaysia and India money and compliance (Development Phase 02, Sprint 7): the forward tax
 * engine end to end, Malaysia's tourism tax on the folio, the two countries' invoices, India's
 * Form C tracker and Malaysia's guest register.
 */

const previous = process.env.REGIONAL_TAX_COUNTRIES;
beforeAll(async () => {
  process.env.REGIONAL_TAX_COUNTRIES = 'MY,IN';
  await setFxRate('MYR', 70);
  await setFxRate('INR', 3.6);
});
afterAll(async () => {
  process.env.REGIONAL_TAX_COUNTRIES = previous;
  await stopApp();
});

async function applyPreset(fx: TenantFixture) {
  const res = await request('POST', `/properties/${fx.propertyId}/taxes/apply-preset`, {
    token: fx.token,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/** A standalone Malaysian hotel with the preset applied: its base price IS the pre-tax price. */
async function malaysia(opts: { register?: boolean } = {}) {
  const fx = await makeTenant({
    country: 'MY',
    currency: 'MYR',
    distributionMode: 'standalone',
    roomQuantity: 8,
  });
  await applyPreset(fx);
  await request('PATCH', `/properties/${fx.propertyId}/settings`, {
    token: fx.token,
    body: { requireGuestRegistration: opts.register ?? false, checkoutBalancePolicy: 'allow' },
  });
  return fx;
}

async function india() {
  const fx = await makeTenant({
    country: 'IN',
    currency: 'INR',
    distributionMode: 'standalone',
    roomQuantity: 8,
  });
  await applyPreset(fx);
  await request('PATCH', `/properties/${fx.propertyId}/settings`, {
    token: fx.token,
    body: { checkoutBalancePolicy: 'allow' },
  });
  return fx;
}

async function stay(
  fx: TenantFixture,
  checkin: string,
  checkout: string,
  opts: { rooms?: number; residency?: 'local' | 'foreign'; nationality?: string } = {},
) {
  const res = await book(fx, { checkin, checkout, rooms: opts.rooms ?? 1 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await request('POST', `/bookings/${res.body.id}/approve`, { token: fx.token });
  const db = admin();
  if (opts.residency) {
    await db
      .update(bookings)
      .set({ residency: opts.residency })
      .where(eq(bookings.id, res.body.id));
  }
  if (opts.nationality) {
    await db
      .update(customers)
      .set({ nationalityCode: opts.nationality })
      .where(eq(customers.id, res.body.customerId));
  }
  return res.body as { id: string; customerId: string; amount: string; taxes: string };
}

const folioOf = (fx: TenantFixture, id: string) =>
  request('GET', `/bookings/${id}/folio`, { token: fx.token });

async function liveLevies(fx: TenantFixture, id: string) {
  const f = await folioOf(fx, id);
  return (f.body.windows as Array<{ id: string; lines: any[] }>).flatMap((w) =>
    w.lines.filter((l) => l.source === 'levy' && !l.voidedAt).map((l) => ({ ...l, folioId: w.id })),
  );
}

const audit = (fx: TenantFixture) =>
  request('POST', `/properties/${fx.propertyId}/night-audit/run`, { token: fx.token, body: {} });

describe('regional tax presets', () => {
  it('are off until the platform switches the country on (tax adviser sign-off)', async () => {
    const fx = await makeTenant({ country: 'MY', currency: 'MYR' });
    process.env.REGIONAL_TAX_COUNTRIES = 'IN';
    try {
      const res = await request('POST', `/properties/${fx.propertyId}/taxes/apply-preset`, {
        token: fx.token,
      });
      expect(res.status).toBe(409);
      expect(res.body.reason).toBe('region_not_enabled');
    } finally {
      process.env.REGIONAL_TAX_COUNTRIES = 'MY,IN';
    }
  });

  it('need the country currency, and Sri Lanka has none', async () => {
    const lkr = await makeTenant({ country: 'MY' });
    const res = await request('POST', `/properties/${lkr.propertyId}/taxes/apply-preset`, {
      token: lkr.token,
    });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe('currency_mismatch');

    const lk = await makeTenant();
    const none = await request('POST', `/properties/${lk.propertyId}/taxes/apply-preset`, {
      token: lk.token,
    });
    expect(none.status).toBe(400);
    expect(none.body.reason).toBe('no_tax_preset');
  });

  it('switch the property to the forward engine with its taxes and levies', async () => {
    const fx = await makeTenant({ country: 'MY', currency: 'MYR' });
    const body = await applyPreset(fx);
    expect(body.taxMode).toBe('exclusive_forward');
    expect(body.taxes.map((t: { code: string }) => t.code)).toEqual(['SC', 'SST']);
    expect(body.levies).toMatchObject([
      { code: 'TTX', amount: '10.00', appliesTo: 'non_resident' },
    ]);
    const settings = await request('GET', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
    });
    expect(settings.body.requireGuestRegistration).toBe(true);
  });
});

describe('the forward tax engine at the desk', () => {
  it('Malaysia: RM200 a night is RM237.60 with service charge and SST', async () => {
    const fx = await malaysia();
    const from = hotelToday(40);
    await openAndPrice(fx, from, hotelToday(45), { base: 200 });
    const b = await stay(fx, from, hotelToday(43));
    expect(b.amount).toBe('712.80');
    expect(b.taxes).toBe('112.80');
    const [night] = await admin()
      .select()
      .from(bookingDays)
      .where(and(eq(bookingDays.bookingId, b.id), eq(bookingDays.date, from)));
    expect(night!.sellingPrice).toBe('237.60');
    expect(night!.taxLines!.map((l) => [l.code, l.amount])).toEqual([
      ['SC', 20],
      ['SST', 17.6],
    ]);
  });

  it('India: ₹7,500 is 5% and ₹8,000 is 18% — the slab follows the room-night value', async () => {
    const fx = await india();
    await openAndPrice(fx, hotelToday(40), hotelToday(41), { base: 7500 });
    await openAndPrice(fx, hotelToday(42), hotelToday(43), { base: 8000 });
    const low = await stay(fx, hotelToday(40), hotelToday(41));
    const high = await stay(fx, hotelToday(42), hotelToday(43));
    expect(low.amount).toBe('7875.00');
    expect(high.amount).toBe('9440.00');
  });
});

describe("Malaysia's tourism tax", () => {
  it('is RM10 per room per night for a foreign guest, posted by night audit (3 nights × 2 rooms = RM60)', async () => {
    const fx = await malaysia();
    await openAndPrice(fx, hotelToday(), hotelToday(5), { base: 200 });
    const b = await stay(fx, hotelToday(), hotelToday(3), { rooms: 2, residency: 'foreign' });
    expect((await request('POST', `/bookings/${b.id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );
    for (let i = 0; i < 3; i++) expect((await audit(fx)).status).toBe(201);
    const levies = await liveLevies(fx, b.id);
    expect(levies).toHaveLength(3);
    expect(levies.every((l) => l.total === '20.00' && l.levyCode === 'TTX')).toBe(true);

    const out = await request('POST', `/bookings/${b.id}/check-out`, { token: fx.token, body: {} });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    // Check-out reconciles: every night was posted already, so nothing is added twice.
    expect(await liveLevies(fx, b.id)).toHaveLength(3);
  });

  it('is never charged to a Malaysian, a channel-collected stay, or a no-show', async () => {
    const fx = await malaysia();
    await openAndPrice(fx, hotelToday(), hotelToday(4), { base: 200 });
    const local = await stay(fx, hotelToday(), hotelToday(2), { residency: 'local' });
    const channel = await stay(fx, hotelToday(), hotelToday(2), { residency: 'foreign' });
    await admin()
      .update(bookings)
      .set({ levyCollectedByChannel: true })
      .where(eq(bookings.id, channel.id));
    const noShow = await stay(fx, hotelToday(), hotelToday(2), { residency: 'foreign' });
    for (const id of [local.id, channel.id]) {
      expect((await request('POST', `/bookings/${id}/check-in`, { token: fx.token })).status).toBe(
        200,
      );
    }
    expect((await audit(fx)).status).toBe(201);
    for (const id of [local.id, channel.id, noShow.id]) {
      expect(await liveLevies(fx, id)).toHaveLength(0);
    }
    const [ns] = await admin().select().from(bookings).where(eq(bookings.id, noShow.id));
    expect(ns!.status).toBe('NoShow');
  });

  it('is posted at check-out for the nights stayed when no night audit ran (a Starter hotel)', async () => {
    const fx = await malaysia();
    await openAndPrice(fx, hotelToday(-2), hotelToday(3), { base: 200 });
    // Arrived two nights ago, booked to stay four; leaves today.
    const b = await stay(fx, hotelToday(-2), hotelToday(2), { residency: 'foreign' });
    expect((await request('POST', `/bookings/${b.id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );
    const out = await request('POST', `/bookings/${b.id}/check-out`, { token: fx.token, body: {} });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const levies = await liveLevies(fx, b.id);
    expect(levies.map((l) => l.bookingDate).sort()).toEqual([hotelToday(-2), hotelToday(-1)]);
    expect(levies.reduce((s, l) => s + Number(l.total), 0)).toBe(20);
  });

  it('moves between bills only all together — never split across invoices', async () => {
    const fx = await malaysia();
    await openAndPrice(fx, hotelToday(), hotelToday(4), { base: 200 });
    const b = await stay(fx, hotelToday(), hotelToday(3), { residency: 'foreign' });
    await request('POST', `/bookings/${b.id}/check-in`, { token: fx.token });
    await audit(fx);
    await audit(fx);
    const levies = await liveLevies(fx, b.id);
    expect(levies).toHaveLength(2);
    const w2 = await request('POST', `/bookings/${b.id}/folio/windows`, {
      token: fx.token,
      body: { label: 'Company' },
    });
    expect(w2.status).toBe(201);
    const moved = await request('POST', '/folio-charges/transfer', {
      token: fx.token,
      body: { chargeIds: [levies[0]!.id], toFolioId: w2.body.id, reason: 'Company pays' },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const after = await liveLevies(fx, b.id);
    expect(after.every((l) => l.folioId === w2.body.id)).toBe(true);
  });

  it('shows on its own line of the invoice, with the TTx number', async () => {
    const fx = await malaysia();
    await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { taxIds: { sstNo: 'W10-1808-32000001', ttxNo: '141-2017-10000001' } },
    });
    await openAndPrice(fx, hotelToday(-1), hotelToday(2), { base: 200 });
    const b = await stay(fx, hotelToday(-1), hotelToday(1), { residency: 'foreign' });
    await request('POST', `/bookings/${b.id}/check-in`, { token: fx.token });
    await request('POST', `/bookings/${b.id}/check-out`, { token: fx.token, body: {} });
    const inv = await request('POST', `/bookings/${b.id}/invoices`, { token: fx.token, body: {} });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const doc = inv.body.documents[0];
    expect(doc.profile).toBe('my_sst');
    expect(doc.supplier.taxId).toBe('W10-1808-32000001');
    expect(doc.supplier.ttxNo).toBe('141-2017-10000001');
    const ttx = doc.lines.filter((l: { description: string }) =>
      l.description.startsWith('Tourism Tax'),
    );
    expect(ttx).toHaveLength(1);
    expect(ttx[0].tax).toBe('0.00');
    expect(doc.taxSummary.map((t: { name: string }) => t.name)).toEqual(['Service Charge', 'SST']);
  });
});

describe('Indian GST invoices', () => {
  async function indiaWithGstin() {
    const fx = await india();
    const p = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { stateCode: '29', taxIds: { gstin: '29ABCDE1234F1Z5' } },
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    return fx;
  }

  async function onDate(fx: TenantFixture, date: string) {
    await admin()
      .insert(businessDates)
      .values({ tenantId: fx.tenantId, propertyId: fx.propertyId, currentDate: date })
      .onConflictDoUpdate({ target: businessDates.propertyId, set: { currentDate: date } });
  }

  it('print CGST + SGST, SAC 996311, the place of supply, and round to the rupee', async () => {
    const fx = await indiaWithGstin();
    await openAndPrice(fx, hotelToday(30), hotelToday(32), { base: 7499.99 });
    const b = await stay(fx, hotelToday(30), hotelToday(31));
    const inv = await request('POST', `/bookings/${b.id}/invoices`, { token: fx.token, body: {} });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const doc = inv.body.documents[0];
    expect(doc.profile).toBe('in_gst');
    expect(doc.kind).toBe('tax_invoice');
    expect(doc.title).toBe('TAX INVOICE');
    expect(doc.number).toMatch(/^INV\/\d{2}-\d{2}\/\d{6}$/);
    expect(doc.number.length).toBeLessThanOrEqual(16);
    expect(doc.placeOfSupply).toBe('29');
    // 7,499.99 + 5% (375.00) = 7,874.99 → rounded to 7,875 with 0.01 round-off.
    const [cgst, sgst] = doc.taxSummary;
    expect([cgst.name, sgst.name]).toEqual(['CGST', 'SGST']);
    expect(Number(cgst.amount) + Number(sgst.amount)).toBeCloseTo(Number(doc.taxTotal), 2);
    expect(doc.amount).toBe('7875.00');
    expect(doc.rounding).toBe('0.01');
    expect(Number(doc.subtotal) + Number(doc.taxTotal) + Number(doc.rounding)).toBeCloseTo(7875, 2);
    expect(doc.lines[0].hsnSac).toBe('996311');
  });

  it('number a new series from 1 April', async () => {
    const fx = await indiaWithGstin();
    await openAndPrice(fx, hotelToday(30), hotelToday(33), { base: 5000 });
    const a = await stay(fx, hotelToday(30), hotelToday(31));
    const c = await stay(fx, hotelToday(32), hotelToday(33));
    await onDate(fx, '2027-03-31');
    const march = await request('POST', `/bookings/${a.id}/invoices`, {
      token: fx.token,
      body: {},
    });
    await onDate(fx, '2027-04-01');
    const april = await request('POST', `/bookings/${c.id}/invoices`, {
      token: fx.token,
      body: {},
    });
    expect(march.body.documents[0].number).toBe('INV/26-27/000001');
    expect(april.body.documents[0].number).toBe('INV/27-28/000001');
  });

  it("refuse a buyer's GSTIN that is not one", async () => {
    const fx = await indiaWithGstin();
    await openAndPrice(fx, hotelToday(30), hotelToday(31), { base: 5000 });
    const b = await stay(fx, hotelToday(30), hotelToday(31));
    const bad = await request('POST', `/bookings/${b.id}/invoices`, {
      token: fx.token,
      body: { payer: { taxId: '29ABCDE1234' } },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('invalid_gstin');
  });
});

describe("India's Form C", () => {
  it('tracks a foreign guest from check-in, due within 24 hours, until it is filed', async () => {
    const fx = await india();
    await openAndPrice(fx, hotelToday(), hotelToday(3), { base: 5000 });
    const foreign = await stay(fx, hotelToday(), hotelToday(2), { nationality: 'GB' });
    const indian = await stay(fx, hotelToday(), hotelToday(2), { nationality: 'IN' });
    const nepali = await stay(fx, hotelToday(), hotelToday(2), { nationality: 'NP' });
    for (const id of [foreign.id, indian.id, nepali.id]) {
      expect((await request('POST', `/bookings/${id}/check-in`, { token: fx.token })).status).toBe(
        200,
      );
    }
    const list = await request('GET', `/properties/${fx.propertyId}/form-c`, { token: fx.token });
    expect(list.status).toBe(200);
    expect(list.body.rows.map((r: { bookingId: string }) => r.bookingId)).toEqual([foreign.id]);
    const row = list.body.rows[0];
    expect(row.submitted).toBe(false);
    expect(row.overdue).toBe(false);
    expect(new Date(row.dueAt).getTime() - new Date(row.checkedInAt).getTime()).toBe(24 * 3600_000);

    const filed = await request('POST', `/bookings/${foreign.id}/form-c`, {
      token: fx.token,
      body: { reference: 'FRRO-2026-000123' },
    });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    expect(filed.body.formC).toMatchObject({ status: 'submitted', reference: 'FRRO-2026-000123' });
    const after = await request('GET', `/properties/${fx.propertyId}/form-c`, { token: fx.token });
    expect(after.body.pending).toBe(0);

    const notNeeded = await request('POST', `/bookings/${indian.id}/form-c`, {
      token: fx.token,
      body: { reference: 'X-1' },
    });
    expect(notNeeded.status).toBe(400);
  });
});

describe("Malaysia's guest register", () => {
  it('holds check-in until the register is complete, and names what is missing', async () => {
    const fx = await malaysia({ register: true });
    await openAndPrice(fx, hotelToday(), hotelToday(2), { base: 200 });
    const b = await stay(fx, hotelToday(), hotelToday(1), {
      residency: 'foreign',
      nationality: 'SG',
    });
    const refused = await request('POST', `/bookings/${b.id}/check-in`, { token: fx.token });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('registration_required');
    expect(refused.body.missing).toEqual([
      'Address',
      'Occupation',
      'Sex',
      'ID or passport number',
      'Place of issue',
      'Date of issue',
      'Arrived from',
    ]);

    const db = admin();
    await db
      .update(customers)
      .set({ address: '1 Orchard Road, Singapore', occupation: 'Engineer', gender: 'female' })
      .where(eq(customers.id, b.customerId));
    await db.insert(guestDocuments).values({
      tenantId: fx.tenantId,
      customerId: b.customerId,
      type: 'passport',
      number: 'K1234567A',
      placeOfIssue: 'Singapore',
      issuedOn: '2022-05-01',
      isPrimary: true,
    });
    const reg = await request('PUT', `/bookings/${b.id}/registration`, {
      token: fx.token,
      body: { arrivedFrom: 'Singapore', portOfEntry: 'KLIA' },
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(200);
    expect(reg.body.guestRegister.missing).toEqual([]);
    expect((await request('POST', `/bookings/${b.id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );
  });
});
