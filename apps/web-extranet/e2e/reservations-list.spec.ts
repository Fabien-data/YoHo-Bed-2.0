import { test, expect, type Page } from '@playwright/test';

/**
 * The Reservations list (Development Phase 02, Sprint 4): columns you choose are remembered, a
 * group opens from its card, and Export downloads every row.
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

/** Book a two-room reservation through the API, somewhere the demo hotel has room. */
async function bookGroup(page: Page) {
  const { headers, propertyId } = await api(page);
  const config = await (
    await page.request.get(`${API}/properties/${propertyId}/reservation-config`, { headers })
  ).json();
  const start = 12 + Math.floor(Math.random() * 8);
  for (let offset = start; offset < start + 30; offset++) {
    const checkin = addDays(config.today, offset);
    const checkout = addDays(checkin, 1);
    const grid = await (
      await page.request.get(
        `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${checkout}`,
        { headers },
      )
    ).json();
    const rt = grid.roomTypes?.find(
      (r: { free: number; rateTypes: Array<{ priced: boolean }> }) =>
        r.free >= 2 && r.rateTypes.some((t) => t.priced),
    );
    if (!rt) continue;
    const occupancyId = rt.rateTypes.find((t: { priced: boolean }) => t.priced).occupancyId;
    const res = await page.request.post(`${API}/reservations`, {
      headers,
      data: {
        propertyId,
        checkin,
        checkout,
        guest: { name: 'Playwright Group' },
        lines: [
          { roomId: rt.roomId, occupancyId, adults: 2 },
          { roomId: rt.roomId, occupancyId, adults: 1 },
        ],
      },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as { reference: string; bookings: Array<{ id: string }> };
  }
  throw new Error('no free, priced stay in the demo data');
}

async function cancelAll(page: Page, bookings: Array<{ id: string }>) {
  const { headers } = await api(page);
  for (const b of bookings) await page.request.post(`${API}/bookings/${b.id}/cancel`, { headers });
}

test.describe('Reservations list', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('remembers the columns you choose', async ({ page }) => {
    const created = await bookGroup(page);
    try {
      await columnsRoundTrip(page, created.reference);
    } finally {
      await cancelAll(page, created.bookings);
    }
  });

  async function columnsRoundTrip(page: Page, reference: string) {
    await page.goto(`/app/reservations?tab=upcoming&q=${reference}`);
    const room = page.getByRole('columnheader', { name: 'Room details' });
    const booked = page.getByRole('columnheader', { name: 'Booking date' });
    await expect(room).toBeVisible();
    await expect(booked).toBeHidden();

    // Hide one column, show one that is off by default.
    await page.getByRole('button', { name: 'Manage columns' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Room details' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Booking date' }).click();
    await page.keyboard.press('Escape');
    await expect(room).toBeHidden();
    await expect(booked).toBeVisible();

    await page.reload();
    await expect(page.getByRole('columnheader', { name: 'Arrival' })).toBeVisible();
    await expect(room).toBeHidden();
    await expect(booked).toBeVisible();

    await page.getByRole('button', { name: 'Manage columns' }).click();
    await page.getByRole('menuitem', { name: 'Reset to default' }).click();
    await expect(room).toBeVisible();
    await expect(booked).toBeHidden();
  }

  test('opens a group from its card and lists its rooms', async ({ page }) => {
    const created = await bookGroup(page);
    try {
      await page.goto('/app/reservations');
      await page.getByRole('radio', { name: 'Groups' }).click();
      await page.getByRole('radio', { name: 'Cards' }).click();
      await page.getByLabel('Search reservations').fill(created.reference);
      const card = page.getByTestId('group-card');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('2 (2)');
      await card.getByRole('button', { name: /Playwright Group/ }).click();

      await expect(page.getByText(`Group ${created.reference}`).first()).toBeVisible();
      await expect(page.getByText(`${created.reference}-1`)).toBeVisible();
      await expect(page.getByText(`${created.reference}-2`)).toBeVisible();
    } finally {
      await cancelAll(page, created.bookings);
    }
  });

  test('exports the tab as a CSV download', async ({ page }) => {
    await page.goto('/app/reservations?tab=cancelled');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^reservations-cancelled-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
