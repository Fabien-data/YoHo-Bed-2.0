import { test, expect, type Page } from '@playwright/test';

/**
 * Two desks, one house (UX-STANDARD principle 3): a stay made at one desk appears on another
 * desk's open Stay View by itself — no reload, no waiting for a poll.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app');
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('a stay made at another desk appears without a reload', async ({ page }) => {
  await signIn(page);
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const [property] = await (await page.request.get(`${API}/properties`, { headers })).json();
  const config = await (
    await page.request.get(`${API}/properties/${property.id}/reservation-config`, { headers })
  ).json();
  const checkin = addDays(config.calendarToday ?? config.today, 9);
  const checkout = addDays(checkin, 2);

  await page.goto(`/app/stayview?from=${addDays(checkin, -1)}`);
  await expect(page.getByRole('region', { name: 'Stay calendar' })).toBeVisible();
  // The stream is up once the status line says so.
  await expect(page.getByRole('status').getByText('Live')).toBeVisible({ timeout: 15_000 });

  const availability = await (
    await page.request.get(
      `${API}/properties/${property.id}/room-availability?checkin=${checkin}&checkout=${checkout}`,
      { headers },
    )
  ).json();
  const room = availability.roomTypes.find(
    (r: any) => r.units.some((u: any) => u.free) && r.rateTypes.some((t: any) => t.priced),
  );
  const unit = room.units.find((u: any) => u.free);
  const rate = room.rateTypes.find((t: any) => t.priced);
  const guest = `Live Desk ${Date.now().toString(36)}`;

  // The other desk books — through the API, not this page.
  const created = await page.request.post(`${API}/reservations`, {
    headers,
    data: {
      propertyId: property.id,
      checkin,
      checkout,
      kind: 'confirm',
      guest: { name: guest },
      lines: [
        {
          roomId: room.roomId,
          occupancyId: rate.occupancyId,
          roomUnitId: unit.id,
          adults: 2,
          children: 0,
        },
      ],
    },
  });
  expect(created.status()).toBe(201);
  const booking = (await created.json()).bookings[0];
  try {
    await expect(page.getByRole('button', { name: new RegExp(guest) })).toBeVisible({
      timeout: 8_000,
    });
  } finally {
    await page.request.post(`${API}/bookings/${booking.id}/cancel`, { headers });
  }
});
