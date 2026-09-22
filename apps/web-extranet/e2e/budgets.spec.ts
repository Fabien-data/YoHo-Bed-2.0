import { test, expect } from '@playwright/test';
import { BUDGETS, UxBudget } from './support/budget';
import { addDays, cancelAll, dmy, findStay, signIn } from './support/demo';

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

  // ---- Known debt: measured by the 2026-09-22 audit, fixed by the sprint named ----------------

  test.fixme(`Check in a prepared arrival — ≤ ${BUDGETS.checkInPrepared.clicks}C with checks (today 4C with no checks; UX-1b)`, async () => {});
  test.fixme(`Full check-in: room, ID, registration card — ≤ ${BUDGETS.fullCheckIn.clicks}C+${BUDGETS.fullCheckIn.typed}T (today ≈14C+1T over 4 screens; UX-1b)`, async () => {});
  test.fixme(`Check out with settle, invoice and email — ≤ ${BUDGETS.checkOutSettled.clicks}C (today ≈16C over 3 screens; UX-1b)`, async () => {});
  test.fixme(`Walk-in: reserve, check in and take a deposit in one sheet — ≤ ${BUDGETS.walkIn.clicks}C+${BUDGETS.walkIn.typed}T (today 8C+2T plus a page load; UX-2)`, async () => {});
  test.fixme(`Take a payment — ≤ ${BUDGETS.takePayment.clicks}C+${BUDGETS.takePayment.typed}T (today 6C; UX-1b)`, async () => {});
  test.fixme(`Find a booking by name, phone or reference from anywhere — ≤ ${BUDGETS.findBooking.clicks}C+${BUDGETS.findBooking.typed}T (today 4C+1T and often misses; UX-2)`, async () => {});
  test.fixme(`Extend or shorten an in-house stay — ≤ ${BUDGETS.changeStayDates.clicks}C+${BUDGETS.changeStayDates.typed}T (today impossible; UX-1b)`, async () => {});
  test.fixme(`Move a guest to another room — ≤ ${BUDGETS.moveRoom.clicks}C (today 7C, Room View only; UX-2)`, async () => {});
  test.fixme(`Post a standard charge — ≤ ${BUDGETS.postStandardCharge.clicks}C (today 5–6C, typed by hand; UX-2)`, async () => {});
  test.fixme(`Mark a room clean from a housekeeper's phone — ${BUDGETS.markRoomClean.clicks} tap (today 3C on the desktop Room View; UX-6)`, async () => {});
});
