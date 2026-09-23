import { afterAll, describe, expect, it } from 'vitest';
import {
  addUnits,
  makeTenant,
  openAndPrice,
  book,
  hotelToday,
  payInFull,
  request,
  stopApp,
  type TenantFixture,
} from './harness';

afterAll(stopApp);

/**
 * Drive a guest all the way to checked-out, then pull the review token out of the queued email.
 * The stay arrives today and is paid up — a guest is only checked in on the arrival day, and
 * never checked out owing money (UX-1a).
 */
async function checkOutGuest(fx: TenantFixture, email: string) {
  await openAndPrice(fx, hotelToday(), hotelToday(9));
  const b = await book(fx, {
    checkin: hotelToday(),
    checkout: hotelToday(2),
    customerName: 'Ruwan Jayasuriya',
    customerEmail: email,
  });
  await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token });
  await addUnits(fx, fx.roomId, [`REVIEW-${b.body.id.slice(0, 8)}`]);
  await request('POST', `/bookings/${b.body.id}/auto-assign`, { token: fx.token });
  await payInFull(fx, b.body.id);
  const inRes = await request('POST', `/bookings/${b.body.id}/check-in`, { token: fx.token });
  expect(inRes.status, JSON.stringify(inRes.body)).toBe(200);
  const outRes = await request('POST', `/bookings/${b.body.id}/check-out`, { token: fx.token });
  expect(outRes.status, JSON.stringify(outRes.body)).toBe(200);
  return b.body;
}

async function reviewTokenFor(fx: TenantFixture): Promise<string> {
  const msgs = await request('GET', '/messages', { token: fx.token });
  const invite = msgs.body.find((m: any) => m.templateKey === 'review_invite');
  expect(invite, 'a review invite email should be queued at check-out').toBeTruthy();
  const match = /review\/([0-9a-f-]{36})/.exec(invite.body);
  expect(match, 'the invite email should carry a review link').toBeTruthy();
  return match![1]!;
}

describe('guest reviews', () => {
  it('emails a single-use review link at check-out that a guest can submit without logging in', async () => {
    const fx = await makeTenant();
    await checkOutGuest(fx, 'ruwan@example.com');

    const token = await reviewTokenFor(fx);

    // Public: no bearer token at all.
    const info = await request('GET', `/reviews/invite/${token}`);
    expect(info.status).toBe(200);
    expect(info.body.guestName).toBe('Ruwan Jayasuriya');
    expect(info.body.used).toBe(false);

    const submit = await request('POST', '/reviews', {
      body: { token, rating: 5, comment: 'Spotless room, wonderful staff.' },
    });
    expect(submit.status).toBe(200);

    // Single-use: a replayed link is refused.
    const replay = await request('POST', '/reviews', {
      body: { token, rating: 1, comment: 'spam' },
    });
    expect(replay.status).toBe(400);

    const owner = await request('GET', '/reviews', { token: fx.token });
    expect(owner.body.reviews).toHaveLength(1);
    expect(owner.body.summary[0].average).toBe(5);

    const notif = await request('GET', '/notifications', { token: fx.token });
    expect(notif.body.some((n: any) => n.type === 'review_received')).toBe(true);
  });

  it('404s an unknown review token', async () => {
    const res = await request('GET', '/reviews/invite/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('keeps reviews tenant-scoped', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await checkOutGuest(a, 'guest-a@example.com');
    const token = await reviewTokenFor(a);
    await request('POST', '/reviews', { body: { token, rating: 4 } });

    expect((await request('GET', '/reviews', { token: a.token })).body.reviews).toHaveLength(1);
    expect((await request('GET', '/reviews', { token: b.token })).body.reviews).toHaveLength(0);
  });
});

describe('customer directory', () => {
  it('rolls up a guest’s bookings, nights and confirmed spend', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    await openAndPrice(fx, '2029-08-01', '2029-08-20', { base: 18000, roomsToSell: 5 });

    const first = await book(fx, {
      checkin: '2029-08-02',
      checkout: '2029-08-04',
      customerName: 'Repeat Guest',
      customerEmail: 'repeat@example.com',
    });
    await request('POST', `/bookings/${first.body.id}/approve`, { token: fx.token });
    const second = await book(fx, {
      checkin: '2029-08-10',
      checkout: '2029-08-11',
      customerName: 'Repeat Guest',
      customerEmail: 'repeat@example.com',
    });
    await request('POST', `/bookings/${second.body.id}/approve`, { token: fx.token });

    const list = await request('GET', '/customers', { token: fx.token });
    const guest = list.body.find((c: any) => c.email === 'repeat@example.com');
    expect(guest.bookings).toBe(2); // reused by email, not duplicated
    expect(guest.nights).toBe(3);
    expect(Number(guest.totalSpend)).toBeCloseTo(24390.25 * 3, 2);

    const detail = await request('GET', `/customers/${guest.id}`, { token: fx.token });
    expect(detail.body.history).toHaveLength(2);
  });
});
