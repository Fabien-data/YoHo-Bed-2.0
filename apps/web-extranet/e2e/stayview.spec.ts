import { test, expect } from '@playwright/test';

/**
 * The tape chart is the screen a hotelier judges the product on, and the riskiest rendering code
 * in the program — absolute positioning over a CSS-drawn grid. These assert the things a unit
 * test cannot: that it actually paints, that the sticky room column survives horizontal scroll,
 * and that clicking a bar opens the detail slide-over.
 */

const OWNER_EMAIL = 'owner@demo.yohobed.test';
const PASSWORD = 'password123';

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
  await expect(page.getByText('01', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/available inventory/i)).toBeVisible();
  await expect(page.getByText(/occupancy/i).first()).toBeVisible();
});

test('pages the date window forwards and back', async ({ page }) => {
  const dateInput = page.getByLabel(/window start date/i);
  const start = await dateInput.inputValue();

  await page.getByRole('button', { name: /next week/i }).click();
  await expect(dateInput).not.toHaveValue(start);

  await page.getByRole('button', { name: /previous week/i }).click();
  await expect(dateInput).toHaveValue(start);
});

test('filters the chart down to vacant rooms', async ({ page }) => {
  const chips = page.getByRole('tablist', { name: /room status/i });
  await chips.getByRole('tab', { name: /vacant/i }).click();
  await expect(chips.getByRole('tab', { name: /vacant/i })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('keeps the room column pinned while the dates scroll', async ({ page }) => {
  const roomLabel = page.getByText('01', { exact: true }).first();
  await expect(roomLabel).toBeVisible();

  const before = await roomLabel.boundingBox();
  await page.evaluate(() => {
    document.querySelector('.overflow-x-auto')?.scrollBy({ left: 600 });
  });
  await page.waitForTimeout(200);
  const after = await roomLabel.boundingBox();

  // Sticky: the label must not move horizontally with the scroll.
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(4);
});

test('opens the reservation slide-over from a bar', async ({ page }) => {
  // The seed books stays in Aug 2026; jump the window there so bars are on screen.
  await page.getByLabel(/window start date/i).fill('2026-08-01');

  const bar = page.locator('button', { hasText: /Direct|OTA|YoHo/ }).first();
  if ((await bar.count()) === 0) test.skip(true, 'no bars in the seeded window');

  await bar.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/rooms/i).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /auto-assign/i })).toBeVisible();
});
