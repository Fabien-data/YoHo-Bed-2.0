import { test, expect } from '@playwright/test';
import { API, api, arrivalToday, bookingApi, signIn } from './support/demo';

/**
 * The guided front desk (UX-1b): mistakes are one press to undo, and anything that takes a
 * reservation away asks why.
 */

test.describe('the guided front desk', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('undoes a check-in from its own toast', async ({ page }) => {
    const b = await arrivalToday(page, 'Undo Udugama');
    try {
      await page.goto('/app');
      await page
        .getByRole('listitem')
        .filter({ hasText: 'Undo Udugama' })
        .getByRole('button', { name: 'Check in' })
        .click();
      await page
        .getByRole('dialog', { name: 'Check in Undo Udugama' })
        .getByRole('button', { name: 'Check in' })
        .click();
      await expect(page.getByText('Undo Udugama is checked in')).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.getByText(`${b.reference} is back to arriving`)).toBeVisible();

      const { headers } = await api(page);
      const after = await (await page.request.get(`${API}/bookings/${b.id}`, { headers })).json();
      expect(after.status).toBe('Approved');
      // The undo is on the record, with its reason.
      expect(after.trail.map((t: { action: string }) => t.action)).toContain('check_in_undone');
    } finally {
      await bookingApi(page, b.id, 'cancel', { reason: 'Test clean-up' });
    }
  });

  test('asks why before cancelling, and records the answer', async ({ page }) => {
    const b = await arrivalToday(page, 'Cancel Cooray');
    await page.goto(`/app/reservations?bookingId=${b.id}`);
    await page
      .getByRole('button', { name: `Actions for ${b.reference}` })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Cancel reservation' }).click();

    const dialog = page.getByRole('dialog', { name: `Cancel ${b.reference}?` });
    const confirm = dialog.getByRole('button', { name: 'Cancel reservation' });
    await expect(confirm).toBeDisabled();
    // The safe choice is focused first: Enter never cancels by accident.
    await expect(dialog.getByRole('button', { name: 'Keep as it is' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Guest cancelled' }).click();
    await confirm.click();
    await expect(page.getByText(`${b.reference} is cancelled`)).toBeVisible();

    const { headers } = await api(page);
    const after = await (await page.request.get(`${API}/bookings/${b.id}`, { headers })).json();
    expect(after.status).toBe('Cancelled');
    const cancelled = after.trail.find((t: { action: string }) => t.action === 'cancelled');
    expect(cancelled.reason).toBe('Guest cancelled');
  });
});
