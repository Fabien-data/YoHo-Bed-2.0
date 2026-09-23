import { test, expect, type Page } from '@playwright/test';

/**
 * The full Add Reservation page (Development Phase 02, Sprint 4): a guest per room, a room's own
 * remark, and Quick Reservation's "More options" carrying its draft over.
 *
 * Every test cancels what it booked, so repeated runs never sell the demo hotel out.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
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

/** A stay with `rooms` of the first room type free on every night, found from the API. */
async function findStay(page: Page, nights: number, rooms: number) {
  const { headers, propertyId } = await api(page);
  const config = await (
    await page.request.get(`${API}/properties/${propertyId}/reservation-config`, { headers })
  ).json();
  const start = 9 + Math.floor(Math.random() * 8);
  for (let offset = start; offset < start + 30; offset++) {
    const checkin = addDays(config.today, offset);
    const grid = await (
      await page.request.get(
        `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${addDays(checkin, nights)}`,
        { headers },
      )
    ).json();
    const rt = grid.roomTypes?.[0];
    if (rt && rt.free >= rooms && rt.rateTypes.some((t: { priced: boolean }) => t.priced)) {
      return { checkin };
    }
  }
  throw new Error('no free, priced stay in the demo data');
}

async function cancelAll(page: Page, bookings: Array<{ id: string }>) {
  const { headers } = await api(page);
  for (const b of bookings) await page.request.post(`${API}/bookings/${b.id}/cancel`, { headers });
}

test.describe('Add Reservation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('books two rooms and turns a guest occasion into a remark, task and extra', async ({
    page,
  }) => {
    const { checkin } = await findStay(page, 2, 2);
    await page.goto(`/app/reservations/new?checkin=${checkin}&nights=2`);
    await expect(page.getByRole('heading', { name: 'Add Reservation' })).toBeVisible();

    await page.getByRole('combobox', { name: 'Room type, room 1' }).click();
    await page.getByRole('option').first().click();
    await expect(page.getByRole('combobox', { name: 'Rate type, room 1' })).not.toHaveText(
      '-Select-',
    );
    const rooms = page.getByLabel('Rooms', { exact: true });
    await rooms.fill('2');
    await rooms.press('Tab');
    await expect(page.getByTestId('room-line-2')).toBeVisible();

    // The occasion shortcut reuses the current remark, task and inclusion records.
    await page.getByRole('button', { name: 'More for room 1' }).click();
    await page.getByRole('menuitem', { name: 'Guest occasion' }).click();
    const occasion = page.getByRole('dialog', { name: /Guest occasion.*room 1/ });
    await occasion.getByRole('combobox', { name: 'Occasion' }).click();
    await page.getByRole('option', { name: 'Honeymoon' }).click();
    await occasion.getByLabel('Guest preferences or preparation notes').fill('Flowers on arrival');
    await occasion.getByLabel('Extra').fill('Welcome flowers');
    await occasion.getByLabel(/Price/).fill('2500');
    await occasion.getByRole('button', { name: 'Add occasion' }).click();
    await expect(occasion).toBeHidden();

    await page.locator('#ar-guest-name').fill('Playwright Owner');
    await page.getByRole('checkbox', { name: 'Guest list: a guest for each room' }).click();
    await page.locator('#ar-room-1-guest-name').fill('Playwright Roomtwo');

    await expect(page.getByTestId('ar-total')).not.toHaveText(/ 0\.00$/);
    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/reservations') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Reserve' }).click();
    const response = await saved;
    const created = await response.json();
    expect(response.status(), JSON.stringify(created)).toBe(201);
    try {
      expect(created.bookings.map((b: { guestName: string }) => b.guestName)).toEqual([
        'Playwright Owner',
        'Playwright Roomtwo',
      ]);
      await page.waitForURL(`**/app/reservations?tab=upcoming&q=${created.reference}`);
      const { headers } = await api(page);
      const room1 = await (
        await page.request.get(`${API}/bookings/${created.bookings[0].id}/remarks`, { headers })
      ).json();
      expect(room1.map((r: { text: string }) => r.text)).toEqual([
        'Honeymoon · Flowers on arrival',
      ]);
      const tasks = await (
        await page.request.get(`${API}/bookings/${created.bookings[0].id}/tasks`, { headers })
      ).json();
      expect(tasks).toMatchObject([{ title: 'Prepare for honeymoon', trigger: 'checkin' }]);
      const inclusions = await (
        await page.request.get(`${API}/bookings/${created.bookings[0].id}/inclusions`, { headers })
      ).json();
      expect(inclusions).toMatchObject([
        { name: 'Welcome flowers', rhythm: 'once', unitPrice: '2500.00' },
      ]);
      // The list lands on the new reservation: both rooms, found by the master reference.
      await expect(page.getByText(`${created.reference}-2`)).toBeVisible();
    } finally {
      await cancelAll(page, created.bookings);
    }
  });

  test('More options carries the Quick Reservation over to the full page', async ({ page }) => {
    await page.getByRole('button', { name: 'New reservation' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Quick Reservation' });
    await sheet.getByPlaceholder('Full name').fill('Handoff Hettige');
    await sheet.getByRole('button', { name: 'More options' }).click();
    await page.waitForURL('**/app/reservations/new');
    await expect(page.locator('#ar-guest-name')).toHaveValue('Handoff Hettige');
  });
});
