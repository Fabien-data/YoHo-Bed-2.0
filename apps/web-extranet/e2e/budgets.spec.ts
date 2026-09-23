import { test, expect } from '@playwright/test';
import { BUDGETS, UxBudget } from './support/budget';
import {
  API,
  addDays,
  api,
  arrivalToday,
  bookingApi,
  cancelAll,
  dmy,
  findStay,
  futureStay,
  signIn,
} from './support/demo';

/**
 * Click budgets (UX-0): the core front-desk tasks, driven the shortest way the product allows and
 * counted action by action against docs/UX-STANDARD.md §3. A change that makes a task cost more
 * fails here, the same way a change that breaks it fails its own spec.
 *
 * Tasks the product cannot yet do within budget are listed as `fixme` with what they cost today
 * and the sprint that brings them in; each becomes a real, failing-if-over test in that sprint.
 */

test.describe('click budgets', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test(`Quick Reservation, new guest, 1 room × 2 nights — ≤ ${BUDGETS.quickReservationNewGuest.clicks}C+${BUDGETS.quickReservationNewGuest.typed}T`, async ({
    page,
  }) => {
    const { checkin } = await findStay(page, 2, 1);
    const ux = new UxBudget(page);

    await ux.click(page.getByRole('button', { name: 'New reservation' }).first(), 'open');
    const sheet = page.getByRole('dialog', { name: 'Quick Reservation' });
    await expect(sheet).toBeVisible();

    const checkinInput = sheet.getByLabel('Check-in date');
    await ux.fill(checkinInput, dmy(checkin), 'check-in date');
    await ux.press('Tab', checkinInput, 'accept date');

    await ux.click(sheet.getByRole('button', { name: /night.* — change/ }), 'nights');
    await ux.fill(sheet.getByLabel('Nights'), '2', 'nights');
    await ux.press('Enter', sheet.getByLabel('Nights'), 'accept nights');
    await expect(sheet.getByLabel('Check-out date')).toHaveValue(dmy(addDays(checkin, 2)));

    await ux.pick(
      sheet.getByRole('combobox', { name: 'Room type, room 1' }),
      page.getByRole('option').first(),
      'room type',
    );
    await ux.fill(sheet.getByPlaceholder('Full name'), 'Budget Bandara', 'guest name');
    await expect(sheet.getByTestId('qr-total')).not.toHaveText(/ 0\.00$/);

    const saved = page.waitForResponse(
      (r) => r.url().endsWith('/reservations') && r.request().method() === 'POST',
    );
    await ux.click(sheet.getByRole('button', { name: 'Reserve' }), 'reserve');
    const response = await saved;
    const created = await response.json();
    try {
      expect(response.status(), JSON.stringify(created)).toBe(201);
      ux.expectWithin(BUDGETS.quickReservationNewGuest);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await cancelAll(page, created);
    }
  });

  // ---- The front desk (UX-1b): one dialog each, started where the work is ---------------------

  test(`Check in a prepared arrival from the Dashboard — ≤ ${BUDGETS.checkInPrepared.clicks}C, with the §4 checks`, async ({
    page,
  }) => {
    const b = await arrivalToday(page, 'Budget Wijesinghe');
    try {
      await page.goto('/app');
      const ux = new UxBudget(page);
      const row = page.getByRole('listitem').filter({ hasText: 'Budget Wijesinghe' });
      await ux.click(row.getByRole('button', { name: 'Check in' }), 'check in (row)');
      const dialog = page.getByRole('dialog', { name: 'Check in Budget Wijesinghe' });
      await expect(dialog.getByRole('button', { name: 'Check in' })).toBeEnabled();
      await ux.click(dialog.getByRole('button', { name: 'Check in' }), 'check in');
      await expect(page.getByText('Budget Wijesinghe is checked in')).toBeVisible();
      ux.expectWithin(BUDGETS.checkInPrepared);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await bookingApi(page, b.id, 'undo-check-in', { reason: 'Test clean-up' });
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  test(`Full check-in with the hotel's required ID and the registration card — ≤ ${BUDGETS.fullCheckIn.clicks}C+${BUDGETS.fullCheckIn.typed}T`, async ({
    page,
  }) => {
    const { headers, propertyId } = await api(page);
    const settings = `${API}/properties/${propertyId}/settings`;
    await page.request.patch(settings, { headers, data: { requireDocumentsAtCheckin: true } });
    const b = await arrivalToday(page, 'Budget Ratnayake');
    try {
      await page.goto('/app');
      const ux = new UxBudget(page);
      const row = page.getByRole('listitem').filter({ hasText: 'Budget Ratnayake' });
      await ux.click(row.getByRole('button', { name: 'Check in' }), 'check in (row)');
      const dialog = page.getByRole('dialog', { name: 'Check in Budget Ratnayake' });
      await expect(dialog.getByText(/records the guest's ID/)).toBeVisible();
      await ux.fill(dialog.getByLabel('Document number'), '199012345678', 'ID number');
      await ux.click(dialog.getByRole('button', { name: 'Save ID' }), 'save ID');
      await expect(dialog.getByRole('button', { name: 'Check in' })).toBeEnabled();
      const card = dialog.getByRole('checkbox');
      if (!(await card.isChecked())) await ux.click(card, 'print card');
      await ux.click(dialog.getByRole('button', { name: 'Check in' }), 'check in');
      await expect(page.getByRole('dialog', { name: 'Registration card' })).toBeVisible();
      ux.expectWithin(BUDGETS.fullCheckIn);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await page.request.patch(settings, { headers, data: { requireDocumentsAtCheckin: false } });
      await bookingApi(page, b.id, 'undo-check-in', { reason: 'Test clean-up' });
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  test(`Check out a guest who still owes: settle, invoice, email — ≤ ${BUDGETS.checkOutSettled.clicks}C+${BUDGETS.checkOutSettled.typed}T`, async ({
    page,
  }) => {
    const b = await arrivalToday(page, 'Budget Gunawardena', 1);
    await bookingApi(page, b.id, 'check-in');
    // Starting with the reservation open, as the desk has it when the guest walks up.
    await page.goto(`/app/reservations?bookingId=${b.id}`);
    const ux = new UxBudget(page);
    await ux.click(page.getByRole('button', { name: 'Check out' }).first(), 'check out (sheet)');
    const dialog = page.getByRole('dialog', { name: 'Check out Budget Gunawardena' });
    await expect(dialog.getByText('Still to pay')).toBeVisible();
    await ux.click(dialog.getByRole('button', { name: 'Record payment' }), 'record payment');
    await expect(dialog.getByText('The bill is settled.')).toBeVisible();
    await ux.click(dialog.getByRole('button', { name: 'Check out' }), 'check out');
    await expect(page.getByText(/Budget Gunawardena is checked out/)).toBeVisible();
    ux.expectWithin(BUDGETS.checkOutSettled);
    test.info().annotations.push({ type: 'cost', description: ux.summary });
  });

  test(`Take a payment from an open reservation — ≤ ${BUDGETS.takePayment.clicks}C+${BUDGETS.takePayment.typed}T`, async ({
    page,
  }) => {
    const b = await arrivalToday(page, 'Budget Pathirana');
    try {
      await page.goto(`/app/reservations?bookingId=${b.id}`);
      const ux = new UxBudget(page);
      await ux.click(page.getByRole('button', { name: 'Take payment' }).first(), 'take payment');
      const dialog = page.getByRole('dialog', { name: 'Take a payment from Budget Pathirana' });
      await ux.click(dialog.getByRole('button', { name: 'Record payment' }), 'record payment');
      await expect(page.getByText(/Payment recorded/)).toBeVisible();
      ux.expectWithin(BUDGETS.takePayment);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  test(`Extend an in-house stay by a night — ≤ ${BUDGETS.changeStayDates.clicks}C+${BUDGETS.changeStayDates.typed}T`, async ({
    page,
  }) => {
    const b = await arrivalToday(page, 'Budget Karunaratne', 2);
    await bookingApi(page, b.id, 'check-in');
    try {
      await page.goto(`/app/reservations?bookingId=${b.id}`);
      const ux = new UxBudget(page);
      await ux.click(
        page.getByRole('button', { name: 'Change departure' }).first(),
        'change departure',
      );
      const dialog = page.getByRole('dialog', { name: /Change .*departure/ });
      // The new departure starts one night later: extending by a night is the default.
      await expect(dialog.getByText(/1 more night/)).toBeVisible();
      await ux.click(dialog.getByRole('button', { name: 'Guest asked to extend' }), 'reason');
      await ux.click(dialog.getByRole('button', { name: 'Change departure' }), 'save');
      await expect(page.getByText(/now leaves on/)).toBeVisible();
      ux.expectWithin(BUDGETS.changeStayDates);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await bookingApi(page, b.id, 'undo-check-in', { reason: 'Test clean-up' });
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  // ---- Finding and doing, from anywhere (UX-2) ------------------------------------------------

  test(`Find a booking by name from anywhere — ≤ ${BUDGETS.findBooking.clicks}C+${BUDGETS.findBooking.typed}T`, async ({
    page,
  }) => {
    const guest = `Budget Senanayake ${Date.now().toString(36).slice(-4)}`;
    const b = await arrivalToday(page, guest);
    try {
      // Anywhere: start on a screen that has nothing to do with reservations.
      await page.goto('/app/finance');
      const ux = new UxBudget(page);
      await ux.press('Control+k', undefined, 'open search');
      await ux.fill(page.getByPlaceholder(/search reservations, guests and more/i), guest, 'name');
      const hit = page.getByRole('option').filter({ hasText: guest }).first();
      await expect(hit).toBeVisible();
      await ux.press('Enter', undefined, 'open');
      await expect(page.getByRole('dialog', { name: new RegExp(b.reference) })).toBeVisible({
        timeout: 15_000,
      });
      ux.expectWithin(BUDGETS.findBooking);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  // These two book a stay a few days out rather than tonight: the demo hotel has few rooms, and
  // a budget test must not eat the one free room another spec needs for an arrival today.
  test(`Move a guest to another room — ≤ ${BUDGETS.moveRoom.clicks}C`, async ({ page }) => {
    const b = await futureStay(page, 'Budget Jayasuriya');
    await bookingApi(page, b.id, 'auto-assign');
    try {
      await page.goto(`/app/reservations?bookingId=${b.id}`);
      const ux = new UxBudget(page);
      await ux.click(page.getByRole('button', { name: 'Move room' }).first(), 'move room');
      const dialog = page.getByRole('dialog', { name: /Move Budget Jayasuriya/ });
      const room = dialog.getByRole('radio').first();
      await expect(room).toBeVisible();
      await ux.click(room, 'pick a room');
      await ux.click(dialog.getByRole('button', { name: 'Move', exact: true }), 'move');
      await expect(page.getByText(/moved to room/i)).toBeVisible();
      ux.expectWithin(BUDGETS.moveRoom);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  test(`Post a standard charge — ≤ ${BUDGETS.postStandardCharge.clicks}C`, async ({ page }) => {
    const { headers } = await api(page);
    // The hotel's catalogue is what makes a charge one tap; make sure it has an item.
    const code = `E2E${Date.now().toString(36).slice(-5).toUpperCase()}`;
    await page.request.post(`${API}/charge-particulars`, {
      headers,
      data: { code, name: `Minibar ${code}`, category: 'beverage', defaultPrice: 950 },
    });
    const b = await futureStay(page, 'Budget Fernando');
    // A bill to post onto: the same window check-in would open.
    await page.request.post(`${API}/bookings/${b.id}/folio/post-room-charges`, { headers });
    try {
      await page.goto(`/app/reservations?bookingId=${b.id}&section=folio`);
      const ux = new UxBudget(page);
      await ux.click(page.getByRole('button', { name: 'Add charge' }).first(), 'add charge');
      await ux.click(page.getByRole('button', { name: new RegExp(`Minibar ${code}`) }), 'one tap');
      await expect(page.getByText(/posted/i).first()).toBeVisible();
      ux.expectWithin(BUDGETS.postStandardCharge);
      test.info().annotations.push({ type: 'cost', description: ux.summary });
    } finally {
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  // ---- Known debt: measured by the 2026-09-22 audit, fixed by the sprint named ----------------

  test.fixme(`Walk-in: reserve, check in and take a deposit in one sheet — ≤ ${BUDGETS.walkIn.clicks}C+${BUDGETS.walkIn.typed}T (Quick Reservation now checks in from the sheet; measured in UX-3)`, async () => {});
  test.fixme(`Mark a room clean from a housekeeper's phone — ${BUDGETS.markRoomClean.clicks} tap (today 3C on the desktop Room View; UX-6)`, async () => {});
});
