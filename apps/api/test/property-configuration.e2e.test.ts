import { describe, it, expect, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  addDeskUser,
  addUnits,
  admin,
  hotelToday,
  makeTenant,
  openAndPrice,
  request,
  reserve,
  stopApp,
  type TenantFixture,
} from './harness';

/**
 * Configuration, Yanolja style (owner brief, 2026-09-26): Room types with their Yanolja fields,
 * the hotel's Rate types and Rate plans, Taxes tax by tax, the Hotel Profile's other tabs, and the
 * short Settings lists — Holidays, Guest attributes, Discounts, saved Remarks and Payouts.
 */
afterAll(stopApp);

const CHECKIN = '2028-06-02';
const CHECKOUT = '2028-06-04';

const as = (fx: TenantFixture) => ({ token: fx.token });

describe('room types', () => {
  it('keeps the Yanolja fields, in the hotel’s own order', async () => {
    const fx = await makeTenant();
    const created = await request('POST', `/properties/${fx.propertyId}/rooms`, {
      ...as(fx),
      body: {
        name: 'Double',
        quantity: 4,
        shortCode: 'dbl',
        baseAdults: 2,
        baseChildren: 1,
        maxAdults: 2,
        maxChildren: 1,
        bedTypes: ['queen', 'twin', 'queen'],
        amenities: ['air_conditioning', 'balcony'],
        color: 'teal',
        description: 'Garden-facing double rooms.',
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      shortCode: 'DBL',
      baseAdults: 2,
      maxChildren: 1,
      bedTypes: ['queen', 'twin'],
      amenities: ['air_conditioning', 'balcony'],
      color: 'teal',
      active: true,
    });

    // New types go to the end; the order can be set by hand. The counts are each type's own.
    await addUnits(fx, fx.roomId, ['101', '102']);
    const list = await request('GET', `/properties/${fx.propertyId}/rooms`, as(fx));
    expect(list.body.map((r: { name: string }) => r.name)).toEqual(['E2E Room', 'Double']);
    expect(list.body[0]).toMatchObject({ units: 2, ratePlans: 1, booked: false });
    expect(list.body[1]).toMatchObject({ units: 0, ratePlans: 0, booked: false });
    const reordered = await request('PUT', `/properties/${fx.propertyId}/rooms/order`, {
      ...as(fx),
      body: { ids: [created.body.id, fx.roomId] },
    });
    expect(reordered.status, JSON.stringify(reordered.body)).toBe(200);
    const after = await request('GET', `/properties/${fx.propertyId}/rooms`, as(fx));
    expect(after.body.map((r: { name: string }) => r.name)).toEqual(['Double', 'E2E Room']);
  });

  it('refuses a duplicate short code, a base above the maximum and an unknown amenity', async () => {
    const fx = await makeTenant();
    const make = (body: Record<string, unknown>) =>
      request('POST', `/properties/${fx.propertyId}/rooms`, {
        ...as(fx),
        body: { name: 'Suite', quantity: 1, ...body },
      });
    expect((await make({ shortCode: 'STE' })).status).toBe(201);
    const dupe = await make({ shortCode: 'ste' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.message).toMatch(/short code/i);
    expect((await make({ baseAdults: 3, maxAdults: 2 })).status).toBe(400);
    expect((await make({ amenities: ['helipad'] })).status).toBe(400);
  });

  it('stops selling a room type switched off, and holds a stay to its maximum guests', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2028-06-01', '2028-06-10');
    const line = { roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 3 };
    await request('PATCH', `/rooms/${fx.roomId}`, { ...as(fx), body: { maxAdults: 2 } });
    const tooMany = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Three Adults' },
      lines: [line],
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toMatch(/at most 2 adults/);

    await request('PATCH', `/rooms/${fx.roomId}`, { ...as(fx), body: { active: false } });
    const grid = await request(
      'GET',
      `/properties/${fx.propertyId}/room-availability?checkin=${CHECKIN}&checkout=${CHECKOUT}`,
      as(fx),
    );
    expect(grid.body.roomTypes).toHaveLength(0);
    const off = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Off Type' },
      lines: [{ ...line, adults: 2 }],
    });
    expect(off.status).toBe(400);
    expect(off.body.message).toMatch(/not being sold/);
  });

  it('deletes a room type never booked, and refuses one with bookings', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2028-06-01', '2028-06-10');
    const spare = await request('POST', `/properties/${fx.propertyId}/rooms`, {
      ...as(fx),
      body: { name: 'Spare', quantity: 1 },
    });
    expect((await request('DELETE', `/rooms/${spare.body.id}`, as(fx))).status).toBe(200);

    const b = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Keeps It' },
      lines: [{ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 }],
    });
    expect(b.status).toBe(201);
    const refused = await request('DELETE', `/rooms/${fx.roomId}`, as(fx));
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('room_type_booked');

    // Only the owner deletes.
    const desk = await addDeskUser(fx);
    expect((await request('DELETE', `/rooms/${spare.body.id}`, { token: desk.token })).status).toBe(
      403,
    );
  });
});

describe('rate types and rate plans', () => {
  it('sells a room type under the hotel’s rate type, with its add-ons included in the price', async () => {
    const fx = await makeTenant();
    const type = await request('POST', `/properties/${fx.propertyId}/rate-types`, {
      ...as(fx),
      body: {
        name: 'Honeymoon package',
        shortCode: 'honey',
        mealPlan: 'HB',
        addOns: [{ name: 'Airport pick-up', amount: 6000, rhythm: 'once' }],
      },
    });
    expect(type.status, JSON.stringify(type.body)).toBe(201);
    expect(type.body).toMatchObject({ shortCode: 'HONEY', mealPlan: 'HB' });
    expect(type.body.addOns[0]).toMatchObject({ name: 'Airport pick-up', amount: '6000.00' });

    const plan = await request('POST', `/properties/${fx.propertyId}/rate-plans`, {
      ...as(fx),
      body: { roomId: fx.roomId, rateTypeId: type.body.id },
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    expect(plan.body.occupancies).toHaveLength(1);
    const occupancyId = plan.body.occupancies[0].id;

    // The same room type under the same rate type twice is refused.
    const again = await request('POST', `/properties/${fx.propertyId}/rate-plans`, {
      ...as(fx),
      body: { roomId: fx.roomId, rateTypeId: type.body.id },
    });
    expect(again.status).toBe(409);

    const list = await request('GET', `/properties/${fx.propertyId}/rate-plans`, as(fx));
    const mine = list.body.find((p: { id: string }) => p.id === plan.body.id);
    expect(mine).toMatchObject({ rateTypeCode: 'HONEY', mealPlan: 'HB', roomName: 'E2E Room' });

    // Priced and booked: the add-on is on the stay, included, never charged again.
    await request('POST', `/rooms/${fx.roomId}/availability`, {
      ...as(fx),
      body: { from: '2028-06-01', to: '2028-06-10', roomsToSell: 5, status: 'Open' },
    });
    await request('POST', `/occupancies/${occupancyId}/price`, {
      ...as(fx),
      body: { from: '2028-06-01', to: '2028-06-10', base: 30000 },
    });
    const grid = await request(
      'GET',
      `/properties/${fx.propertyId}/room-availability?checkin=${CHECKIN}&checkout=${CHECKOUT}`,
      as(fx),
    );
    const offered = grid.body.roomTypes[0].rateTypes.find(
      (t: { occupancyId: string }) => t.occupancyId === occupancyId,
    );
    expect(offered).toMatchObject({ rateTypeCode: 'HONEY', rateTypeName: 'Honeymoon package' });

    const booked = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Newly Weds' },
      lines: [{ roomId: fx.roomId, occupancyId, adults: 2 }],
    });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    const inclusions = await request(
      'GET',
      `/bookings/${booked.body.bookings[0].id}/inclusions`,
      as(fx),
    );
    expect(inclusions.body).toEqual([
      expect.objectContaining({ name: 'Airport pick-up', includedInRate: true, rhythm: 'once' }),
    ]);

    // Once booked, the meal plan is history and cannot change; deleting it is refused too.
    const change = await request('PATCH', `/rate-types/${type.body.id}`, {
      ...as(fx),
      body: { mealPlan: 'FB' },
    });
    expect(change.status).toBe(409);
    expect((await request('DELETE', `/rate-types/${type.body.id}`, as(fx))).status).toBe(409);
    // Renaming is fine.
    const renamed = await request('PATCH', `/rate-types/${type.body.id}`, {
      ...as(fx),
      body: { name: 'Honeymoon' },
    });
    expect(renamed.body.name).toBe('Honeymoon');
  });

  it('gives a plan made the old way the rate type of its meal plan', async () => {
    const fx = await makeTenant();
    const codes = await request('GET', '/rate-codes', as(fx));
    const hb = codes.body.find((c: { code: string }) => c.code === 'HB');
    const plan = await request('POST', `/rooms/${fx.roomId}/rate-plans`, {
      ...as(fx),
      body: { rateCodeId: hb.id },
    });
    expect(plan.status).toBe(201);
    expect(plan.body.rateTypeId).toBeTruthy();
    const types = await request('GET', `/properties/${fx.propertyId}/rate-types`, as(fx));
    expect(types.body.find((t: { id: string }) => t.id === plan.body.rateTypeId)).toMatchObject({
      shortCode: 'HB',
      mealPlan: 'HB',
    });
  });

  it('manages a plan’s guest configurations, keeping at least one', async () => {
    const fx = await makeTenant();
    const type = await request('POST', `/properties/${fx.propertyId}/rate-types`, {
      ...as(fx),
      body: { name: 'Room only', shortCode: 'RO2', mealPlan: 'RO' },
    });
    const plan = await request('POST', `/properties/${fx.propertyId}/rate-plans`, {
      ...as(fx),
      body: {
        roomId: fx.roomId,
        rateTypeId: type.body.id,
        occupancies: [{ label: 'Double', accommodates: 2 }],
      },
    });
    const triple = await request('POST', `/rate-plans/${plan.body.id}/guest-configurations`, {
      ...as(fx),
      body: { label: 'Triple', accommodates: 3 },
    });
    expect(triple.status).toBe(201);
    const renamed = await request('PATCH', `/occupancies/${triple.body.id}`, {
      ...as(fx),
      body: { label: 'Family' },
    });
    expect(renamed.body.label).toBe('Family');
    expect((await request('DELETE', `/occupancies/${triple.body.id}`, as(fx))).status).toBe(200);
    const last = await request('DELETE', `/occupancies/${plan.body.occupancies[0].id}`, as(fx));
    expect(last.status).toBe(400);
    expect((await request('DELETE', `/rate-plans/${plan.body.id}`, as(fx))).status).toBe(200);
  });
});

describe('the short lists', () => {
  it('keeps holidays per property, and repeats a yearly one in every year it falls', async () => {
    const fx = await makeTenant();
    const url = `/configuration/lists/holidays?propertyId=${fx.propertyId}`;
    const poya = await request('POST', url, {
      ...as(fx),
      body: { date: '2027-12-24', name: 'Unduvap Poya' },
    });
    expect(poya.status, JSON.stringify(poya.body)).toBe(201);
    await request('POST', url, {
      ...as(fx),
      body: { date: '2026-02-04', name: 'Independence Day', recurring: true },
    });
    const dupe = await request('POST', url, {
      ...as(fx),
      body: { date: '2027-12-24', name: 'Unduvap Poya' },
    });
    expect(dupe.status).toBe(409);

    const range = await request(
      'GET',
      `/properties/${fx.propertyId}/holidays?from=2027-01-01&to=2028-12-31`,
      as(fx),
    );
    expect(range.body.map((h: { date: string; name: string }) => `${h.date} ${h.name}`)).toEqual([
      '2027-02-04 Independence Day',
      '2027-12-24 Unduvap Poya',
      '2028-02-04 Independence Day',
    ]);
    expect((await request('GET', '/configuration/lists/holidays', as(fx))).status).toBe(400);
  });

  it('labels a guest with the hotel’s attributes', async () => {
    const fx = await makeTenant();
    const make = (name: string, color: string) =>
      request('POST', '/configuration/lists/guest-attributes', {
        ...as(fx),
        body: { name, color },
      });
    const repeat = await make('Repeat guest', 'green');
    const allergy = await make('Nut allergy', 'red');
    expect((await make('repeat GUEST', 'blue')).status).toBe(409);

    const [guest] = (await admin().execute(sql`
      insert into customers (tenant_id, name) values (${fx.tenantId}, 'Label Me') returning id
    `)) as unknown as Array<{ id: string }>;
    const set = await request('PUT', `/customers/${guest!.id}/attributes`, {
      ...as(fx),
      body: { attributeIds: [allergy.body.id, repeat.body.id] },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body.map((a: { name: string }) => a.name)).toEqual(['Repeat guest', 'Nut allergy']);

    // Deleting an attribute takes it off the guest too.
    await request('DELETE', `/configuration/lists/guest-attributes/${allergy.body.id}`, as(fx));
    const left = await request('GET', `/customers/${guest!.id}/attributes`, as(fx));
    expect(left.body.map((a: { name: string }) => a.name)).toEqual(['Repeat guest']);
  });

  it('keeps discounts in range, per property', async () => {
    const fx = await makeTenant();
    const url = `/configuration/lists/discounts?propertyId=${fx.propertyId}`;
    const staff = await request('POST', url, {
      ...as(fx),
      body: { code: 'staff', name: 'Staff', kind: 'percent', value: 20 },
    });
    expect(staff.status).toBe(201);
    expect(staff.body).toMatchObject({ code: 'STAFF', value: '20.00' });
    expect(
      (await request('POST', url, { ...as(fx), body: { code: 'TOO', name: 'Too', value: 120 } }))
        .status,
    ).toBe(400);
    const flat = await request('POST', url, {
      ...as(fx),
      body: { code: 'LONG', name: 'Long stay', kind: 'amount', value: 1500 },
    });
    expect(flat.body.value).toBe('1500.00');
    const off = await request('PATCH', `/configuration/lists/discounts/${staff.body.id}`, {
      ...as(fx),
      body: { active: false },
    });
    expect(off.body.active).toBe(false);
  });

  it('seeds payout reasons, and an expense takes its category from the one picked', async () => {
    const fx = await makeTenant();
    const payouts = await request('GET', '/configuration/lists/payout-types', as(fx));
    expect(payouts.body.map((p: { code: string }) => p.code)).toContain('TAXI');
    const taxi = payouts.body.find((p: { code: string }) => p.code === 'TAXI');
    const expense = await request('POST', `/properties/${fx.propertyId}/expenses`, {
      ...as(fx),
      body: { payee: 'City Cabs', amount: 1800, payoutTypeId: taxi.id },
    });
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);
    expect(expense.body).toMatchObject({ category: 'transport', payoutTypeId: taxi.id });
  });

  it('keeps saved remarks, and only the owner changes any list', async () => {
    const fx = await makeTenant();
    const saved = await request('POST', '/configuration/lists/remarks', {
      ...as(fx),
      body: { type: 'housekeeping', text: 'Extra pillows' },
    });
    expect(saved.status).toBe(201);
    const desk = await addDeskUser(fx);
    // The desk reads them to pick from…
    const read = await request('GET', '/configuration/lists/remarks', { token: desk.token });
    expect(read.body.map((r: { text: string }) => r.text)).toEqual(['Extra pillows']);
    // …but does not change them.
    const refused = await request('POST', '/configuration/lists/remarks', {
      token: desk.token,
      body: { text: 'Mine' },
    });
    expect(refused.status).toBe(403);
    expect((await request('GET', '/configuration/lists/nonsense', as(fx))).status).toBe(400);
  });
});

describe('taxes, tax by tax', () => {
  it('adds a tax, changes its rate from a date, and stops charging it', async () => {
    const fx = await makeTenant();
    const from = hotelToday(10);
    const added = await request('POST', `/properties/${fx.propertyId}/taxes`, {
      ...as(fx),
      body: { name: 'VAT', code: 'VAT', ratePercent: 18, priority: 3 },
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const vat = added.body.taxes.find((t: { name: string }) => t.name === 'VAT');
    expect(vat.rates).toHaveLength(1);

    const changed = await request('PATCH', `/properties/${fx.propertyId}/taxes/${vat.id}`, {
      ...as(fx),
      body: { ratePercent: 15, from },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const rates = changed.body.taxes.find((t: { id: string }) => t.id === vat.id).rates;
    // The old rate runs to the day before; the new one from the date.
    expect(rates.map((r: { ratePercent: number; startDate: string }) => r.ratePercent)).toEqual([
      18, 15,
    ]);
    expect(rates[1].startDate).toBe(from);
    expect(rates[0].endDate < from).toBe(true);

    const removed = await request('DELETE', `/properties/${fx.propertyId}/taxes/${vat.id}`, as(fx));
    expect(removed.status).toBe(200);
    expect(removed.body.taxes).toHaveLength(0);
  });
});

describe('the hotel profile and meal plans', () => {
  it('saves the profile’s other tabs, cleaned', async () => {
    const fx = await makeTenant();
    const res = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      ...as(fx),
      body: {
        description: 'A lakeside hotel.',
        highlights: ['Lake view', 'Lake view', 'Free Wi-Fi'],
        amenities: ['pool', 'wifi'],
        policies: { cancellation: '  Free until 48 hours before.  ', pets: '' },
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      description: 'A lakeside hotel.',
      highlights: ['Lake view', 'Free Wi-Fi'],
      policies: { cancellation: 'Free until 48 hours before.' },
    });
    // Catalogue order, not typing order.
    expect(res.body.amenities).toEqual(['wifi', 'pool']);
    const bad = await request('PATCH', `/properties/${fx.propertyId}/profile`, {
      ...as(fx),
      body: { amenities: ['helipad'] },
    });
    expect(bad.status).toBe(400);
  });

  it('keeps the meal plans the hotel sells, and its own names for them', async () => {
    const fx = await makeTenant();
    const res = await request('PATCH', `/properties/${fx.propertyId}/settings`, {
      ...as(fx),
      body: { mealPlans: { offered: ['RO', 'BB'], names: { BB: 'Bed and breakfast' } } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.mealPlans).toEqual({
      offered: ['RO', 'BB'],
      names: { BB: 'Bed and breakfast' },
    });
  });
});
