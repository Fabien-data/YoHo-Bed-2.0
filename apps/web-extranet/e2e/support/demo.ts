import type { Page } from '@playwright/test';

/** Shared demo-hotel helpers for specs that need a signed-in owner and a bookable stay. */

export const OWNER_EMAIL = 'owner@demo.yohobed.test';
export const PASSWORD = 'password123';
export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill(OWNER_EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

export async function api(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const properties = await (await page.request.get(`${API}/properties`, { headers })).json();
  return { headers, propertyId: properties[0].id as string };
}

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * A stay with `rooms` rooms free on every night, a week or more ahead of the hotel's own date —
 * found from the API rather than assumed, because the demo data moves with the day it was seeded.
 */
export async function findStay(page: Page, nights: number, rooms: number) {
  const { headers, propertyId } = await api(page);
  const config = await (
    await page.request.get(`${API}/properties/${propertyId}/reservation-config`, { headers })
  ).json();
  const start = 7 + Math.floor(Math.random() * 6);
  for (let offset = start; offset < start + 30; offset++) {
    const checkin = addDays(config.today, offset);
    const checkout = addDays(checkin, nights);
    const grid = await (
      await page.request.get(
        `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${checkout}`,
        { headers },
      )
    ).json();
    const rt = grid.roomTypes?.[0];
    if (rt && rt.free >= rooms && rt.rateTypes.some((t: { priced: boolean }) => t.priced)) {
      return { checkin, checkout };
    }
  }
  throw new Error('no free, priced stay in the demo data');
}

/** The demo hotel's calendar today (Asia/Colombo). */
export function hotelToday(offset = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
  return addDays(today, offset);
}

/**
 * A confirmed stay arriving TODAY for `nights`, booked through the API — the arrival a front-desk
 * scenario starts from. Returns its id, reference and amount.
 */
export async function arrivalToday(page: Page, guest: string, nights = 2) {
  const { headers, propertyId } = await api(page);
  const checkin = hotelToday();
  const checkout = addDays(checkin, nights);
  const grid = await (
    await page.request.get(
      `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${checkout}`,
      { headers },
    )
  ).json();
  const rt = grid.roomTypes.find(
    (r: { free: number; rateTypes: Array<{ priced: boolean }> }) =>
      r.free >= 1 && r.rateTypes.some((t) => t.priced),
  );
  if (!rt) throw new Error('no free, priced room type tonight in the demo data');
  const occupancyId = rt.rateTypes.find((t: { priced: boolean }) => t.priced).occupancyId;
  const res = await page.request.post(`${API}/bookings`, {
    headers,
    data: { roomId: rt.roomId, occupancyId, checkin, checkout, customerName: guest },
  });
  const b = await res.json();
  if (!res.ok()) throw new Error(`arrivalToday failed: ${JSON.stringify(b)}`);
  await page.request.post(`${API}/bookings/${b.id}/approve`, { headers });
  return b as { id: string; reference: string; amount: string };
}

/** Drive a booking through the API — setup and clean-up only, never the thing under test. */
export async function bookingApi(page: Page, id: string, action: string, data?: unknown) {
  const { headers } = await api(page);
  return page.request.post(`${API}/bookings/${id}/${action}`, { headers, data: data ?? {} });
}

export async function cancelAll(page: Page, created: { bookings: Array<{ id: string }> }) {
  const { headers } = await api(page);
  for (const b of created.bookings) {
    await page.request.post(`${API}/bookings/${b.id}/cancel`, { headers });
  }
}
