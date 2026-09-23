const { chromium, expect } = require('../apps/web-extranet/node_modules/@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, '../output/stayview-prototype.html')).href);
    await expect(page.getByRole('heading', { name: 'Stay view', exact: true })).toBeVisible();
    const out = path.join(__dirname, '../output/prototype-checks');
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'desktop.png') });
    await page.getByRole('button', { name: '1 · Find & book' }).click();
    await page.getByLabel('Guest name').fill('Ada Sample');
    await page.getByRole('button', { name: 'Create preview reservation' }).click();
    await expect(page.locator('#toast')).toContainText('saved');
    await page.reload();
    await page.getByRole('button', { name: '2 · Assign a room' }).click();
    await page.getByRole('button', { name: 'Save reviewed change' }).click();
    await expect(page.locator('#toast')).toContainText('saved');
    await page.reload();
    await page.getByRole('button', { name: '3 · Move a booking' }).click();
    await page.getByLabel('Room', { exact: true }).selectOption('8');
    await expect(page.locator('#review')).toContainText('Difference');
    await page.getByRole('button', { name: 'Save reviewed change' }).click();
    await page.reload();
    await page.getByRole('button', { name: '4 · Extend a stay' }).click();
    await page.getByLabel('Departure', { exact: true }).fill('2026-09-26');
    await expect(page.locator('#review')).toContainText('LKR 18,000');
    await page.screenshot({ path: path.join(out, 'review.png') });
    await page.getByRole('button', { name: 'Save reviewed change' }).click();
    await page.reload();
    await page.getByRole('button', { name: '5 · Dirty-room arrival' }).click();
    await expect(page.getByRole('button', { name: 'Check in guest' })).toBeDisabled();
    await page.getByRole('button', { name: 'Simulate housekeeping: mark ready' }).click();
    await expect(page.getByRole('button', { name: 'Check in guest' })).toBeEnabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '6 · Guest occasion' }).click();
    await page.getByLabel('Arrange flowers before arrival').check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Try 200 rooms' }).click();
    await expect(page.locator('#room-count')).toHaveText('200');
    await page.getByLabel('Search rooms and guests').fill('Sarah');
    await expect(
      page.locator('#chart tbody .room-label').filter({ hasText: '101 · Lotus' }),
    ).toBeVisible();
    await page.getByLabel('Search rooms and guests').fill('');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: path.join(out, 'tablet.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('#agenda')).toBeVisible();
    await page.screenshot({ path: path.join(out, 'phone.png') });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(
      'PASS: six prototype workflows, 200 rooms, search, keyboard close, tablet and phone layouts; no browser errors.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
