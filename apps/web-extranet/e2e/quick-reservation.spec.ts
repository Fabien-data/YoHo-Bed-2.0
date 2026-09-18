import { test, expect, type Page } from '@playwright/test';

/**
 * Quick Reservation (Development Phase 02, Sprint 3): Yanolja's half-width sheet, opened from
 * anywhere, priced live, booked in one step.
 *
 * Every test cancels what it booked, so repeated runs never sell the demo hotel out.
 */

const OWNER_EMAIL = 'owner@demo.yohobed.test';
const PASSWORD = 'password123';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill(OWNER_EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

async function api(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const properties = await (await page.request.get(`${API}/properties`, { headers })).json();
  return { headers, propertyId: properties[0].id as string };
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * A stay with `rooms` rooms free on every night, a week or more ahead of the hotel's own date —
 * found from the API rather than assumed, because the demo data moves with the day it was seeded.
 */
async function findStay(page: Page, nights: number, rooms: number) {
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

async function cancelAll(page: Page, created: { bookings: Array<{ id: string }> }) {
  const { headers } = await api(page);
  for (const b of created.bookings) {
    await page.request.post(`${API}/bookings/${b.id}/cancel`, { headers });
  }
}

function sheetOf(page: Page) {
  return page.getByRole('dialog', { name: 'Quick Reservation' });
}

test.describe('Quick Reservation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('books two rooms, typing the dates day-first and ISO', async ({ page }) => {
    const { checkin } = await findStay(page, 2, 2);
    await page.getByRole('button', { name: 'New reservation' }).first().click();
    const sheet = sheetOf(page);
    await expect(sheet).toBeVisible();

    // Day-first, the way the desk types it.
    const checkinInput = sheet.getByLabel('Check-in date');
    await checkinInput.fill(dmy(checkin));
    await checkinInput.press('Tab');
    await expect(checkinInput).toHaveValue(dmy(checkin));

    // The nights chip moves the check-out.
    await sheet.getByRole('button', { name: /night.* — change/ }).click();
    await sheet.getByLabel('Nights').fill('3');
    await sheet.getByLabel('Nights').press('Enter');
    await expect(sheet.getByLabel('Check-out date')).toHaveValue(dmy(addDays(checkin, 3)));

    // ISO works too: back to two nights.
    const checkoutInput = sheet.getByLabel('Check-out date');
    await checkoutInput.fill(addDays(checkin, 2));
    await checkoutInput.press('Tab');
    await expect(checkoutInput).toHaveValue(dmy(addDays(checkin, 2)));
    await expect(sheet.getByRole('button', { name: /2 nights — change/ })).toBeVisible();

    await sheet.getByRole('combobox', { name: 'Room type, room 1' }).click();
    await page.getByRole('option').first().click();
    await expect(sheet.getByRole('combobox', { name: 'Rate type, room 1' })).not.toHaveText(
      '-Select-',
    );
    const rooms = sheet.getByLabel('Rooms', { exact: true });
    await rooms.fill('2');
    await rooms.press('Tab');
    await expect(sheet.getByTestId('room-line-2')).toBeVisible();

    await sheet.getByPlaceholder('Full name').fill('Playwright Perera');
    await expect(sheet.getByTestId('qr-total')).not.toHaveText(/ 0\.00$/);

    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/reservations') && r.request().method() === 'POST',
    );
    await sheet.getByRole('button', { name: 'Reserve' }).click();
    const response = await saved;
    const created = await response.json();
    expect(response.status(), JSON.stringify(created)).toBe(201);
    try {
      expect(created.bookings).toHaveLength(2);
      expect(created.bookings[0].reference).toBe(`${created.reference}-1`);
      await expect(page.getByText(`Reservation ${created.reference} saved`)).toBeVisible();
      await expect(sheet).toBeHidden();
    } finally {
      await cancelAll(page, created);
    }
  });

  test('asks before throwing away a half-filled reservation', async ({ page }) => {
    await page.getByRole('button', { name: 'New reservation' }).first().click();
    const sheet = sheetOf(page);
    await sheet.getByPlaceholder('Full name').fill('Not finished');

    await page.keyboard.press('Escape');
    const confirm = page.getByRole('dialog', { name: 'Discard this reservation?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await expect(confirm).toBeHidden();
    await expect(sheet.getByPlaceholder('Full name')).toHaveValue('Not finished');

    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: 'Discard this reservation?' })
      .getByRole('button', {
        name: 'Discard',
      })
      .click();
    await expect(sheet).toBeHidden();
  });

  test('will not reserve without a guest, and says why', async ({ page }) => {
    const posts: string[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/reservations') && r.method() === 'POST') posts.push(r.url());
    });
    await page.getByRole('button', { name: 'New reservation' }).first().click();
    const sheet = sheetOf(page);
    await sheet.getByRole('combobox', { name: 'Room type, room 1' }).click();
    await page.getByRole('option').first().click();
    await sheet.getByRole('button', { name: 'Reserve' }).click();
    await expect(sheet.getByText('The guest needs a name.')).toBeVisible();
    expect(posts).toHaveLength(0);
  });

  test('opens from the command palette with Alt+N', async ({ page }) => {
    await page.keyboard.press('Alt+KeyN');
    await expect(sheetOf(page)).toBeVisible();
  });
});
