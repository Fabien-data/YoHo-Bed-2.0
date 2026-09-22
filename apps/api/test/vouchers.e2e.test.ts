import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { messages, voucherTokens } from '@yohobed/db';
import {
  admin,
  book,
  makeTenant,
  openAndPrice,
  payInFull,
  request,
  reserve,
  startApp,
  stopApp,
  type TenantFixture,
} from './harness';

/** The booking voucher, the guest booking page, and the check-out email (Phase 02, Sprint 6). */

afterAll(stopApp);

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function ready() {
  const fx = await makeTenant({ roomQuantity: 10 });
  await openAndPrice(fx, TODAY, addDays(TODAY, 30), { roomsToSell: 10, base: 18000 });
  return fx;
}

const line = (fx: TenantFixture) => ({ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 });

async function twoRooms(fx: TenantFixture, extra: Record<string, unknown> = {}) {
  const res = await reserve(fx, {
    checkin: addDays(TODAY, 4),
    checkout: addDays(TODAY, 6),
    guest: { name: 'Voucher Vithanage', email: 'vithanage@guest.test', phone: '+94 77 123 4567' },
    lines: [line(fx), { ...line(fx), children: 1 }],
    ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { reference: string; bookings: Array<{ id: string }>; total: string };
}

async function publicPage(token: string) {
  const supertest = (await import('supertest')).default;
  const server = (await startApp()).getHttpServer();
  return supertest(server).get(`/public/vouchers/${token}`);
}

async function messagesFor(bookingIds: string[], key: string) {
  return admin()
    .select()
    .from(messages)
    .where(and(inArray(messages.bookingId, bookingIds), eq(messages.templateKey, key)));
}

describe('the booking voucher', () => {
  it('previews the whole reservation, with a WhatsApp link to the guest', async () => {
    const fx = await ready();
    const r = await twoRooms(fx, { options: { voucherEmails: ['agent@travel.test'] } });
    const res = await request('POST', `/reservations/${r.bookings[1]!.id}/voucher/preview`, {
      token: fx.token,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reference).toBe(r.reference);
    expect(res.body.recipients).toEqual(['vithanage@guest.test', 'agent@travel.test']);
    expect(res.body.subject).toContain(r.reference);
    expect(res.body.body).toContain('1. E2E Room · BB · 2 adults');
    expect(res.body.body).toContain('2. E2E Room · BB · 2 adults, 1 child');
    expect(res.body.body).toContain(
      `Total: Rs ${Number(r.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    );
    expect(res.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/94771234567\?text=/);
    expect(res.body.link).toBeNull();
  });

  it('sends one email per address', async () => {
    const fx = await ready();
    const r = await twoRooms(fx);
    const res = await request('POST', `/reservations/${r.bookings[0]!.id}/voucher/send`, {
      token: fx.token,
      body: { emails: ['a@x.test', 'B@x.test', 'b@x.test', 'c@x.test'] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.queued).toBe(3);
    const sent = await messagesFor(
      r.bookings.map((b) => b.id),
      'booking_voucher',
    );
    expect(sent.map((m) => m.toAddress).sort()).toEqual(['a@x.test', 'b@x.test', 'c@x.test']);
  });

  it('emails the voucher instead of the plain confirmation when the reservation asks', async () => {
    const fx = await ready();
    const r = await twoRooms(fx, {
      options: { emailVoucher: true, voucherEmails: ['vithanage@guest.test', 'agent@travel.test'] },
    });
    const ids = r.bookings.map((b) => b.id);
    const vouchers = await messagesFor(ids, 'booking_voucher');
    expect(vouchers.map((m) => m.toAddress).sort()).toEqual([
      'agent@travel.test',
      'vithanage@guest.test',
    ]);
    expect(await messagesFor(ids, 'booking_created')).toEqual([]);
  });
});

describe('the guest booking page', () => {
  it('opens with its link, shows the stay but not the guest’s contact details, and is never indexed', async () => {
    const fx = await ready();
    const r = await twoRooms(fx);
    const link = await request('POST', `/reservations/${r.bookings[0]!.id}/voucher/link`, {
      token: fx.token,
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body.url).toMatch(new RegExp(`/voucher/${link.body.token}$`));
    expect(link.body.created).toBe(true);

    const page = await publicPage(link.body.token);
    expect(page.status).toBe(200);
    expect(page.headers['x-robots-tag']).toContain('noindex');
    expect(page.headers['cache-control']).toContain('no-store');
    expect(page.body).toMatchObject({
      reference: r.reference,
      guestFirstName: 'Voucher',
      checkin: addDays(TODAY, 4),
      checkout: addDays(TODAY, 6),
      nights: 2,
      total: r.total,
    });
    expect(page.body.rooms).toHaveLength(2);
    const text = JSON.stringify(page.body);
    expect(text).not.toContain('vithanage@guest.test');
    expect(text).not.toContain('771234567');

    // Asking again gives the same link; the preview now carries it.
    const again = await request('POST', `/reservations/${r.bookings[1]!.id}/voucher/link`, {
      token: fx.token,
    });
    expect(again.body).toMatchObject({ token: link.body.token, created: false });
    const preview = await request('POST', `/reservations/${r.bookings[0]!.id}/voucher/preview`, {
      token: fx.token,
    });
    expect(preview.body.body).toContain(link.body.url);
  });

  it('closes when revoked or expired, and a guess looks the same', async () => {
    const fx = await ready();
    const b = await book(fx, { checkin: addDays(TODAY, 8), checkout: addDays(TODAY, 9) });
    const link = await request('POST', `/reservations/${b.body.id}/voucher/link`, {
      token: fx.token,
    });
    expect((await publicPage(link.body.token)).status).toBe(200);

    const revoked = await request('DELETE', `/reservations/${b.body.id}/voucher/link`, {
      token: fx.token,
    });
    expect(revoked.body.revoked).toBe(1);
    expect((await publicPage(link.body.token)).status).toBe(404);

    const fresh = await request('POST', `/reservations/${b.body.id}/voucher/link`, {
      token: fx.token,
    });
    expect(fresh.body.token).not.toBe(link.body.token);
    expect((await publicPage(fresh.body.token)).status).toBe(200);
    await admin()
      .update(voucherTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(voucherTokens.token, fresh.body.token));
    expect((await publicPage(fresh.body.token)).status).toBe(404);

    expect((await publicPage('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await publicPage('not-a-token')).status).toBe(404);
  });

  it("keeps a booking's link to its own hotel", async () => {
    const fx = await ready();
    const other = await ready();
    const b = await book(fx, { checkin: addDays(TODAY, 8), checkout: addDays(TODAY, 9) });
    expect(
      (await request('POST', `/reservations/${b.body.id}/voucher/link`, { token: other.token }))
        .status,
    ).toBe(404);
    expect(
      (await request('POST', `/reservations/${b.body.id}/voucher/preview`, { token: other.token }))
        .status,
    ).toBe(404);
  });
});

describe('check-out and the registration card', () => {
  it('sends the thank-you email at check-out when the reservation asks', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: TODAY,
      checkout: addDays(TODAY, 1),
      guest: { name: 'Leaving Liyanage', email: 'liyanage@guest.test' },
      lines: [line(fx)],
      options: { sendCheckoutEmail: true },
    });
    const id = res.body.bookings[0].id;
    // Straight to checked in, as the desk would at arrival.
    expect((await request('POST', `/bookings/${id}/check-in`, { token: fx.token })).status).toBe(
      200,
    );
    // Paid up first: a guest is never checked out owing money (UX-1a).
    await payInFull(fx, id);
    expect((await request('POST', `/bookings/${id}/check-out`, { token: fx.token })).status).toBe(
      200,
    );
    const sent = await messagesFor([id], 'checkout_thank_you');
    expect(sent.map((m) => m.toAddress)).toEqual(['liyanage@guest.test']);
  });

  it('prints the card without the rate when asked, listing what the stay includes', async () => {
    const fx = await ready();
    const res = await reserve(fx, {
      checkin: addDays(TODAY, 3),
      checkout: addDays(TODAY, 4),
      guest: { name: 'Card Cabraal' },
      lines: [
        {
          ...line(fx),
          inclusions: [{ name: 'Breakfast', rhythm: 'per_guest_per_night', unitPrice: 1500 }],
        },
      ],
      options: { suppressRateOnGrCard: true },
    });
    const card = await request('GET', `/bookings/${res.body.bookings[0].id}/registration-card`, {
      token: fx.token,
    });
    expect(card.status).toBe(200);
    expect(card.body).toMatchObject({ amount: null, taxes: null, rateSuppressed: true });
    expect(card.body.inclusions).toMatchObject([{ name: 'Breakfast', unitPrice: null }]);
  });

  it("names the guest on a bill opened later (window 1's payer)", async () => {
    const fx = await ready();
    const b = await book(fx, {
      checkin: addDays(TODAY, 12),
      checkout: addDays(TODAY, 13),
      customerName: 'Payer Perera',
    });
    const folio = await request('GET', `/bookings/${b.body.id}/folio`, { token: fx.token });
    expect(folio.body.windows[0]).toMatchObject({ payerType: 'guest', payerName: 'Payer Perera' });
  });
});
