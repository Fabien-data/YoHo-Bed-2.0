import { test, expect, type Page } from '@playwright/test';

/**
 * A new reservation from the tape chart: double-click an empty night and the Quick Reservation
 * opens for that room, from that date; or select empty nights and use the action bar.
 */

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** An empty night on some room, on screen, clear of every bar. */
async function emptyNight(page: Page, skipColumns = 2) {
  return page.evaluate((skip) => {
    const grid = document.querySelector<HTMLElement>('.sv-grid')!;
    const col = Number(grid.dataset.colWidth);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-unit-id]'))) {
      const box = el.getBoundingClientRect();
      const bars = Array.from(el.querySelectorAll('[data-bar-id]')).map((b) =>
        b.getBoundingClientRect(),
      );
      const cols = Math.floor(box.width / col);
      // Skip the first columns: the window starts on today, which may already be past.
      for (let i = skip; i < cols - 1; i++) {
        const x = box.left + i * col + col / 2;
        const y = box.top + box.height / 2;
        if (x > window.innerWidth - 10 || y > window.innerHeight - 10) continue;
        const nextX = x + col;
        if (
          !bars.some((b) => (x >= b.left && x <= b.right) || (nextX >= b.left && nextX <= b.right))
        ) {
          return {
            code: el.dataset.unitCode!,
            index: i,
            x,
            y,
            col,
            from: grid.dataset.windowFrom!,
          };
        }
      }
    }
    return null;
  }, skipColumns);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test('double-clicking an empty night opens a reservation for that room and date', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/app/stayview');
  await expect(page.locator('[data-unit-id]').first()).toBeVisible();

  const target = await emptyNight(page);
  expect(target).not.toBeNull();
  const date = addDays(target!.from, target!.index);

  await page.mouse.dblclick(target!.x, target!.y);
  const sheet = page.getByRole('dialog', { name: 'Quick Reservation' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Check-in date')).toHaveValue(dmy(date));
  await expect(sheet.getByRole('combobox', { name: 'Room, room 1' })).toHaveText(target!.code);
  await expect(sheet.getByRole('combobox', { name: 'Rate type, room 1' })).not.toHaveText(
    '-Select-',
  );
});

test('selecting empty nights offers reserve, hold and block right there', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/stayview');
  await expect(page.locator('[data-unit-id]').first()).toBeVisible();
  const target = await emptyNight(page);
  expect(target).not.toBeNull();

  // Drag across two nights of one room.
  await page.mouse.move(target!.x, target!.y);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.col, target!.y, { steps: 4 });
  await page.mouse.up();

  const bar = page.getByRole('toolbar', { name: new RegExp(`Selected: room ${target!.code}`) });
  await expect(bar).toBeVisible();
  await expect(bar.getByText('2 nights')).toBeVisible();
  for (const name of ['Reserve', 'Hold', 'Block', 'Out of service'])
    await expect(bar.getByRole('button', { name })).toBeVisible();

  await bar.getByRole('button', { name: 'Reserve' }).click();
  const sheet = page.getByRole('dialog', { name: 'Quick Reservation' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel('Check-in date')).toHaveValue(
    dmy(addDays(target!.from, target!.index)),
  );
  await expect(sheet.getByRole('combobox', { name: 'Room, room 1' })).toHaveText(target!.code);
});

test('Escape clears a selection of nights', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/stayview');
  await expect(page.locator('[data-unit-id]').first()).toBeVisible();
  const target = await emptyNight(page);
  await page.mouse.click(target!.x, target!.y);
  const bar = page.getByRole('toolbar', { name: /Selected: room/ });
  await expect(bar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
});
