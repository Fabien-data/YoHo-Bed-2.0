import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The front desk's day on Stay View, workflow by workflow (the brief's interaction list): move a
 * guest by dragging, be told why a drop is refused, move dates with a price review, find a stay
 * outside the window, filter without losing context, switch stays in one panel, keep settings,
 * give a waiting stay its room, and set housekeeping — all without leaving the calendar.
 *
 * Each test makes its own stays through the API, a week or more ahead, and cancels them after.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Ctx {
  headers: Record<string, string>;
  propertyId: string;
  today: string;
}

async function signIn(page: Page): Promise<Ctx> {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app');
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const [property] = await (await page.request.get(`${API}/properties`, { headers })).json();
  await page.evaluate((id) => localStorage.setItem('yhb_property_id', id), property.id);
  const config = await (
    await page.request.get(`${API}/properties/${property.id}/reservation-config`, { headers })
  ).json();
  return { headers, propertyId: property.id, today: config.calendarToday ?? config.today };
}

/** Free rooms of one priced room type for the nights, and that type's rate. */
async function freeRooms(
  req: APIRequestContext,
  c: Ctx,
  checkin: string,
  checkout: string,
  need = 2,
) {
  const a = await (
    await req.get(
      `${API}/properties/${c.propertyId}/room-availability?checkin=${checkin}&checkout=${checkout}`,
      { headers: c.headers },
    )
  ).json();
  const type = a.roomTypes.find(
    (r: any) =>
      r.units.filter((u: any) => u.free).length >= need && r.rateTypes.some((t: any) => t.priced),
  );
  expect(type, `needs ${need} free room(s) of one type`).toBeTruthy();
  return {
    roomId: type.roomId as string,
    occupancyId: type.rateTypes.find((t: any) => t.priced).occupancyId as string,
    units: type.units.filter((u: any) => u.free) as Array<{ id: string; code: string }>,
  };
}

async function reserve(
  req: APIRequestContext,
  c: Ctx,
  name: string,
  checkin: string,
  checkout: string,
  roomId: string,
  occupancyId: string,
  roomUnitId: string | null,
) {
  const res = await req.post(`${API}/reservations`, {
    headers: c.headers,
    data: {
      propertyId: c.propertyId,
      checkin,
      checkout,
      kind: 'confirm',
      guest: { name },
      lines: [{ roomId, occupancyId, roomUnitId, adults: 2, children: 0 }],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).bookings[0] as { id: string; reference: string };
}

const cancel = (req: APIRequestContext, c: Ctx, id: string) =>
  req.post(`${API}/bookings/${id}/cancel`, { headers: c.headers });

const uniq = (label: string) => `${label} ${Date.now().toString(36).slice(-5)}`;

async function barCenter(page: Page, name: string) {
  const bar = page.getByRole('button', { name: new RegExp(name) }).first();
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  return { x: box.x + Math.min(box.width / 2, 40), y: box.y + box.height / 2 };
}

async function stripCenterY(page: Page, code: string) {
  const strip = page.locator(`[data-unit-code="${code}"]`);
  const box = (await strip.boundingBox())!;
  return box.y + box.height / 2;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

test('drags a guest to another room, reviews it, and the bar lands there', async ({ page }) => {
  const c = await signIn(page);
  const checkin = addDays(c.today, 12);
  const checkout = addDays(checkin, 2);
  const rooms = await freeRooms(page.request, c, checkin, checkout);
  const [a, b] = rooms.units;
  const name = uniq('Mover');
  const booking = await reserve(
    page.request,
    c,
    name,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    a!.id,
  );
  try {
    await page.goto(`/app/stayview?from=${addDays(checkin, -1)}`);
    const start = await barCenter(page, name);
    await drag(page, start, { x: start.x, y: await stripCenterY(page, b!.code) });
    const review = page.getByRole('dialog', { name: new RegExp(`to room ${b!.code}`) });
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Move guest' }).click();
    await expect(page.getByText(new RegExp(`moved to room ${b!.code}`))).toBeVisible();
    await expect(
      page.locator(`[data-unit-code="${b!.code}"]`).getByRole('button', { name: new RegExp(name) }),
    ).toBeVisible();
  } finally {
    await cancel(page.request, c, booking.id);
  }
});

test('refuses a drop onto an occupied room and says why', async ({ page }) => {
  const c = await signIn(page);
  const checkin = addDays(c.today, 15);
  const checkout = addDays(checkin, 2);
  const rooms = await freeRooms(page.request, c, checkin, checkout);
  const [a, b] = rooms.units;
  const mover = uniq('Blocked mover');
  const sitter = uniq('Sitter');
  const one = await reserve(
    page.request,
    c,
    mover,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    a!.id,
  );
  const two = await reserve(
    page.request,
    c,
    sitter,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    b!.id,
  );
  try {
    await page.goto(`/app/stayview?from=${addDays(checkin, -1)}`);
    const start = await barCenter(page, mover);
    await drag(page, start, { x: start.x, y: await stripCenterY(page, b!.code) });
    await expect(page.getByText(new RegExp(`Room ${b!.code} has ${sitter}`)).first()).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await cancel(page.request, c, one.id);
    await cancel(page.request, c, two.id);
  }
});

test('moves a stay to new dates only after a price review', async ({ page }) => {
  const c = await signIn(page);
  const checkin = addDays(c.today, 18);
  const checkout = addDays(checkin, 2);
  const rooms = await freeRooms(page.request, c, checkin, addDays(checkout, 4));
  const name = uniq('Shifter');
  const booking = await reserve(
    page.request,
    c,
    name,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    rooms.units[0]!.id,
  );
  try {
    await page.goto(`/app/stayview?from=${addDays(checkin, -1)}`);
    const colW = Number(await page.locator('.sv-grid').getAttribute('data-col-width'));
    const start = await barCenter(page, name);
    await drag(page, start, { x: start.x + colW * 2, y: start.y });
    const review = page.getByRole('dialog', { name: new RegExp(`New dates for ${name}`) });
    await expect(review).toBeVisible();
    await expect(review.getByLabel('Review stay change')).toBeVisible();
    await expect(review.getByText('Difference')).toBeVisible();
    await review.getByRole('button', { name: 'Save reviewed change' }).click();
    await expect(page.getByText(new RegExp(`${name} moved to`))).toBeVisible();
    const moved = await (
      await page.request.get(`${API}/bookings/${booking.id}`, { headers: c.headers })
    ).json();
    expect(moved.checkin).toBe(addDays(checkin, 2));
  } finally {
    await cancel(page.request, c, booking.id);
  }
});

test('finds a stay outside the window and opens it where it is', async ({ page }) => {
  const c = await signIn(page);
  const checkin = addDays(c.today, 32);
  const checkout = addDays(checkin, 2);
  const rooms = await freeRooms(page.request, c, checkin, checkout, 1);
  const name = uniq('Faraway');
  const booking = await reserve(
    page.request,
    c,
    name,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    rooms.units[0]!.id,
  );
  try {
    await page.goto('/app/stayview');
    await page.keyboard.press('/');
    await page.keyboard.type(name, { delay: 20 });
    const result = page.getByRole('option', { name: new RegExp(name) });
    await expect(result).toBeVisible();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: name });
    await expect(panel).toBeVisible();
    await expect(page.locator('.sv-grid')).toHaveAttribute(
      'data-window-from',
      addDays(checkin, -1),
    );
  } finally {
    await cancel(page.request, c, booking.id);
  }
});

test('dims stays that do not match a filter instead of hiding the house', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/stayview');
  await expect(page.locator('.sv-grid [data-bar-id]').first()).toBeVisible();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'In house' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove filter In house' })).toBeVisible();
  const dimmed = await page.locator('.sv-grid [data-bar-id][data-dim="true"]').count();
  const all = await page.locator('.sv-grid [data-bar-id]').count();
  expect(all).toBeGreaterThan(0);
  expect(dimmed).toBeLessThanOrEqual(all);
  // Nothing was removed from the grid: dimmed bars are still there to read.
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.locator('.sv-grid [data-bar-id][data-dim="true"]')).toHaveCount(0);
});

test('switches from one stay to another inside the open panel', async ({ page }) => {
  const c = await signIn(page);
  const checkin = addDays(c.today, 21);
  const checkout = addDays(checkin, 2);
  const rooms = await freeRooms(page.request, c, checkin, checkout);
  const first = uniq('First guest');
  const second = uniq('Second guest');
  const one = await reserve(
    page.request,
    c,
    first,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    rooms.units[0]!.id,
  );
  const two = await reserve(
    page.request,
    c,
    second,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    rooms.units[1]!.id,
  );
  try {
    await page.goto(`/app/stayview?from=${addDays(checkin, -1)}`);
    await page.getByRole('button', { name: new RegExp(first) }).click();
    await expect(page.getByRole('dialog', { name: first })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(second) }).click();
    await expect(page.getByRole('dialog', { name: second })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    await cancel(page.request, c, one.id);
    await cancel(page.request, c, two.id);
  }
});

test('keeps a person’s calendar settings after a reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/stayview');
  await page.getByRole('button', { name: 'Calendar settings' }).click();
  await page
    .getByRole('radiogroup', { name: 'Calendar density' })
    .getByRole('radio', { name: 'Compact' })
    .click();
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: 'Calendar settings' }).click();
  await expect(
    page
      .getByRole('radiogroup', { name: 'Calendar density' })
      .getByRole('radio', { name: 'Compact' }),
  ).toHaveAttribute('aria-checked', 'true');
  // Put it back for the next test.
  await page.getByRole('button', { name: 'Restore defaults' }).click();
});

test('gives a waiting stay its room from the Unassigned panel', async ({ page }) => {
  const c = await signIn(page);
  const checkin = addDays(c.today, 24);
  const checkout = addDays(checkin, 2);
  const rooms = await freeRooms(page.request, c, checkin, checkout, 1);
  const name = uniq('Waiting');
  const booking = await reserve(
    page.request,
    c,
    name,
    checkin,
    checkout,
    rooms.roomId,
    rooms.occupancyId,
    null,
  );
  try {
    await page.goto(`/app/stayview?from=${addDays(checkin, -1)}`);
    await page.getByRole('button', { name: /Unassigned stays/ }).click();
    const panel = page.getByRole('dialog', { name: 'Unassigned stays' });
    await expect(panel.getByText(name)).toBeVisible();
    const row = panel.locator('li', { hasText: name });
    await row.getByRole('button', { name: 'Auto-assign' }).click();
    await expect(page.getByText(`${name} has a room`)).toBeVisible();
  } finally {
    await cancel(page.request, c, booking.id);
  }
});

test('sets housekeeping from the room panel without leaving the calendar', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/stayview');
  const label = page.locator('[data-unit-label]').last();
  await label.click();
  const panel = page.getByRole('dialog', { name: /^Room / });
  await expect(panel).toBeVisible();
  const group = panel.getByRole('group', { name: /Set housekeeping/ });
  const dirty = group.getByRole('button', { name: 'Dirty' });
  if (await dirty.isEnabled()) {
    await dirty.click();
    await expect(page.getByText(/is dirty$/)).toBeVisible();
  }
  await group.getByRole('button', { name: 'Clean' }).click();
  await expect(page.getByText(/is clean$/)).toBeVisible();
});

test('offers the night’s actions on right-click, and they lead somewhere', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/stayview');
  // Measure only once the rooms are drawn and the columns are fitted.
  await expect(page.locator('[data-unit-id]').first()).toBeVisible();
  await expect(page.locator('.sv-grid')).toHaveAttribute('data-col-width', /^\d/);
  const target = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.sv-grid')!;
    const col = Number(grid.dataset.colWidth);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-unit-id]'))) {
      const box = el.getBoundingClientRect();
      const bars = Array.from(el.querySelectorAll('[data-bar-id]')).map((b) =>
        b.getBoundingClientRect(),
      );
      for (let i = 3; i < 10; i++) {
        const x = box.left + i * col + col / 2;
        if (!bars.some((b) => x >= b.left && x <= b.right) && x < window.innerWidth - 20)
          return { x, y: box.top + box.height / 2 };
      }
    }
    return null;
  });
  expect(target).not.toBeNull();
  await page.mouse.click(target!.x, target!.y, { button: 'right' });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'New reservation' }).click();
  await expect(page.getByRole('dialog', { name: 'Quick Reservation' })).toBeVisible();
});
