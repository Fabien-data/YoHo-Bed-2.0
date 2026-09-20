import { test, expect, type Page } from '@playwright/test';

/**
 * Invoicing from the desk (Development Phase 02, Sprint 6): a Sri Lankan hotel with a TIN issues a
 * TAX INVOICE from the reservation, and the printed document carries what the gazette asks for.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function signIn(page: Page) {
  await page.goto('/');
  await page.getByLabel(/email/i).fill('owner@demo.yohobed.test');
  await page.getByLabel(/password/i).fill('password123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL('**/app', { timeout: 15_000 });
}

async function api(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const properties = (await (
    await page.request.get(`${API}/properties`, { headers })
  ).json()) as Array<{
    id: string;
    name: string;
  }>;
  return { headers, properties };
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A reservation on a night a demo hotel still has free — one that sells its rooms WITH tax, since
 * a tax invoice only exists where there is VAT (an untaxed hotel correctly gets a plain bill).
 */
async function makeBooking(page: Page) {
  const { headers, properties } = await api(page);
  for (const property of properties) {
    const cfg = await (
      await page.request.get(`${API}/properties/${property.id}/reservation-config`, { headers })
    ).json();
    const start = 15 + Math.floor(Math.random() * 12);
    for (let offset = start; offset < start + 25; offset++) {
      const checkin = addDays(cfg.today, offset);
      const grid = await (
        await page.request.get(
          `${API}/properties/${property.id}/room-availability?checkin=${checkin}&checkout=${addDays(checkin, 1)}`,
          { headers },
        )
      ).json();
      const rt = grid.roomTypes?.find(
        (r: { free: number; rateTypes: Array<{ priced: boolean }> }) =>
          r.free >= 1 && r.rateTypes.some((t) => t.priced),
      );
      if (!rt) continue;
      const lines = [
        {
          roomId: rt.roomId,
          occupancyId: rt.rateTypes.find((t: { priced: boolean }) => t.priced).occupancyId,
          adults: 2,
        },
      ];
      const stay = { propertyId: property.id, checkin, checkout: addDays(checkin, 1), lines };
      const quote = await (
        await page.request.post(`${API}/reservations/quote`, { headers, data: stay })
      ).json();
      // No tax on this hotel's rooms: its invoice would be a bill, not a tax invoice.
      if (Number(quote.totals?.taxes ?? 0) <= 0) break;
      const res = await page.request.post(`${API}/reservations`, {
        headers,
        data: { ...stay, guest: { name: 'Invoice Playwright' } },
      });
      expect(res.status(), await res.text()).toBe(201);
      return { headers, propertyId: property.id, created: await res.json() };
    }
  }
  throw new Error('no free, priced night at a taxed demo hotel');
}

test.describe('Invoicing', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('issues a tax invoice from the reservation and prints it to the gazette layout', async ({
    page,
  }) => {
    const { headers, propertyId, created } = await makeBooking(page);
    // A Sri Lankan hotel invoices under Gazette 2481/22 once it has a TIN.
    await page.request.patch(`${API}/properties/${propertyId}/profile`, {
      headers,
      data: { taxIds: { tin: '114523678' }, branchCode: '1' },
    });

    // The screens follow the property picker, so point it at the hotel that was booked.
    await page.addInitScript(
      (id) => window.localStorage.setItem('yhb_property_id', id),
      propertyId,
    );
    await page.goto(`/app/reservations?tab=upcoming&q=${created.reference}`);
    await page
      .getByRole('button', { name: /Invoice Playwright/ })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: `Reservation ${created.reference}` });
    await expect(sheet.getByRole('heading', { name: 'Invoices' })).toBeVisible();

    const issued = page.waitForResponse(
      (r) => r.url().includes('/invoices') && r.request().method() === 'POST',
    );
    await sheet.getByRole('button', { name: 'Invoice', exact: true }).click();
    const response = await issued;
    const body = await response.json();
    expect(response.status(), JSON.stringify(body)).toBe(201);
    const doc = body.documents[0];
    expect(doc.kind).toBe('tax_invoice');

    await page.goto(`/app/invoices/${doc.id}`);
    const printed = page.locator('#invoice-doc');
    await expect(printed.getByRole('heading', { name: 'TAX INVOICE' })).toBeVisible();
    await expect(printed.getByText('TIN 114523678')).toBeVisible();
    await expect(printed.getByText(doc.number)).toBeVisible();
    await expect(printed.getByText('Value (excl. VAT)')).toBeVisible();

    // A correction is a credit note, with a reason — the invoice itself is never changed.
    await page.getByRole('button', { name: 'Credit note' }).click();
    const dialog = page.getByRole('dialog', { name: `Credit note against ${doc.number}` });
    await dialog.locator('#credit-reason').fill('Playwright test document');
    await dialog.getByRole('button', { name: 'Issue credit note' }).click();
    await expect(page.getByText(/Credit note CN-.* issued/)).toBeVisible();
    await expect(
      page.locator('#invoice-doc').getByRole('heading', { name: 'CREDIT NOTE' }),
    ).toBeVisible();
    await expect(page.locator('#invoice-doc').getByText(doc.number)).toBeVisible();

    await page.request.post(`${API}/bookings/${created.bookings[0].id}/cancel`, { headers });
  });
});
