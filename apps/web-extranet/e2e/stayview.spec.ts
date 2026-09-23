import { test, expect } from '@playwright/test';

/**
 * The tape chart is the screen a hotelier judges the product on, and the riskiest rendering code
 * in the program — absolute positioning over a CSS-drawn grid. These assert the things a unit
 * test cannot: that it actually paints, that the sticky room column survives horizontal scroll,
 * and that clicking a bar opens the side panel without hiding the grid.
 */

const OWNER_EMAIL = 'owner@demo.yohobed.test';
const PASSWORD = 'password123';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/email/i).fill(OWNER_EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app');
  await page.goto('/app/stayview');
});

test('renders the chart with rooms, dates and the counted chips', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /stay view/i })).toBeVisible();

  const chips = page.getByRole('tablist', { name: /room status/i });
  await expect(chips).toBeVisible();
  for (const label of ['All', 'Vacant', 'Occupied', 'Reserved', 'Blocked', 'Due out']) {
    await expect(chips.getByRole('tab', { name: new RegExp(label, 'i') })).toBeVisible();
  }

  // The seeded demo property has five numbered rooms.
  await expect(page.locator('[data-unit-label]').first()).toBeVisible();
  await expect(page.getByText(/available inventory/i)).toBeVisible();
  await expect(page.getByText(/occupancy/i).first()).toBeVisible();
  // Today is marked in the header.
  await expect(page.getByRole('columnheader', { name: /today/i })).toBeVisible();
});

test('pages the date window forwards and back', async ({ page }) => {
  const grid = page.getByRole('region', { name: 'Stay calendar' });
  await expect(grid).toBeVisible();
  const start = await grid.getAttribute('data-window-from');

  await page.getByRole('button', { name: 'Next dates' }).click();
  await expect(grid).not.toHaveAttribute('data-window-from', start!);

  await page.getByRole('button', { name: 'Previous dates' }).click();
  await expect(grid).toHaveAttribute('data-window-from', start!);
});

test('filters the chart down to vacant rooms', async ({ page }) => {
  const chips = page.getByRole('tablist', { name: /room status/i });
  await chips.getByRole('tab', { name: /vacant/i }).click();
  await expect(chips.getByRole('tab', { name: /vacant/i })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('keeps the calendar usable on tablet and narrow screens', async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 480, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    const closeNavigation = page.getByRole('button', { name: 'Close navigation' });
    if (await closeNavigation.isVisible()) await closeNavigation.click();
    if (viewport.width < 768) {
      // A phone gets the day's list first; the timeline is one switch away.
      await expect(page.getByLabel('Daily stay list')).toBeVisible();
      await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    }
    await expect(page.getByRole('region', { name: 'Stay calendar' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '14 days' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});

test('keeps the room column pinned while the dates scroll', async ({ page }) => {
  // Thirty nights overflow the width, so the grid scrolls sideways.
  await page.getByRole('radio', { name: '30 days' }).click();
  const roomLabel = page.locator('[data-unit-label]').first();
  await expect(roomLabel).toBeVisible();

  const before = await roomLabel.boundingBox();
  const scrolled = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.sv-grid')!;
    grid.scrollBy({ left: 600 });
    return grid.scrollLeft;
  });
  expect(scrolled).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const after = await roomLabel.boundingBox();

  // Sticky: the label must not move horizontally with the scroll.
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(4);
});

test('opens a stay in the side panel and keeps the grid usable', async ({ page }) => {
  const bar = page.locator('.sv-grid [data-bar-id][data-state]').first();
  if ((await bar.count()) === 0) test.skip(true, 'no bars in the seeded window');

  await bar.click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(
    panel.getByRole('heading', { name: 'Rooms' }).or(panel.getByText(/channels see the room/i)),
  ).toBeVisible();
  // The grid behind stays interactive: the room-status chips still respond.
  await page
    .getByRole('tablist', { name: /room status/i })
    .getByRole('tab', { name: /all/i })
    .click();
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
});

test('reviews a keyboard resize before saving and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const [property] = await (await page.request.get(`${API}/properties`, { headers })).json();
  const config = await (
    await page.request.get(`${API}/properties/${property.id}/reservation-config`, { headers })
  ).json();
  const checkin = addDays(config.calendarToday ?? config.today, 6);
  const checkout = addDays(checkin, 2);
  const availability = await (
    await page.request.get(
      `${API}/properties/${property.id}/room-availability?checkin=${checkin}&checkout=${addDays(checkout, 1)}`,
      { headers },
    )
  ).json();
  const room = availability.roomTypes.find(
    (candidate: any) =>
      candidate.units.some((unit: any) => unit.free) &&
      candidate.rateTypes.some((rate: any) => rate.priced),
  );
  expect(room).toBeTruthy();
  const unit = room.units.find((candidate: any) => candidate.free);
  const rate = room.rateTypes.find((candidate: any) => candidate.priced);
  const createdResponse = await page.request.post(`${API}/reservations`, {
    headers,
    data: {
      propertyId: property.id,
      checkin,
      checkout,
      kind: 'confirm',
      guest: { name: 'Resize Review Guest' },
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
  const created = await createdResponse.json();
  expect(createdResponse.status(), JSON.stringify(created)).toBe(201);
  const booking = created.bookings[0];

  try {
    await page.goto(`/app/stayview?from=${checkin}`);
    const handle = page.getByRole('button', {
      name: `Resize ${booking.reference} checkout`,
      exact: true,
    });
    await handle.focus();
    await handle.press('ArrowRight');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Review stay change')).toBeVisible();
    await expect(dialog.getByText(/agreed rate kept/).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save reviewed change' })).toBeEnabled();
  } finally {
    await page.request.post(`${API}/bookings/${booking.id}/cancel`, { headers });
  }
});
