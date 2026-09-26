import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { messages, templates } from '@yohobed/db';
import {
  addDeskUser,
  addUnits,
  admin,
  makeTenant,
  openAndPrice,
  payInFull,
  request,
  reserve,
  stopApp,
  type TenantFixture,
} from './harness';

/** Configuration → Email templates (owner brief, 2026-09-26). */

afterAll(stopApp);

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function ready(opts: Parameters<typeof makeTenant>[0] = {}) {
  const fx = await makeTenant({ roomQuantity: 10, ...opts });
  await openAndPrice(fx, TODAY, addDays(TODAY, 30), { roomsToSell: 10, base: 18000 });
  return fx;
}

const line = (fx: TenantFixture) => ({ roomId: fx.roomId, occupancyId: fx.occupancyId, adults: 2 });

async function templateOf(fx: TenantFixture, key: string) {
  const res = await request('GET', '/templates', { token: fx.token });
  expect(res.status).toBe(200);
  return (res.body as Array<{ id: string; key: string; subject: string; body: string }>).find(
    (t) => t.key === key && (t as { language?: string }).language === 'en',
  )!;
}

async function sentFor(bookingIds: string[], key: string) {
  return admin()
    .select()
    .from(messages)
    .where(and(inArray(messages.bookingId, bookingIds), eq(messages.templateKey, key)));
}

/** Book a one-night stay for today and check it in, paid up, as the desk would. */
async function arrive(fx: TenantFixture, options: Record<string, unknown>, unit: string) {
  const res = await reserve(fx, {
    checkin: TODAY,
    checkout: addDays(TODAY, 1),
    guest: { name: 'Farewell Fernando', email: 'fernando@guest.test' },
    lines: [line(fx)],
    options,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.bookings[0].id as string;
  await addUnits(fx, fx.roomId, [unit]);
  const assigned = await request('POST', `/bookings/${id}/auto-assign`, { token: fx.token });
  expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
  const checkedIn = await request('POST', `/bookings/${id}/check-in`, { token: fx.token });
  expect(checkedIn.status, JSON.stringify(checkedIn.body)).toBe(200);
  await payInFull(fx, id);
  return id;
}

async function leave(fx: TenantFixture, id: string) {
  const res = await request('POST', `/bookings/${id}/check-out`, { token: fx.token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

describe('the booking confirmation', () => {
  it('shows the total in the hotel’s own currency and is signed by the hotel', async () => {
    const fx = await ready({ currency: 'USD' });
    const res = await reserve(fx, {
      checkin: addDays(TODAY, 3),
      checkout: addDays(TODAY, 5),
      guest: { name: 'Dollar Dias', email: 'dias@guest.test' },
      lines: [line(fx)],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [sent] = await sentFor([res.body.bookings[0].id], 'booking_created');
    expect(sent?.body).toContain('Total: $ ');
    expect(sent?.body).not.toContain('Rs');
    expect(sent?.body).not.toContain('YoHoBed');
  });

  it('moves an untouched old starter text to the new one, and leaves an edited one alone', async () => {
    const { upgradeStarterTemplates } = await import('@yohobed/db');
    const fx = await ready();
    const db = admin();
    const OLD =
      'Dear {{guestName}},\n\nYour booking {{reference}} is confirmed for {{checkin}} to ' +
      '{{checkout}} ({{nights}} nights).\nTotal: Rs {{amount}}.\n\nThank you for choosing us.\nYoHoBed';
    await db
      .update(templates)
      .set({ body: OLD })
      .where(
        and(
          eq(templates.tenantId, fx.tenantId),
          eq(templates.key, 'booking_created'),
          eq(templates.language, 'en'),
        ),
      );
    expect(await upgradeStarterTemplates(db, fx.tenantId)).toBe(1);
    expect((await templateOf(fx, 'booking_created')).body).toContain('Total: {{total}}');

    const edited = `${OLD}\nSee you soon!`;
    await db
      .update(templates)
      .set({ body: edited })
      .where(
        and(
          eq(templates.tenantId, fx.tenantId),
          eq(templates.key, 'booking_created'),
          eq(templates.language, 'en'),
        ),
      );
    expect(await upgradeStarterTemplates(db, fx.tenantId)).toBe(0);
    expect((await templateOf(fx, 'booking_created')).body).toBe(edited);
  });
});

describe('editing the emails', () => {
  it('lets the owner reword a starter email and reset it, never rename or delete it', async () => {
    const fx = await ready();
    const thanks = await templateOf(fx, 'checkout_thank_you');
    const saved = await request('PATCH', `/templates/${thanks.id}`, {
      token: fx.token,
      body: { subject: 'Come back soon, {{guestName}}', body: 'Thank you, {{guestName}}.' },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.subject).toBe('Come back soon, {{guestName}}');

    const renamed = await request('PATCH', `/templates/${thanks.id}`, {
      token: fx.token,
      body: { subject: 'x', body: 'y', name: 'My thanks' },
    });
    expect(renamed.status).toBe(400);
    const deleted = await request('DELETE', `/templates/${thanks.id}`, { token: fx.token });
    expect(deleted.status).toBe(409);
    expect(deleted.body.reason).toBe('starter_template');

    const reset = await request('POST', `/templates/${thanks.id}/reset`, { token: fx.token });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    expect(reset.body.subject).toBe('Thank you for staying at {{propertyName}}');
  });

  it('keeps the wording of guest emails with the owner', async () => {
    const fx = await ready();
    const desk = await addDeskUser(fx);
    const thanks = await templateOf(fx, 'checkout_thank_you');
    expect(
      (
        await request('PATCH', `/templates/${thanks.id}`, {
          token: desk.token,
          body: { subject: 'Desk wording', body: 'Desk wording' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('POST', '/templates', {
          token: desk.token,
          body: { name: 'Desk', subject: 'Desk', body: 'Desk' },
        })
      ).status,
    ).toBe(403);
  });
});

describe('a check-out email of the hotel’s own', () => {
  it('goes to the guest when the reservation picks it, and the thank-you once it is deleted', async () => {
    const fx = await ready();
    const made = await request('POST', '/templates', {
      token: fx.token,
      body: {
        name: 'VIP farewell',
        subject: 'Until next time, {{guestName}}',
        body: 'Dear {{guestName}}, it was a pleasure to host you at {{propertyName}}.',
      },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.key).toMatch(/^checkout_custom_[0-9a-f]{8}$/);
    expect(made.body.name).toBe('VIP farewell');

    // Both guests are in the house before either leaves, so each has a clean room.
    const options = { sendCheckoutEmail: true, checkoutTemplate: made.body.key };
    const vip = await arrive(fx, options, 'TPL-101');
    const later = await arrive(fx, options, 'TPL-102');
    await leave(fx, vip);
    const [farewell] = await sentFor([vip], made.body.key);
    expect(farewell?.subject).toBe('Until next time, Farewell Fernando');

    const renamed = await request('PATCH', `/templates/${made.body.id}`, {
      token: fx.token,
      body: { name: 'VIP goodbye', subject: made.body.subject, body: made.body.body },
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('VIP goodbye');
    expect(
      (await request('POST', `/templates/${made.body.id}/reset`, { token: fx.token })).status,
    ).toBe(409);

    const del = await request('DELETE', `/templates/${made.body.id}`, { token: fx.token });
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    await leave(fx, later);
    expect((await sentFor([later], 'checkout_thank_you')).map((m) => m.toAddress)).toEqual([
      'fernando@guest.test',
    ]);
  });
});
