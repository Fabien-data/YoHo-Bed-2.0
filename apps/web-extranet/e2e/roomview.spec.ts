import { test, expect, type Page } from '@playwright/test';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const addDays = (iso: string, n: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
};

async function makeAssignedBooking(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const properties = await (await page.request.get(`${API}/properties`, { headers })).json();
  const propertyId = properties[0].id as string;
  const config = await (
    await page.request.get(`${API}/properties/${propertyId}/reservation-config`, { headers })
  ).json();
  for (let offset = 18; offset < 45; offset++) {
    const checkin = addDays(config.today, offset);
    const checkout = addDays(checkin, 1);
    const grid = await (
      await page.request.get(
        `${API}/properties/${propertyId}/room-availability?checkin=${checkin}&checkout=${checkout}`,
        { headers },
      )
    ).json();
    const roomType = grid.roomTypes?.find(
      (room: {
        free: number;
        units: Array<{ free: boolean }>;
        rateTypes: Array<{ priced: boolean }>;
      }) =>
        room.free > 0 &&
        room.units.some((unit) => unit.free) &&
        room.rateTypes.some((rate) => rate.priced),
    );
    if (!roomType) continue;
    const unit = roomType.units.find((candidate: { free: boolean }) => candidate.free);
    const rate = roomType.rateTypes.find((candidate: { priced: boolean }) => candidate.priced);
    const response = await page.request.post(`${API}/reservations`, {
      headers,
      data: {
        propertyId,
        checkin,
        checkout,
        guest: { name: 'Room View PDF', email: 'roomview@example.test' },
        lines: [
          {
            roomId: roomType.roomId,
            occupancyId: rate.occupancyId,
            roomUnitId: unit.id,
            adults: 1,
          },
        ],
      },
    });
    if (response.status() === 409) continue;
    expect(response.status(), await response.text()).toBe(201);
    const created = await response.json();
    return { headers, propertyId, checkin, unit, bookingId: created.bookings[0].id as string };
  }
  throw new Error('No free, priced room for the Room View document test');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app');
  await page.goto('/app/roomview');
  await expect(page.locator('[data-room-id]').first()).toBeVisible();
});

test('keeps the date, floor and live room cards across Floor and Rooms', async ({ page }) => {
  const date = await page.getByLabel('Business date').inputValue();
  const modes = page.getByRole('tablist', { name: 'Room presentation' });
  await modes.getByRole('tab', { name: 'Floor' }).click();
  await expect(modes.getByRole('tab', { name: 'Floor' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Business date')).toHaveValue(date);
  const roomId = await page.locator('[data-room-id]').first().getAttribute('data-room-id');
  await expect(page.locator(`[data-room-id="${roomId}"]`)).toBeVisible();

  await page.locator(`[data-room-id="${roomId}"]`).locator('button').first().click();
  const detail = page.getByRole('dialog', { name: /Room / });
  await expect(detail).toBeVisible();

  const floor = await page.locator('#room-floor').inputValue();
  await modes.getByRole('tab', { name: 'Rooms' }).click();
  await expect(detail).toBeVisible();
  await expect(page.locator('#room-floor')).toHaveValue(floor);
  await expect(page.locator(`[data-room-id="${roomId}"]`)).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await expect(
    page.locator(`[data-room-id="${roomId}"]`).getByRole('button', { name: /Quick housekeeping/ }),
  ).toBeVisible();
});

test('exposes the cleaning queue and tile action on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('Priority cleaning queue')).toBeVisible();
  const quick = page.getByRole('button', { name: /Quick housekeeping for room/ }).first();
  await quick.click();
  await expect(page.getByRole('button', { name: 'Dirty', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspected', exact: true })).toBeVisible();
});

test('supports keyboard mode switching with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const floor = page.getByRole('tab', { name: 'Floor' });
  await floor.focus();
  await page.keyboard.press('Enter');
  await expect(floor).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-room-id]').first()).toBeVisible();
});

test('opens a reservation and previews the same voucher PDF offered for printing', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const booking = await makeAssignedBooking(page);
  try {
    await page.evaluate(
      (propertyId) => localStorage.setItem('yhb_property_id', propertyId),
      booking.propertyId,
    );
    await page.reload();
    await page.getByLabel('Business date').fill(booking.checkin);
    const tile = page.locator(`[data-room-id="${booking.unit.id}"]`);
    await expect(tile).toBeVisible();
    await tile.locator('button').first().click();
    const drawer = page.getByRole('dialog', { name: `Room ${booking.unit.code}` });
    await expect(drawer.getByText('Reservation actions')).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Print reservation voucher' })).toBeVisible();
    const pdf = await page.request.get(`${API}/reservations/${booking.bookingId}/voucher/pdf`, {
      headers: booking.headers,
    });
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    await drawer.getByRole('button', { name: 'Send email' }).click();
    const preview = page.getByRole('dialog', { name: /Review and send Reservation voucher/i });
    await expect(preview.getByTitle('Reservation voucher PDF preview')).toBeVisible();
    await expect(preview.getByLabel('Recipients (comma separated)')).toHaveValue(
      'roomview@example.test',
    );
    await preview.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    await page.request
      .post(`${API}/bookings/${booking.bookingId}/cancel`, {
        headers: booking.headers,
        timeout: 10_000,
      })
      .catch(() => undefined);
  }
});
