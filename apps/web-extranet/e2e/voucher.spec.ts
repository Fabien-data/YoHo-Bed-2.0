import { test, expect, type Page } from '@playwright/test';

/**
 * The booking voucher and the guest booking page (Development Phase 02, Sprint 6): the desk makes
 * the link, the guest opens it with no login, and closing it shuts the page.
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

async function makeBooking(page: Page) {
  const { headers, propertyId } = await api(page);
  const cfg = await (
    await page.request.get(`${API}/properties/${propertyId}/reservation-config`, { headers })
  ).json();
  const start = 15 + Math.floor(Math.random() * 12);
  for (let offset = start; offset < start + 30; offset++) {
    const checkin = addDays(cfg.today, offset);
    const grid = await (
      await page.request.get(
        `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${addDays(checkin, 2)}`,
        { headers },
      )
    ).json();
    const rt = grid.roomTypes?.find(
      (r: { free: number; rateTypes: Array<{ priced: boolean }> }) =>
        r.free >= 1 && r.rateTypes.some((t) => t.priced),
    );
    if (!rt) continue;
    const res = await page.request.post(`${API}/reservations`, {
      headers,
      data: {
        propertyId,
        checkin,
        checkout: addDays(checkin, 2),
        guest: { name: 'Voucher Playwright', email: 'voucher@guest.test' },
        lines: [
          {
            roomId: rt.roomId,
            occupancyId: rt.rateTypes.find((t: { priced: boolean }) => t.priced).occupancyId,
            adults: 2,
          },
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    return { headers, created: await res.json() };
  }
  throw new Error('no free, priced stay in the demo data');
}

test.describe('Voucher and guest page', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('makes the guest link, opens it without a login, and closes it again', async ({
    page,
    context,
  }) => {
    const { headers, created } = await makeBooking(page);
    const bookingId = created.bookings[0].id as string;

    await page.goto(`/app/reservations?tab=upcoming&q=${created.reference}`);
    await page
      .getByRole('button', { name: /Voucher Playwright/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: `Reservation ${created.reference}` });
    await expect(sheet.getByRole('heading', { name: 'Voucher and guest page' })).toBeVisible();

    // The voucher email, with the guest already on it.
    await sheet.getByRole('button', { name: 'Send voucher' }).click();
    const send = page.getByRole('dialog', { name: 'Send the booking voucher' });
    await expect(send.locator('textarea').first()).toHaveValue(/voucher@guest\.test/);
    await expect(send.locator('textarea').last()).toHaveValue(new RegExp(created.reference));
    await send.getByRole('button', { name: 'Cancel' }).click();

    await sheet.getByRole('button', { name: 'Create guest link' }).click();
    await expect(page.getByText(/Guest link created|Guest link copied/)).toBeVisible();

    const preview = await (
      await page.request.post(`${API}/reservations/${bookingId}/voucher/preview`, { headers })
    ).json();
    expect(preview.link).not.toBeNull();

    // The guest's side: a fresh browser, no session at all.
    const guest = await context.browser()!.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(preview.link.url);
    await expect(guestPage.getByText('your booking is confirmed')).toBeVisible();
    await expect(guestPage.getByText(created.reference)).toBeVisible();
    await expect(guestPage.getByText('voucher@guest.test')).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Close link' }).click();
    await expect(page.getByText('Guest link closed')).toBeVisible();
    await guestPage.reload();
    // The page writes a typographic apostrophe, so match either.
    await expect(guestPage.getByText(/This booking link isn.t valid/)).toBeVisible();
    await guest.close();

    await page.request.post(`${API}/bookings/${bookingId}/cancel`, { headers });
  });
});
