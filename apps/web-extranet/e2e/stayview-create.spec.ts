import { test, expect, type Page } from '@playwright/test';

/**
 * A new reservation from the tape chart (Development Phase 02, Sprint 3): double-click an empty
 * night and the Quick Reservation opens for that room, from that date.
 */

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

test('double-clicking an empty night opens a reservation for that room and date', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/app/stayview');
  const strip = page.locator('[data-unit-id]').first();
  await expect(strip).toBeVisible();

  // Find a night on some room with no bar on it — the demo data books some rooms already.
  const target = await page.evaluate(() => {
    const COL = 92;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-unit-id]'))) {
      const box = el.getBoundingClientRect();
      const bars = Array.from(el.querySelectorAll('button')).map((b) => b.getBoundingClientRect());
      const cols = Math.floor(box.width / COL);
      // Skip the first two columns: the window starts on today, which may already be past.
      for (let i = 2; i < cols; i++) {
        const x = box.left + i * COL + COL / 2;
        const y = box.top + box.height / 2;
        // Only a cell the mouse can actually reach without scrolling.
        if (x > window.innerWidth - 10 || y > window.innerHeight - 10) continue;
        if (!bars.some((b) => x >= b.left && x <= b.right)) {
          return {
            unitId: el.dataset.unitId!,
            code: el.dataset.unitCode!,
            index: i,
            x,
            y: box.top + box.height / 2,
          };
        }
      }
    }
    return null;
  });
  expect(target).not.toBeNull();

  // The column's date, from the header — the chart starts on the window's first date.
  const from = await page.getByLabel('Window start date').inputValue();
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + target!.index);
  const date = d.toISOString().slice(0, 10);

  await page.mouse.dblclick(target!.x, target!.y);
  const sheet = page.getByRole('dialog', { name: 'Quick Reservation' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Check-in date')).toHaveValue(dmy(date));
  await expect(sheet.getByRole('combobox', { name: 'Room, room 1' })).toHaveText(target!.code);
  await expect(sheet.getByRole('combobox', { name: 'Rate type, room 1' })).not.toHaveText(
    '-Select-',
  );
});
