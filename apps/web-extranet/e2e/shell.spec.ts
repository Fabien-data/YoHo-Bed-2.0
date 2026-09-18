import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke coverage for the PMS shell.
 *
 * The bar is deliberately "does every route actually render for a signed-in owner" rather than
 * detailed assertions per screen. That is the regression this catches: a shell change (new nav
 * model, new provider, a client/server boundary mistake) silently white-screening a page that
 * nothing else tests. Per-screen behaviour belongs in the spec for that screen.
 */

const OWNER_EMAIL = 'owner@demo.yohobed.test';
const PASSWORD = 'password123';

/** Every route reachable from the nav, plus the page each one must show to prove it rendered. */
const ROUTES: Array<{ path: string; heading: RegExp }> = [
  { path: '/app', heading: /dashboard|today|arrivals/i },
  { path: '/app/bookings', heading: /booking|reservation/i },
  { path: '/app/calendar', heading: /calendar|rates|inventory/i },
  { path: '/app/deals', heading: /promotion|deal|coupon/i },
  { path: '/app/inbox', heading: /inbox|reservation/i },
  { path: '/app/comms', heading: /message|template|communication/i },
  { path: '/app/customers', heading: /guest|customer/i },
  { path: '/app/reviews', heading: /review/i },
  { path: '/app/finance', heading: /finance|revenue|payout/i },
  { path: '/app/setup', heading: /setup|propert/i },
  { path: '/app/profile', heading: /profile|account/i },
  { path: '/app/plan', heading: /plan/i },
  // The Yanolja-parity screens (Sprints 3–7). These are exactly the pages a provider or shell
  // regression is most likely to white-screen, so they must be in the smoke list too.
  { path: '/app/stayview', heading: /stay view/i },
  { path: '/app/roomview', heading: /room view/i },
  { path: '/app/reservations', heading: /reservation/i },
  { path: '/app/folios', heading: /folio|unsettled/i },
  { path: '/app/cashiering', heading: /cashiering/i },
  { path: '/app/night-audit', heading: /night audit/i },
  // Development Phase 02.
  { path: '/app/configuration', heading: /reservation setup/i },
  { path: '/app/reservations/new', heading: /add reservation/i },
];

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill(OWNER_EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

test.describe('PMS shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('renders the property identity and the grouped nav', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible();

    // The Yanolja grouping is the point of the shell — assert the groups, not just the links.
    for (const group of ['Front desk', 'Rates & availability', 'Distribution', 'Guest']) {
      await expect(nav.getByText(group, { exact: true })).toBeVisible();
    }
    await expect(nav.getByRole('link', { name: 'Reservations' })).toBeVisible();
  });

  test('opens the command palette with Ctrl+K and navigates from it', async ({ page }) => {
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(/search reservations, guests and more/i);
    await expect(input).toBeVisible();

    await input.fill('Promotions');
    await page
      .getByRole('option', { name: /promotions/i })
      .first()
      .click();
    await page.waitForURL('**/app/deals');
  });

  test('marks the current section in the nav', async ({ page }) => {
    await page.goto('/app/finance');
    const current = page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]');
    await expect(current).toHaveText(/finance/i);
  });

  for (const { path, heading } of ROUTES) {
    test(`renders ${path}`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));

      await page.goto(path);
      // A white screen still "loads", so assert real content and no thrown errors.
      await expect(page.getByRole('heading').first()).toContainText(heading, { timeout: 15_000 });
      expect(errors, `uncaught errors on ${path}`).toEqual([]);
    });
  }
});

test('redirects an unauthenticated visitor away from the app', async ({ page }) => {
  await page.goto('/app/finance');
  await page.waitForURL('**/', { timeout: 10_000 });
  await expect(page.getByLabel(/email/i)).toBeVisible();
});
