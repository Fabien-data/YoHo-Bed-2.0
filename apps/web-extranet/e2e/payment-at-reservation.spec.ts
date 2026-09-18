import { test, expect, type Page } from '@playwright/test';

/**
 * Money at reservation and the walk-in (Development Phase 02, Sprint 5): a deposit by bank
 * transfer with its reference and a slip photo, and a guest checked in as they are booked.
 *
 * Every test undoes what it booked, so repeated runs never sell the demo hotel out.
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

async function config(page: Page) {
  const { headers, propertyId } = await api(page);
  return (
    await page.request.get(`${API}/properties/${propertyId}/reservation-config`, { headers })
  ).json();
}

/** Is a room of the first room type free and priced for this stay? */
async function freeOn(page: Page, checkin: string, nights: number) {
  const { headers, propertyId } = await api(page);
  const grid = await (
    await page.request.get(
      `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${addDays(checkin, nights)}`,
      { headers },
    )
  ).json();
  const rt = grid.roomTypes?.[0];
  return Boolean(rt && rt.free >= 1 && rt.rateTypes.some((t: { priced: boolean }) => t.priced));
}

async function pickFirstRoomType(page: Page) {
  await page.getByRole('combobox', { name: 'Room type, room 1' }).click();
  await page.getByRole('option').first().click();
  await expect(page.getByRole('combobox', { name: 'Rate type, room 1' })).not.toHaveText(
    '-Select-',
  );
  await expect(page.getByTestId('ar-total')).not.toHaveText(/ 0\.00$/);
}

test.describe('Payment at reservation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('takes a bank-transfer deposit with its reference and slip', async ({ page }) => {
    const cfg = await config(page);
    let checkin = '';
    const start = 12 + Math.floor(Math.random() * 10);
    for (let offset = start; offset < start + 30 && !checkin; offset++) {
      const day = addDays(cfg.today, offset);
      if (await freeOn(page, day, 1)) checkin = day;
    }
    expect(checkin, 'a free, priced night in the demo data').not.toBe('');

    await page.goto(`/app/reservations/new?checkin=${checkin}&nights=1`);
    await pickFirstRoomType(page);
    await page.locator('#ar-guest-name').fill('Deposit Dharmasena');
    // A future stay cannot be checked in.
    await expect(page.getByRole('button', { name: 'Check-in' })).toBeDisabled();

    await page.getByRole('combobox', { name: 'Payment mode' }).click();
    await page.getByRole('option', { name: /Bank Transfer/ }).click();
    await page.locator('#ar-pay-amount').fill('5000');

    // A bank transfer needs its reference: Reserve points at the missing field.
    await page.getByRole('button', { name: 'Reserve' }).click();
    await expect(page.getByText(/needs its reference number/)).toBeVisible();

    await page.locator('#ar-pay-reference').fill('CEFTS-5521');
    await page.getByLabel('Slip photo').setInputFiles({
      name: 'slip.png',
      mimeType: 'image/png',
      buffer: Buffer.from('%PNG playwright slip'),
    });
    await expect(page.getByText('slip.png')).toBeVisible();
    await expect(page.getByText('Paid now')).toBeVisible();

    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/reservations') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Reserve' }).click();
    const response = await saved;
    const created = await response.json();
    expect(response.status(), JSON.stringify(created)).toBe(201);
    const { headers } = await api(page);
    try {
      expect(created.payment).toMatchObject({ amount: '5000.00' });
      expect(created.payment.receiptNo).toMatch(/^RC\d{2}-\d{5}$/);
      const folio = await (
        await page.request.get(`${API}/bookings/${created.bookings[0].id}/folio`, { headers })
      ).json();
      const [paid] = folio.windows[0].payments;
      expect(paid).toMatchObject({ reference: 'CEFTS-5521', amount: '5000.00' });
      expect(paid.attachmentFileId).toBeTruthy();
      // The slip is private: no token, no file.
      expect((await page.request.get(`${API}/files/${paid.attachmentFileId}`)).status()).toBe(401);
    } finally {
      await page.request.post(`${API}/bookings/${created.bookings[0].id}/cancel`, { headers });
    }
  });

  test('checks a walk-in guest straight in', async ({ page }) => {
    const cfg = await config(page);
    test.skip(!(await freeOn(page, cfg.today, 1)), 'no room free tonight in the demo data');

    await page.goto(`/app/reservations/new?checkin=${cfg.today}&nights=1`);
    await pickFirstRoomType(page);
    await page.locator('#ar-guest-name').fill('Walkin Wickramasinghe');

    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/reservations') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Check-in' }).click();
    const response = await saved;
    const created = await response.json();
    // Every physical room of the type may be taken even though the type still sells: say so.
    test.skip(
      response.status() === 409 && created.reason === 'no_room_free',
      'no physical room free tonight',
    );
    expect(response.status(), JSON.stringify(created)).toBe(201);
    const { headers } = await api(page);
    try {
      expect(created).toMatchObject({ status: 'CheckedIn', checkedIn: true });
      expect(created.bookings[0].roomCode).toBeTruthy();
      await page.waitForURL(`**/app/reservations?tab=inhouse&q=${created.reference}`);
      await expect(page.getByText(`${created.guest.name} is checked in`)).toBeVisible();
    } finally {
      // A checked-in guest cannot be cancelled; check them out again.
      await page.request.post(`${API}/bookings/${created.bookings[0].id}/check-out`, { headers });
    }
  });
});
