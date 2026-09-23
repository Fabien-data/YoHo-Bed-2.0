import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bookings, customers, guestDocuments, payments } from '@yohobed/db';
import {
  addDeskUser,
  addRoomType,
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
 * The Reservations list and the full Add Reservation page (Development Phase 02, Sprint 4):
 * paging, pax, money columns, filters, the group cards, the CSV export, and a booking's guests,
 * remarks, tasks and identity documents.
 */

afterAll(stopApp);

const CHECKIN = '2029-04-10';
const CHECKOUT = '2029-04-12'; // 2 nights
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
  const fx = await makeTenant({ roomQuantity: 10, ...opts });
  await openAndPrice(fx, '2029-04-01', '2029-04-30', { roomsToSell: 10, base: 18000 });
  return fx;
}

function list(fx: TenantFixture, query: string, token = fx.token) {
  return request('GET', `/reservations?propertyId=${fx.propertyId}&date=${CHECKIN}${query}`, {
    token,
  });
}

/** Today in the property's timezone (Asia/Colombo by default). */
function colomboToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
}

describe('the reservations list', () => {
  it('pages on the server and says how many there are', async () => {
    const fx = await ready();
    for (let i = 0; i < 5; i++) {
      const r = await reserve(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guest: { name: `Paging Guest ${i}` },
        lines: [line(fx)],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const first = await list(fx, '&tab=upcoming&limit=2&offset=0');
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(5);
    expect(first.body.rows).toHaveLength(2);
    expect(first.body.counts.upcoming).toBe(5);

    const last = await list(fx, '&tab=upcoming&limit=2&offset=4');
    expect(last.body.rows).toHaveLength(1);
    const seen = new Set([...first.body.rows, ...last.body.rows].map((r: any) => r.id));
    expect(seen.size).toBe(3);
  });

  it('shows pax, room details and who took it, and finds every room by the master reference', async () => {
    const fx = await ready();
    const suite = await addRoomType(fx, {
      name: 'Garden Suite',
      rateCode: 'HB',
      from: '2029-04-01',
      to: '2029-04-30',
    });
    const created = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Pax Perera' },
      lines: [line(fx, { adults: 2, children: 1, childAges: [6] }), line(suite, { adults: 1 })],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const res = await list(fx, `&tab=upcoming&q=${created.body.reference}`);
    expect(res.body.total).toBe(2);
    const [a, b] = res.body.rows;
    expect(a).toMatchObject({
      reference: `${created.body.reference}-1`,
      adults: 2,
      children: 1,
      roomTypeName: 'E2E Room',
      rateCode: 'BB',
      createdByName: 'E2E Owner',
      groupCode: created.body.reference,
    });
    expect(b).toMatchObject({
      adults: 1,
      children: 0,
      roomTypeName: 'Garden Suite',
      rateCode: 'HB',
    });
  });

  it('nets refunds out of Paid and works out the balance', async () => {
    const fx = await ready();
    const created = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Balance Bandara' },
      lines: [line(fx)],
    });
    const bookingId = created.body.bookings[0].id;
    await admin()
      .insert(payments)
      .values([
        {
          tenantId: fx.tenantId,
          bookingId,
          direction: 'received',
          amount: '10000.00',
          currency: 'LKR',
        },
        { tenantId: fx.tenantId, bookingId, direction: 'sent', amount: '2500.00', currency: 'LKR' },
      ]);
    const res = await list(fx, `&tab=upcoming&q=${created.body.reference}`);
    const row = res.body.rows[0];
    expect(row.paid).toBe('7500.00');
    expect(row.total).toBe(created.body.due);
    expect(Number(row.balance)).toBeCloseTo(Number(created.body.due) - 7500, 2);
    expect(row.balanceDue).toBe(true);
  });

  it('filters by type and by who took the reservation, and the tab counts follow', async () => {
    const fx = await ready();
    const desk = await addDeskUser(fx);
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Held Hettiarachchi' },
      kind: 'hold_confirm',
      lines: [line(fx)],
    });
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Inquiring Ismail' },
      kind: 'inquiry',
      lines: [line(fx)],
    });
    await reserve(
      fx,
      { checkin: CHECKIN, checkout: CHECKOUT, guest: { name: 'Desk Dias' }, lines: [line(fx)] },
      { token: desk.token },
    );

    const holds = await list(fx, '&tab=upcoming&kind=holds');
    expect(holds.body.rows.map((r: any) => r.guestName)).toEqual(['Held Hettiarachchi']);
    expect(holds.body.counts.upcoming).toBe(1);

    const inquiries = await list(fx, '&tab=upcoming&kind=inquiry');
    expect(inquiries.body.rows.map((r: any) => r.reservationKind)).toEqual(['inquiry']);

    const byDesk = await list(fx, `&tab=upcoming&createdBy=${desk.userId}`);
    expect(byDesk.body.rows.map((r: any) => r.guestName)).toEqual(['Desk Dias']);
    expect(byDesk.body.rows[0].createdByName).toBe('E2E Desk');
  });

  it("counts what was booked today on the Booked tab, in the hotel's time", async () => {
    const fx = await ready();
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Today Tennakoon' },
      lines: [line(fx)],
    });
    const today = colomboToday();
    const res = await request(
      'GET',
      `/reservations?propertyId=${fx.propertyId}&date=${today}&tab=booked`,
      { token: fx.token },
    );
    expect(res.body.counts.booked).toBe(1);
    expect(res.body.rows[0].guestName).toBe('Today Tennakoon');

    const other = await request(
      'GET',
      `/reservations?propertyId=${fx.propertyId}&date=2029-01-01&tab=booked`,
      { token: fx.token },
    );
    expect(other.body.counts.booked).toBe(0);
  });

  it('never lists another tenant’s reservations', async () => {
    const a = await ready();
    const b = await ready();
    await reserve(b, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Other Tenant' },
      lines: [line(b)],
    });
    const res = await request(
      'GET',
      `/reservations?propertyId=${b.propertyId}&date=${CHECKIN}&tab=upcoming`,
      { token: a.token },
    );
    expect(res.status).toBe(404);
  });
});

describe('the CSV export', () => {
  it('writes every row of the tab, not just one page, with formulas neutralised', async () => {
    const fx = await ready();
    for (const name of ['Export One', 'Export Two', '=HYPERLINK("x")']) {
      await reserve(fx, {
        checkin: CHECKIN,
        checkout: CHECKOUT,
        guest: { name },
        lines: [line(fx)],
      });
    }
    const res = await request(
      'GET',
      `/reservations/export?propertyId=${fx.propertyId}&date=${CHECKIN}&tab=upcoming`,
      { token: fx.token },
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.startsWith('﻿"Reference"')).toBe(true);
    const lines = res.text.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(res.text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(res.text).toContain('"Export Two"');
  });
});

describe('group cards', () => {
  it('adds up a group, and leaves cancelled rooms out of the money', async () => {
    const fx = await ready();
    const created = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Group Gunawardena' },
      voucherNo: 'TA-7781',
      lines: [line(fx, { adults: 2 }), line(fx, { adults: 3, children: 1 })],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const groups = (tab = 'upcoming') =>
      request('GET', `/reservation-groups?propertyId=${fx.propertyId}&date=${CHECKIN}&tab=${tab}`, {
        token: fx.token,
      });

    const res = await groups();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    const card = res.body.rows[0];
    expect(card).toMatchObject({
      code: created.body.reference,
      ownerName: 'Group Gunawardena',
      voucherNo: 'TA-7781',
      roomsTotal: 2,
      roomsLive: 2,
      adults: 5,
      children: 1,
      checkin: CHECKIN,
      checkout: CHECKOUT,
      total: created.body.due,
    });
    expect(Number(card.averageRate)).toBeCloseTo(Number(created.body.due) / 4, 2);

    // Opening the card lists its rooms, whatever the tab says.
    const members = await list(fx, `&tab=departures&groupId=${created.body.groupId}`);
    expect(members.body.rows.map((r: any) => r.reference)).toEqual([
      `${created.body.reference}-1`,
      `${created.body.reference}-2`,
    ]);

    await request('POST', `/bookings/${created.body.bookings[1].id}/cancel`, { token: fx.token });
    const after = (await groups()).body.rows[0];
    expect(after.roomsTotal).toBe(2);
    expect(after.roomsLive).toBe(1);
    expect(after.total).toBe(created.body.bookings[0].amount);
    expect(after.adults).toBe(2);
  });

  it('merges groups into the one whose owner stays, but not once a guest has arrived', async () => {
    const fx = await ready();
    // Arriving today: one guest here really arrives, and a guest is only checked in on the day.
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 10, base: 18000 });
    const make = (name: string) =>
      reserve(fx, {
        checkin: hotelToday(),
        checkout: hotelToday(2),
        guest: { name },
        lines: [line(fx), line(fx)],
      });
    const keep = await make('Keep Karunaratne');
    const fold = await make('Fold Fernando');
    const merged = await request('POST', '/reservation-groups/merge', {
      token: fx.token,
      body: { targetGroupId: keep.body.groupId, groupIds: [fold.body.groupId] },
    });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body.memberCount).toBe(4);
    const gone = await request('GET', `/booking-groups/${fold.body.groupId}`, { token: fx.token });
    expect(gone.status).toBe(404);

    const third = await make('Arrived Abeywickrama');
    const id = third.body.bookings[0].id;
    const [unitId] = await addUnits(fx, fx.roomId, ['G-ARRIVED']);
    const [leg] = (await request('GET', `/bookings/${id}/rooms`, { token: fx.token })).body;
    expect(
      (
        await request('POST', `/bookings/${id}/assign`, {
          token: fx.token,
          body: {
            assignments: [{ legId: leg.id, roomUnitId: unitId, expectedUpdatedAt: leg.updatedAt }],
          },
        })
      ).status,
    ).toBe(200);
    const arrived = await request('POST', `/bookings/${id}/check-in`, { token: fx.token });
    expect(arrived.status, JSON.stringify(arrived.body)).toBe(200);
    const refused = await request('POST', '/reservation-groups/merge', {
      token: fx.token,
      body: { targetGroupId: keep.body.groupId, groupIds: [third.body.groupId] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe('group_arrived');
  });
});

describe('the full reservation: room guests, remarks and tasks', () => {
  it('books each room for its own guest and files the remarks and tasks with it', async () => {
    const fx = await ready();
    // Arriving today, so the check-in task can really be released by a check-in.
    await openAndPrice(fx, hotelToday(), hotelToday(10), { roomsToSell: 10, base: 18000 });
    const [roomUnitId] = await addUnits(fx, fx.roomId, ['OCCASION-101']);
    const created = await reserve(fx, {
      checkin: hotelToday(),
      checkout: hotelToday(2),
      guest: { name: 'Owner Obeyesekere', email: 'owner.o@example.test' },
      remarks: [{ type: 'front_desk', text: 'Late arrival, around 11pm' }],
      lines: [
        line(fx, {
          roomUnitId,
          tasks: [{ title: 'Flowers in the room', department: 'housekeeping', trigger: 'checkin' }],
        }),
        line(fx, {
          guest: { name: 'Room Two Rajapaksa', phone: '0771234567' },
          remarks: [{ type: 'housekeeping', text: 'Extra pillows' }],
        }),
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const [one, two] = created.body.bookings;
    expect(one.guestName).toBe('Owner Obeyesekere');
    expect(two.guestName).toBe('Room Two Rajapaksa');

    const [row2] = await admin().select().from(bookings).where(eq(bookings.id, two.id));
    const [guest2] = await admin()
      .select()
      .from(customers)
      .where(eq(customers.id, row2!.customerId));
    expect(guest2!.mobileE164).toBe('+94771234567');

    const remarks2 = await request('GET', `/bookings/${two.id}/remarks`, { token: fx.token });
    expect(remarks2.body.map((r: any) => r.type).sort()).toEqual(['front_desk', 'housekeeping']);
    const remarks1 = await request('GET', `/bookings/${one.id}/remarks`, { token: fx.token });
    expect(remarks1.body.map((r: any) => r.text)).toEqual(['Late arrival, around 11pm']);

    // The check-in task waits for the guest.
    const tasks = await request('GET', `/properties/${fx.propertyId}/work-orders`, {
      token: fx.token,
    });
    const flowers = tasks.body.find((t: any) => t.title === 'Flowers in the room');
    expect(flowers).toMatchObject({
      department: 'housekeeping',
      trigger: 'checkin',
      waiting: true,
      bookingReference: one.reference,
    });
    const checkedIn = await request('POST', `/bookings/${one.id}/check-in`, { token: fx.token });
    expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
    const later = await request('GET', `/properties/${fx.propertyId}/work-orders`, {
      token: fx.token,
    });
    expect(later.body.find((t: any) => t.id === flowers.id).waiting).toBe(false);
  });

  it('refuses tasks on a plan without work orders, and saves nothing', async () => {
    const fx = await ready({ plan: 'starter' });
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Starter Senanayake' },
      lines: [line(fx, { tasks: [{ title: 'Airport pick-up' }] })],
    });
    expect(res.status).toBe(403);
    const rows = await admin().select().from(bookings).where(eq(bookings.tenantId, fx.tenantId));
    expect(rows).toHaveLength(0);
  });

  it('names the room whose guest clashes with an existing one', async () => {
    const fx = await ready();
    await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Existing Ekanayake', email: 'clash@example.test' },
      lines: [line(fx)],
    });
    const res = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Fine Guest' },
      lines: [line(fx), line(fx, { guest: { name: 'Someone Else', email: 'clash@example.test' } })],
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ reason: 'guest_exists', line: 1 });
  });
});

describe('a booking’s remarks, guests and tasks', () => {
  async function oneBooking(fx: TenantFixture) {
    const r = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Extras Edirisinghe' },
      lines: [line(fx)],
    });
    return r.body.bookings[0].id as string;
  }

  it('lets the author or the owner take a remark back, nobody else', async () => {
    const fx = await ready();
    const desk = await addDeskUser(fx);
    const id = await oneBooking(fx);
    const mine = await request('POST', `/bookings/${id}/remarks`, {
      token: fx.token,
      body: { type: 'accounts', text: 'Company pays room only' },
    });
    expect(mine.status).toBe(201);
    const refused = await request('DELETE', `/booking-remarks/${mine.body.id}`, {
      token: desk.token,
    });
    expect(refused.status).toBe(403);
    const deskRemark = await request('POST', `/bookings/${id}/remarks`, {
      token: desk.token,
      body: { text: 'Guest asked for a quiet room' },
    });
    expect(deskRemark.body.type).toBe('general');
    expect(
      (await request('DELETE', `/booking-remarks/${deskRemark.body.id}`, { token: desk.token }))
        .status,
    ).toBe(200);
    expect(
      (await request('DELETE', `/booking-remarks/${mine.body.id}`, { token: fx.token })).status,
    ).toBe(200);
  });

  it('adds the other people in the room, once each, and never the main guest twice', async () => {
    const fx = await ready();
    const id = await oneBooking(fx);
    const add = (body: Record<string, unknown>) =>
      request('POST', `/bookings/${id}/guests`, { token: fx.token, body });
    const spouse = await add({ name: 'Spouse Edirisinghe', email: 'spouse@example.test' });
    expect(spouse.status).toBe(201);
    // Same email and name: the same person, linked once.
    await add({ name: 'Spouse Edirisinghe', email: 'spouse@example.test' });
    const guests = await request('GET', `/bookings/${id}/guests`, { token: fx.token });
    expect(guests.body.primary.name).toBe('Extras Edirisinghe');
    expect(guests.body.others.map((g: any) => g.name)).toEqual(['Spouse Edirisinghe']);

    const primary = await add({ customerId: guests.body.primary.id });
    expect(primary.status).toBe(409);

    const removed = await request('DELETE', `/bookings/${id}/guests/${spouse.body.customerId}`, {
      token: fx.token,
    });
    expect(removed.status).toBe(200);
  });

  it('keeps tasks behind the Pro plan', async () => {
    const fx = await ready({ plan: 'starter' });
    const id = await oneBooking(fx);
    const res = await request('POST', `/bookings/${id}/tasks`, {
      token: fx.token,
      body: { title: 'Cot in the room' },
    });
    expect(res.status).toBe(403);
    expect(
      (await request('POST', `/bookings/${id}/remarks`, { token: fx.token, body: { text: 'ok' } }))
        .status,
    ).toBe(201);
  });

  it('raises a task for the room the guest is in', async () => {
    const fx = await ready();
    const id = await oneBooking(fx);
    const res = await request('POST', `/bookings/${id}/tasks`, {
      token: fx.token,
      body: { title: 'Airport pick-up', department: 'transport', deadline: CHECKIN },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ bookingId: id, department: 'transport', trigger: 'instant' });
    const tasks = await request('GET', `/bookings/${id}/tasks`, { token: fx.token });
    expect(tasks.body.map((t: any) => t.title)).toEqual(['Airport pick-up']);
  });

  it('hides one tenant’s booking extras from another', async () => {
    const a = await ready();
    const b = await ready();
    const id = await oneBooking(b);
    for (const path of [`/bookings/${id}/remarks`, `/bookings/${id}/guests`]) {
      expect((await request('GET', path, { token: a.token })).status).toBe(404);
    }
    expect(
      (await request('POST', `/bookings/${id}/remarks`, { token: a.token, body: { text: 'x' } }))
        .status,
    ).toBe(404);
  });
});

describe('identity documents', () => {
  async function guestOf(fx: TenantFixture) {
    const r = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: { name: 'Document Dharmasena' },
      lines: [line(fx)],
    });
    const [b] = await admin().select().from(bookings).where(eq(bookings.id, r.body.bookings[0].id));
    return b!.customerId;
  }

  it('keeps only the last four digits of an Aadhaar number, whatever is typed', async () => {
    const fx = await ready({ country: 'IN' });
    const customerId = await guestOf(fx);
    const res = await request('POST', `/customers/${customerId}/documents`, {
      token: fx.token,
      body: { type: 'aadhaar', number: '1234 5678 9012', verification: 'digital' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.number).toBe('9012');
    expect(res.body.verifiedByUserId).toBe(fx.userId);

    // And the database refuses more, whatever code path tries.
    await expect(
      admin()
        .insert(guestDocuments)
        .values({ tenantId: fx.tenantId, customerId, type: 'aadhaar', number: '123456789012' }),
    ).rejects.toThrow();
  });

  it('refuses a number that cannot be right, and keeps one primary document', async () => {
    const fx = await ready();
    const customerId = await guestOf(fx);
    const bad = await request('POST', `/customers/${customerId}/documents`, {
      token: fx.token,
      body: { type: 'nic', number: '12345' },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('document_number_invalid');

    const nic = await request('POST', `/customers/${customerId}/documents`, {
      token: fx.token,
      body: { type: 'nic', number: '199012345678', isPrimary: true },
    });
    expect(nic.status, JSON.stringify(nic.body)).toBe(201);
    const passport = await request('POST', `/customers/${customerId}/documents`, {
      token: fx.token,
      body: { type: 'passport', number: 'n1234567', issuingCountry: 'lk', isPrimary: true },
    });
    expect(passport.body.number).toBe('N1234567');
    const docs = await request('GET', `/customers/${customerId}/documents`, { token: fx.token });
    expect(docs.body.filter((d: any) => d.isPrimary).map((d: any) => d.type)).toEqual(['passport']);

    // A changed type re-checks the number already there: a passport number is no NIC.
    const retyped = await request('PATCH', `/guest-documents/${passport.body.id}`, {
      token: fx.token,
      body: { type: 'nic' },
    });
    expect(retyped.status).toBe(400);
  });

  it('adds documents given with the guest when the reservation is made', async () => {
    const fx = await ready();
    const r = await reserve(fx, {
      checkin: CHECKIN,
      checkout: CHECKOUT,
      guest: {
        name: 'Passport Pieris',
        nationalityCode: 'GB',
        documents: [{ type: 'passport', number: '123456789', issuingCountry: 'GB' }],
      },
      lines: [line(fx)],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const docs = await request('GET', `/customers/${r.body.guest.id}/documents`, {
      token: fx.token,
    });
    expect(docs.body).toMatchObject([
      { type: 'passport', number: '123456789', issuingCountry: 'GB' },
    ]);
  });

  it('hides one tenant’s guest documents from another', async () => {
    const a = await ready();
    const b = await ready();
    const customerId = await guestOf(b);
    const res = await request('GET', `/customers/${customerId}/documents`, { token: a.token });
    expect(res.status).toBe(404);
  });
});
