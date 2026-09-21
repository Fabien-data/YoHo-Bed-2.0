import { describe, it, expect, afterAll } from 'vitest';
import { StepUpService } from '../src/auth/step-up.service';
import {
  PASSWORD,
  addDeskUser,
  book,
  login,
  makeTenant,
  openAndPrice,
  request,
  startApp,
  stopApp,
} from './harness';

/**
 * Development Phase 02, Sprint 1 — the reservation desk's configuration: property profile and
 * settings, the master lists, the one-call reservation config, owner step-up approval, and the
 * standalone pricing fix.
 */

afterAll(stopApp);

describe('reservation config', () => {
  it('gives the desk everything it needs in one call, on every plan', async () => {
    const fx = await makeTenant({ plan: 'starter' });
    const res = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    expect(res.status).toBe(200);
    const cfg = res.body;

    expect(cfg.property).toMatchObject({
      id: fx.propertyId,
      countryCode: 'LK',
      currency: 'LKR',
      timezone: 'Asia/Colombo',
      checkinTime: '14:00',
      checkoutTime: '11:00',
    });
    expect(cfg.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cfg.todaySource).toBe('calendar');
    expect(cfg.settings.rateControl).toEqual({ staffMaxDiscountPct: 0, staffCanComp: false });

    expect(cfg.kinds.map((k: any) => k.label)).toEqual([
      'Confirm Booking',
      'Unconfirmed Booking Inquiry',
      'Online Failed Booking',
      'Hold Confirm Booking',
      'Hold Unconfirm Booking',
    ]);
    expect(cfg.kinds.find((k: any) => k.kind === 'inquiry').holdsInventory).toBe(false);
    expect(cfg.titles).toContain('Ven.');
    expect(cfg.region.cityLedgerLabel).toBe('City Ledger');

    const bdc = cfg.businessSources.find((s: any) => s.shortCode === 'BDC');
    const ota = cfg.marketSegments.find((s: any) => s.code === 'OTA');
    expect(bdc).toMatchObject({ category: 'ota', defaultMarketSegmentId: ota.id });
    expect(cfg.paymentMethods.map((m: any) => m.code)).toContain('LANKAQR');
    expect(cfg.paymentMethods.filter((m: any) => m.isDefaultCash)).toHaveLength(1);
    expect(cfg.salesPersons).toEqual([]);
  });

  it('is readable by desk staff and follows the property country', async () => {
    const fx = await makeTenant({ country: 'IN' });
    const desk = await addDeskUser(fx);
    const res = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: desk.token,
    });
    expect(res.status).toBe(200);
    expect(res.body.titles).toContain('Smt.');
    expect(res.body.region.cityLedgerLabel).toBe('Bill to Company (BTC)');
    expect(res.body.paymentMethods.map((m: any) => m.code)).toContain('UPI');
    expect(res.body.businessSources.map((s: any) => s.shortCode)).toContain('MMT');
  });

  it('never shows another tenant’s property', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const res = await request('GET', `/properties/${b.propertyId}/reservation-config`, {
      token: a.token,
    });
    expect(res.status).toBe(404);
  });
});

describe('business sources', () => {
  it('lets the owner add, recategorise and deactivate a source', async () => {
    const fx = await makeTenant();
    const segments = await request('GET', '/market-segments', { token: fx.token });
    const whs = segments.body.find((s: any) => s.code === 'WHS');

    const created = await request('POST', '/business-sources', {
      token: fx.token,
      body: {
        shortCode: 'jet',
        name: 'Jetwing Travels',
        category: 'travel_agent',
        palette: 'violet',
        defaultMarketSegmentId: whs.id,
        commissionPlan: 'pct_all_nights',
        commissionValue: 10,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      shortCode: 'JET',
      category: 'travel_agent',
      palette: 'violet',
      commissionPlan: 'pct_all_nights',
      defaultMarketSegmentId: whs.id,
    });
    expect(Number(created.body.commissionValue)).toBe(10);

    const updated = await request('PATCH', `/business-sources/${created.body.id}`, {
      token: fx.token,
      body: { palette: 'teal', active: false },
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      palette: 'teal',
      active: false,
      category: 'travel_agent',
    });

    const cfg = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    expect(cfg.body.businessSources.map((s: any) => s.shortCode)).not.toContain('JET');
  });

  it('validates what an owner types', async () => {
    const fx = await makeTenant();
    const bad = async (body: object) =>
      (await request('POST', '/business-sources', { token: fx.token, body })).status;
    expect(await bad({ shortCode: 'X1', name: 'Bad palette', palette: '#ff0000' })).toBe(400);
    expect(await bad({ shortCode: 'X2', name: 'Bad category', category: 'friend' })).toBe(400);
    expect(await bad({ shortCode: 'X 3', name: 'Space in code' })).toBe(400);
    expect(
      await bad({
        shortCode: 'X4',
        name: 'Too much commission',
        commissionPlan: 'pct_first_night',
        commissionValue: 150,
      }),
    ).toBe(400);
    // A seeded code is taken.
    expect(await bad({ shortCode: 'bdc', name: 'Booking again' })).toBe(409);
  });

  it('refuses another tenant’s segment as a default', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const theirs = (await request('GET', '/market-segments', { token: b.token })).body[0];
    const res = await request('POST', '/business-sources', {
      token: a.token,
      body: { shortCode: 'SNEAK', name: 'Sneaky', defaultMarketSegmentId: theirs.id },
    });
    expect(res.status).toBe(404);

    const mine = (await request('GET', '/business-sources', { token: a.token })).body[0];
    const cross = await request('PATCH', `/business-sources/${mine.id}`, {
      token: b.token,
      body: { name: 'Hijacked' },
    });
    expect(cross.status).toBe(404);
  });

  it('keeps writes for the owner while desk staff can still read', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const read = await request('GET', '/business-sources', { token: desk.token });
    expect(read.status).toBe(200);
    expect(read.body.length).toBeGreaterThan(0);

    const write = await request('POST', '/business-sources', {
      token: desk.token,
      body: { shortCode: 'DESK', name: 'Desk tried' },
    });
    expect(write.status).toBe(403);
  });
});

describe('market segments and payment methods', () => {
  it('manages market segments', async () => {
    const fx = await makeTenant();
    const created = await request('POST', '/market-segments', {
      token: fx.token,
      body: { code: 'yoga', name: 'Yoga Retreats', group: 'group', palette: 'lime' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ code: 'YOGA', grp: 'group', excludedFromSold: false });

    const updated = await request('PATCH', `/market-segments/${created.body.id}`, {
      token: fx.token,
      body: { name: 'Wellness Retreats', excludedFromSold: true },
    });
    expect(updated.body).toMatchObject({ name: 'Wellness Retreats', excludedFromSold: true });

    const bad = await request('POST', '/market-segments', {
      token: fx.token,
      body: { code: 'VIP', name: 'VIP', group: 'vip' },
    });
    expect(bad.status).toBe(400);
  });

  it('keeps exactly one default cash method', async () => {
    const fx = await makeTenant();
    const created = await request('POST', '/payment-methods', {
      token: fx.token,
      body: {
        code: 'cashgbp',
        name: 'Cash (GBP)',
        shortName: 'Cash GBP',
        category: 'cash',
        currency: 'GBP',
        isDefaultCash: true,
      },
    });
    expect(created.status).toBe(201);

    const methods = (await request('GET', '/payment-methods', { token: fx.token })).body;
    const defaults = methods.filter((m: any) => m.isDefaultCash);
    expect(defaults.map((m: any) => m.code)).toEqual(['CASHGBP']);

    const lkr = methods.find((m: any) => m.code === 'CASH');
    const back = await request('PATCH', `/payment-methods/${lkr.id}`, {
      token: fx.token,
      body: { isDefaultCash: true },
    });
    expect(back.status).toBe(200);
    const after = (await request('GET', '/payment-methods', { token: fx.token })).body;
    expect(after.filter((m: any) => m.isDefaultCash).map((m: any) => m.code)).toEqual(['CASH']);
  });

  it('refuses a non-cash default, an unknown category and a foreign property', async () => {
    const fx = await makeTenant();
    const other = await makeTenant();
    const post = async (body: object) =>
      (await request('POST', '/payment-methods', { token: fx.token, body })).status;
    expect(
      await post({ code: 'Q', name: 'Q', shortName: 'Q', category: 'qr', isDefaultCash: true }),
    ).toBe(400);
    expect(await post({ code: 'B', name: 'B', shortName: 'B', category: 'bitcoin' })).toBe(400);
    expect(
      await post({
        code: 'P',
        name: 'P',
        shortName: 'P',
        category: 'card',
        propertyId: other.propertyId,
      }),
    ).toBe(404);
    expect(await post({ code: 'upi', name: 'UPI', shortName: 'UPI', category: 'qr' })).toBe(201);
    expect(await post({ code: 'UPI', name: 'UPI again', shortName: 'UPI', category: 'qr' })).toBe(
      409,
    );
  });
});

describe('sales persons', () => {
  it('are managed on every plan and offered to the reservation form', async () => {
    const fx = await makeTenant({ plan: 'starter' });
    const created = await request('POST', '/sales-persons', {
      token: fx.token,
      body: { code: 'sp-01', name: 'Nimali Perera', mobile: '+94771234567', countryCode: 'lk' },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: 'sales_person', code: 'SP-01', countryCode: 'LK' });

    const list = await request('GET', '/sales-persons', { token: fx.token });
    expect(list.body.map((s: any) => s.name)).toEqual(['Nimali Perera']);

    const cfg = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    expect(cfg.body.salesPersons.map((s: any) => s.code)).toEqual(['SP-01']);

    const off = await request('PATCH', `/sales-persons/${created.body.id}`, {
      token: fx.token,
      body: { active: false },
    });
    expect(off.body.active).toBe(false);
    const cfg2 = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    expect(cfg2.body.salesPersons).toEqual([]);
  });

  it('stores a locally typed mobile number in international form', async () => {
    const fx = await makeTenant();
    const created = await request('POST', '/sales-persons', {
      token: fx.token,
      body: { code: 'SP-LOCAL', name: 'Kasun Silva', mobile: '077 123 4567', phone: 'ext 204' },
    });
    expect(created.status).toBe(201);
    expect(created.body.mobile).toBe('+94771234567');
    // Something that is not a phone number is kept as typed rather than silently dropped.
    expect(created.body.phone).toBe('ext 204');
  });

  it('cannot be used to edit a company account', async () => {
    const fx = await makeTenant();
    const company = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { type: 'company', code: 'ACME', name: 'Acme Ltd' },
    });
    const res = await request('PATCH', `/sales-persons/${company.body.id}`, {
      token: fx.token,
      body: { name: 'Renamed' },
    });
    expect(res.status).toBe(404);
  });
});

describe('country presets', () => {
  it('adds a country’s missing entries and is safe to repeat', async () => {
    const fx = await makeTenant();
    const first = await request('POST', '/configuration/apply-preset', {
      token: fx.token,
      body: { country: 'MY' },
    });
    expect(first.status).toBe(200);
    expect(first.body.businessSources).toBe(2);
    expect(first.body.paymentMethods).toBeGreaterThan(0);

    const again = await request('POST', '/configuration/apply-preset', {
      token: fx.token,
      body: { country: 'MY' },
    });
    expect(again.body).toEqual({ marketSegments: 0, businessSources: 0, paymentMethods: 0 });

    const methods = (await request('GET', '/payment-methods', { token: fx.token })).body;
    expect(methods.map((m: any) => m.code)).toEqual(expect.arrayContaining(['DUITNOWQR', 'FPX']));
  });

  it('is owner-only', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const res = await request('POST', '/configuration/apply-preset', {
      token: desk.token,
      body: { country: 'IN' },
    });
    expect(res.status).toBe(403);
  });

  it('seeds a newly registered tenant', async () => {
    const email = `cfg-${Date.now().toString(36)}-${process.pid}@test.yohobed.local`;
    await request('POST', '/auth/register', {
      body: { ownerName: 'Seeded', businessName: 'Seeded Villa', email, password: PASSWORD },
    });
    const token = await login(email);
    const sources = await request('GET', '/business-sources', { token });
    expect(sources.status).toBe(200);
    expect(sources.body.map((s: any) => s.shortCode)).toEqual(
      expect.arrayContaining(['WLK', 'BDC', 'AGD']),
    );
  });
});

describe('property profile', () => {
  it('stores the property setup details and map coordinates', async () => {
    const fx = await makeTenant();
    const path = `/properties/${fx.propertyId}/profile`;
    const saved = await request('PATCH', path, {
      token: fx.token,
      body: {
        propertyType: 'Hotel',
        starRating: 4,
        address: 'Cemetery Road',
        addressLine2: 'Near the beach',
        city: 'Negombo',
        reservationPhone: '+94771234567',
        website: 'https://example.com',
        fax: '+94112345678',
        registrationNumber: 'REG-001',
        additionalRegistrationNumbers: ['A1', '', 'A3', ''],
        latitude: 7.2083,
        longitude: 79.8358,
      },
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      propertyType: 'Hotel',
      starRating: 4,
      addressLine2: 'Near the beach',
      reservationPhone: '+94771234567',
      website: 'https://example.com',
      fax: '+94112345678',
      registrationNumber: 'REG-001',
      additionalRegistrationNumbers: ['A1', '', 'A3', ''],
      latitude: 7.2083,
      longitude: 79.8358,
    });

    const patch = async (body: object) =>
      (await request('PATCH', path, { token: fx.token, body })).status;
    expect(await patch({ latitude: null })).toBe(400);
    expect(await patch({ longitude: 181 })).toBe(400);
    expect(await patch({ website: 'javascript:alert(1)' })).toBe(400);
    expect(await patch({ logoMediaId: '00000000-0000-4000-8000-000000000000' })).toBe(400);
    expect(await patch({ propertyType: 'Castle' })).toBe(400);
    expect(await patch({ latitude: null, longitude: null })).toBe(200);
  });

  it('stores the regional identity and registration numbers', async () => {
    const fx = await makeTenant();
    const res = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: {
        legalName: 'Lakeside Hotels (Pvt) Ltd',
        stateCode: 'LK-1',
        city: 'Colombo',
        checkinTime: '13:30',
        taxIds: { tin: '123456789', sltdaRegNo: 'sltda/2024/99' },
        branchCode: 'BR03',
        invoicePrefix: 'CLH',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      legalName: 'Lakeside Hotels (Pvt) Ltd',
      stateCode: 'LK-1',
      checkinTime: '13:30:00',
      taxIds: { tin: '123456789', sltdaRegNo: 'SLTDA/2024/99' },
      branchCode: 'BR03',
    });

    // Clearing one number keeps the other.
    const cleared = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { taxIds: { sltdaRegNo: '' } },
    });
    expect(cleared.body.taxIds).toEqual({ tin: '123456789' });

    const cfg = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    expect(cfg.body.property.checkinTime).toBe('13:30');
    expect(cfg.body.property.legalName).toBe('Lakeside Hotels (Pvt) Ltd');
  });

  it('validates registration numbers, states and times', async () => {
    const fx = await makeTenant();
    const patch = async (body: object) =>
      (await request('PATCH', `/properties/${fx.propertyId}/profile`, { token: fx.token, body }))
        .status;
    expect(await patch({ taxIds: { tin: '12345' } })).toBe(400);
    expect(await patch({ taxIds: { gstin: 'NOT-A-GSTIN' } })).toBe(400);
    expect(await patch({ stateCode: 'MY-10' })).toBe(400);
    expect(await patch({ checkinTime: '25:00' })).toBe(400);
    expect(await patch({ timezone: 'Mars/Olympus' })).toBe(400);
    expect(await patch({ countryCode: 'ZZ' })).toBe(400);
    expect(await patch({ commissionPercentage: 0 })).toBe(400);
  });

  it('lets the country change until the first booking, then locks it', async () => {
    const fx = await makeTenant();
    const moved = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { countryCode: 'in', stateCode: '32', timezone: 'Asia/Kolkata' },
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ countryCode: 'IN', stateCode: '32' });

    // Changing the country without a state clears the old one.
    const back = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { countryCode: 'LK' },
    });
    expect(back.body).toMatchObject({ countryCode: 'LK', stateCode: null });

    await openAndPrice(fx, '2031-01-10', '2031-01-12');
    expect((await book(fx, { checkin: '2031-01-10', checkout: '2031-01-11' })).status).toBe(201);

    const locked = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { countryCode: 'MY' },
    });
    expect(locked.status).toBe(409);
    expect(locked.body.reason).toBe('country_locked');

    // Other profile fields are still editable.
    const ok = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: fx.token,
      body: { countryCode: 'LK', city: 'Kandy' },
    });
    expect(ok.status).toBe(200);
  });

  it('is owner-only', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const res = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      token: desk.token,
      body: { city: 'Galle' },
    });
    expect(res.status).toBe(403);
  });
});

describe('property settings', () => {
  it('returns defaults and merges partial updates', async () => {
    const fx = await makeTenant();
    const initial = await request('GET', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
    });
    expect(initial.body).toMatchObject({
      timeFormat: '12h',
      unconfirmedPolicy: 'never',
      hold: { defaultHours: 24, reminderHours: 6 },
    });

    const first = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: { rateControl: { staffMaxDiscountPct: 10 }, hold: { defaultHours: 48 } },
    });
    expect(first.status).toBe(200);
    expect(first.body.rateControl).toEqual({ staffMaxDiscountPct: 10, staffCanComp: false });
    expect(first.body.hold).toEqual({ defaultHours: 48, reminderHours: 6 });

    const second = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      token: fx.token,
      body: {
        rateControl: { staffCanComp: true },
        kindOverrides: { inquiry: { label: 'Tentative', color: 'violet' } },
        mealCodeStyle: 'indian',
      },
    });
    expect(second.body.rateControl).toEqual({ staffMaxDiscountPct: 10, staffCanComp: true });
    expect(second.body.hold.defaultHours).toBe(48);

    const cfg = await request('GET', `/properties/${fx.propertyId}/reservation-config`, {
      token: fx.token,
    });
    const inquiry = cfg.body.kinds.find((k: any) => k.kind === 'inquiry');
    expect(inquiry).toMatchObject({ label: 'Tentative', color: 'violet', holdsInventory: false });
    expect(cfg.body.settings.mealCodeStyle).toBe('indian');
  });

  it('rejects unknown or out-of-range settings, and desk users', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const patch = async (body: object, token = fx.token) =>
      (await request('PATCH', `/properties/${fx.propertyId}/settings`, { token, body })).status;
    expect(await patch({ rateControl: { staffMaxDiscountPct: 120 } })).toBe(400);
    expect(await patch({ kindOverrides: { inquiry: { color: '#ff00ff' } } })).toBe(400);
    expect(await patch({ kindOverrides: { vip: { label: 'VIP' } } })).toBe(400);
    expect(await patch({ holdsInventory: true })).toBe(400);
    expect(await patch({ timeFormat: '24h' }, desk.token)).toBe(403);
  });
});

describe('owner step-up approval', () => {
  it('issues a single-action approval to a desk user when an owner signs', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const res = await request('POST', '/auth/step-up', {
      token: desk.token,
      body: {
        email: fx.email,
        password: PASSWORD,
        action: 'rate_override',
        reason: 'Repeat guest',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('rate_override');
    expect(res.body.approver.email).toBe(fx.email);
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());

    const app = await startApp();
    const stepUp = app.get(StepUpService);
    const verified = await stepUp.verify(res.body.approvalToken, {
      tenantId: fx.tenantId,
      action: 'rate_override',
      requesterId: desk.userId,
    });
    expect(verified.approverId).toBe(fx.userId);

    // The same approval must not unlock anything else, for anyone else, anywhere else.
    await expect(
      stepUp.verify(res.body.approvalToken, {
        tenantId: fx.tenantId,
        action: 'complimentary',
        requesterId: desk.userId,
      }),
    ).rejects.toThrow();
    await expect(
      stepUp.verify(res.body.approvalToken, {
        tenantId: fx.tenantId,
        action: 'rate_override',
        requesterId: fx.userId,
      }),
    ).rejects.toThrow();
    await expect(
      stepUp.verify('not-a-token', {
        tenantId: fx.tenantId,
        action: 'rate_override',
        requesterId: desk.userId,
      }),
    ).rejects.toThrow();
  });

  it('refuses a desk user’s own credentials and a wrong password', async () => {
    const fx = await makeTenant();
    const desk = await addDeskUser(fx);
    const self = await request('POST', '/auth/step-up', {
      token: desk.token,
      body: { email: desk.email, password: PASSWORD, action: 'complimentary' },
    });
    expect(self.status).toBe(403);

    const wrong = await request('POST', '/auth/step-up', {
      token: desk.token,
      body: { email: fx.email, password: 'not-the-password', action: 'complimentary' },
    });
    expect(wrong.status).toBe(401);
  });

  it('refuses an owner of a different tenant', async () => {
    const fx = await makeTenant();
    const other = await makeTenant();
    const desk = await addDeskUser(fx);
    const res = await request('POST', '/auth/step-up', {
      token: desk.token,
      body: { email: other.email, password: PASSWORD, action: 'tax_exempt' },
    });
    expect(res.status).toBe(403);
  });

  it('cannot be used as a sign-in token', async () => {
    const fx = await makeTenant();
    const res = await request('POST', '/auth/step-up', {
      token: fx.token,
      body: { email: fx.email, password: PASSWORD, action: 'rate_override' },
    });
    const misuse = await request('GET', '/business-sources', { token: res.body.approvalToken });
    expect(misuse.status).toBe(401);
  });
});

describe('standalone pricing', () => {
  it('stores a standalone hotel’s rate exactly as entered, with no commission or gross-up', async () => {
    const fx = await makeTenant({ distributionMode: 'standalone' });
    await openAndPrice(fx, '2031-03-01', '2031-03-02', { base: 1024.13 });
    const rates = await request('GET', `/rooms/${fx.roomId}/rates?from=2031-03-01&to=2031-03-02`, {
      token: fx.token,
    });
    expect(rates.status).toBe(200);
    expect(rates.body).toHaveLength(2);
    for (const r of rates.body) {
      expect(r.basePrice).toBe('1024.13');
      expect(r.commission).toBe('0.00');
      expect(r.sellingPrice).toBe('1024.13');
    }

    const booked = await book(fx, { checkin: '2031-03-01', checkout: '2031-03-03' });
    expect(booked.status).toBe(201);
    expect(Number(booked.body.amount)).toBeCloseTo(2048.26, 2);
  });

  it('leaves a YoHo-distributed hotel’s pricing unchanged', async () => {
    const fx = await makeTenant({ commissionPercentage: 10 });
    await openAndPrice(fx, '2031-03-01', '2031-03-01', { base: 1000 });
    const rates = await request('GET', `/rooms/${fx.roomId}/rates?from=2031-03-01&to=2031-03-01`, {
      token: fx.token,
    });
    // base 1000 → commission roundUp(1000/0.9 − 1000) = 111.12 → selling roundUp(1111.12/0.82).
    expect(rates.body[0].commission).toBe('111.12');
    expect(rates.body[0].sellingPrice).toBe('1355.03');
  });
});
