import { test, expect, type Page } from '@playwright/test';

/**
 * Reservation setup (Development Phase 02, Sprint 1): the owner maintains the lists every
 * reservation picks from, per property country.
 */

const OWNER_EMAIL = 'owner@demo.yohobed.test';
const PASSWORD = 'password123';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill(OWNER_EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

test.describe('Reservation setup', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('lists the seeded Sri Lankan sources, grouped by booking source', async ({ page }) => {
    // An old tab link lands on the section that tab became (Configuration, 2026-09-26).
    await page.goto('/app/configuration?tab=sources');
    await page.waitForURL('**/app/configuration/business-sources');
    await expect(page.getByRole('heading', { name: 'Business sources' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Booking\.com/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Walk-in/ })).toBeVisible();

    await page.getByRole('tab', { name: /^OTA/ }).click();
    await expect(page.getByRole('cell', { name: /Agoda/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Walk-in/ })).toHaveCount(0);
  });

  test('deep-links to a tab and shows the local payment methods', async ({ page }) => {
    await page.goto('/app/configuration?tab=payments');
    await expect(page.getByRole('cell', { name: 'LankaQR', exact: true })).toBeVisible();
    await expect(page.getByText('Default cash')).toBeVisible();
  });

  test('adds a market segment and deactivates it again', async ({ page }) => {
    const code = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await page.goto('/app/configuration?tab=segments');
    await page.getByRole('button', { name: 'Add segment' }).click();

    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Code').fill(code);
    await sheet.getByLabel('Name').fill('Wellness retreats');
    await sheet.getByRole('radio', { name: 'teal' }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Segment added')).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toBeVisible();
    await row.click();
    await page.getByRole('dialog').getByRole('switch', { name: 'Active' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('Inactive');
  });

  test('saves the staff discount limit', async ({ page }) => {
    await page.goto('/app/configuration?tab=reservations');
    const limit = page.getByLabel('Staff discount limit in percent');
    await limit.fill('15');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Reservation settings saved')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Staff discount limit in percent')).toHaveValue('15');

    // Put it back so the demo tenant stays at its default.
    await page.getByLabel('Staff discount limit in percent').fill('0');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Reservation settings saved')).toBeVisible();
  });
});

test.describe('Configuration, Yanolja style', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('adds a rate type with breakfast and dinner, then deletes it', async ({ page }) => {
    const suffix = Date.now().toString(36).slice(-5).toUpperCase();
    const name = `E2E Half board ${suffix}`;
    await page.goto('/app/configuration/rate-types');
    await page.getByRole('link', { name: 'Add rate type' }).click();
    await page.waitForURL('**/app/configuration/rate-types/new');

    await page.getByLabel('Rate type name').fill(name);
    await page.getByLabel('Short code').fill(`HB${suffix}`);
    await page.getByRole('switch', { name: 'Does this rate type include meals?' }).click();
    await page.getByRole('checkbox', { name: 'Breakfast' }).click();
    await page.getByRole('checkbox', { name: 'Dinner' }).click();
    await page.getByRole('button', { name: 'Add rate type' }).click();
    await expect(page.getByText(`${name} is added`)).toBeVisible();

    await page.waitForURL('**/app/configuration/rate-types');
    const row = page
      .getByRole('list', { name: 'Rate types' })
      .getByRole('listitem')
      .filter({ hasText: name });
    await expect(row).toContainText('Breakfast and dinner');

    await row.getByRole('button', { name: `Delete ${name}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(`${name} is deleted`)).toBeVisible();
  });

  test('previews a guest email with the details it is sent with', async ({ page }) => {
    await page.goto('/app/configuration/email-templates');
    await page.getByRole('button', { name: 'Thank you at check-out' }).click();
    const preview = page.getByRole('region', { name: 'Preview' });
    await expect(preview).toContainText('Nimal Perera');
    await expect(page.getByRole('button', { name: 'Guest name' })).toBeVisible();
    // The thank-you is not sent with a balance, so the editor offers none.
    await expect(page.getByRole('button', { name: 'Balance due' })).toHaveCount(0);
  });

  test('opens the hotel profile on the tab in the address', async ({ page }) => {
    await page.goto('/app/configuration/profile?tab=policies');
    await expect(page.getByRole('tab', { name: 'Policies' })).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByLabel('Cancellation')).toBeVisible();
  });
});
