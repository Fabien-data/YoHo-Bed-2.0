import { test, expect, type Page } from '@playwright/test';
import { API, addDays, hotelToday, signIn } from './support/demo';

/**
 * Malaysia and India (Development Phase 02, Sprint 7), on the seeded demo hotels: Straits Heritage
 * Penang (SST + Tourism Tax) and Mysuru Palace Residency (GST slabs, Form C).
 */

async function hotel(page: Page, name: string) {
  const token = await page.evaluate(() => localStorage.getItem('yoho_token'));
  const headers = { Authorization: `Bearer ${token}` };
  const properties = (await (
    await page.request.get(`${API}/properties`, { headers })
  ).json()) as Array<{
    id: string;
    name: string;
  }>;
  const p = properties.find((x) => x.name === name);
  if (!p) throw new Error(`${name} is not in the demo data — re-run the seed`);
  await page.evaluate((id) => localStorage.setItem('yhb_property_id', id), p.id);
  return { headers, propertyId: p.id };
}

/** A confirmed stay at a given property, through the API. */
async function stayAt(
  page: Page,
  h: { headers: Record<string, string>; propertyId: string },
  guest: string,
  checkin: string,
  nights: number,
) {
  const checkout = addDays(checkin, nights);
  const grid = await (
    await page.request.get(
      `${API}/properties/${h.propertyId}/room-availability?checkin=${checkin}&checkout=${checkout}`,
      { headers: h.headers },
    )
  ).json();
  const rt = grid.roomTypes.find((r: { free: number }) => r.free >= 1);
  const occupancyId = rt.rateTypes.find((t: { priced: boolean }) => t.priced).occupancyId;
  const res = await page.request.post(`${API}/bookings`, {
    headers: h.headers,
    data: { roomId: rt.roomId, occupancyId, checkin, checkout, customerName: guest },
  });
  const b = await res.json();
  expect(res.ok(), JSON.stringify(b)).toBe(true);
  await page.request.post(`${API}/bookings/${b.id}/approve`, { headers: h.headers });
  return b as { id: string; reference: string; customerId: string };
}

test.describe('Malaysia and India', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('India: a GST tax invoice prints GSTIN, CGST + SGST, SAC 996311 and the round-off', async ({
    page,
  }) => {
    const h = await hotel(page, 'Mysuru Palace Residency');
    const b = await stayAt(page, h, 'Ananya Rao', hotelToday(20), 1);
    const issued = await page.request.post(`${API}/bookings/${b.id}/invoices`, {
      headers: h.headers,
      data: {},
    });
    const body = await issued.json();
    expect(issued.ok(), JSON.stringify(body)).toBe(true);
    const doc = body.documents[0];
    try {
      await page.goto(`/app/invoices/${doc.id}`);
      const invoice = page.locator('#invoice-doc');
      await expect(invoice.getByRole('heading', { name: 'TAX INVOICE' })).toBeVisible();
      await expect(invoice.getByText('GSTIN 29ABCDE1234F1Z5')).toBeVisible();
      await expect(invoice.getByText(/^CGST \d/)).toBeVisible();
      await expect(invoice.getByText(/^SGST \d/)).toBeVisible();
      // The rupee round-off, and a total in whole rupees.
      await expect(invoice.getByText(/^Round off/)).toBeVisible();
      await expect(invoice.getByRole('cell', { name: '996311' }).first()).toBeVisible();
      await expect(invoice.getByText('Place of supply')).toBeVisible();
      expect(doc.number).toMatch(/^INV\/\d{2}-\d{2}\/\d{6}$/);
    } finally {
      await page.request.post(`${API}/invoices/${doc.id}/credit-note`, {
        headers: h.headers,
        data: { reason: 'Test clean-up' },
      });
      await page.request.post(`${API}/bookings/${b.id}/cancel`, {
        headers: h.headers,
        data: { reason: 'Test clean-up' },
      });
    }
  });

  test('India: Form C counts down from check-in and records the filing', async ({ page }) => {
    const h = await hotel(page, 'Mysuru Palace Residency');
    const guest = `Oliver Grant ${Date.now().toString(36)}`;
    const b = await stayAt(page, h, guest, hotelToday(), 1);
    await page.request.patch(`${API}/customers/${b.customerId}`, {
      headers: h.headers,
      data: { nationalityCode: 'GB' },
    });
    const inRes = await page.request.post(`${API}/bookings/${b.id}/check-in`, {
      headers: h.headers,
      data: {},
    });
    expect(inRes.ok(), await inRes.text()).toBe(true);
    try {
      await page.goto('/app/compliance');
      await expect(page.getByRole('heading', { name: 'Form C' })).toBeVisible();
      const row = page.getByRole('row').filter({ hasText: guest });
      await expect(row.getByText(/h left|min left/)).toBeVisible();
      await row.getByRole('button', { name: 'Record filing' }).click();
      const dialog = page.getByRole('dialog', { name: `Form C for ${guest}` });
      await dialog.getByLabel('Form C reference').fill('FRRO-E2E-0001');
      await dialog.getByRole('button', { name: 'Record filing' }).click();
      await expect(page.getByText(`Form C recorded for ${guest}`)).toBeVisible();
      await expect(row.getByText('FRRO-E2E-0001')).toBeVisible();
    } finally {
      await page.request.post(`${API}/bookings/${b.id}/undo-check-in`, {
        headers: h.headers,
        data: { reason: 'Test clean-up' },
      });
      await page.request.post(`${API}/bookings/${b.id}/cancel`, {
        headers: h.headers,
        data: { reason: 'Test clean-up' },
      });
    }
  });

  test('Malaysia: the taxes are added to the rate, with the tourism tax on its own', async ({
    page,
  }) => {
    await hotel(page, 'Straits Heritage Penang');
    await page.goto('/app/configuration?tab=taxes');
    await expect(page.getByText('Added to the rate')).toBeVisible();
    // The name cell (each row also has Edit / Stop charging buttons named after the tax).
    await expect(page.getByRole('cell', { name: /^Service Charge/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^Service Tax \(SST\)/ })).toBeVisible();
    await expect(page.getByText('The rate and the taxes before it')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Tourism Tax' })).toBeVisible();
    await expect(page.getByText('Foreign guests only')).toBeVisible();
  });

  test('Malaysia: the invoice names the SST and TTx numbers', async ({ page }) => {
    const h = await hotel(page, 'Straits Heritage Penang');
    const b = await stayAt(page, h, 'Nur Aisyah', hotelToday(21), 2);
    const issued = await page.request.post(`${API}/bookings/${b.id}/invoices`, {
      headers: h.headers,
      data: {},
    });
    const body = await issued.json();
    expect(issued.ok(), JSON.stringify(body)).toBe(true);
    const doc = body.documents[0];
    try {
      await page.goto(`/app/invoices/${doc.id}`);
      const invoice = page.locator('#invoice-doc');
      await expect(invoice.getByText('SST No. W10-1808-32000001')).toBeVisible();
      await expect(invoice.getByText('TTx No. 141-2017-10000001')).toBeVisible();
      await expect(invoice.getByText(/^SST 8%/)).toBeVisible();
    } finally {
      await page.request.post(`${API}/invoices/${doc.id}/credit-note`, {
        headers: h.headers,
        data: { reason: 'Test clean-up' },
      });
      await page.request.post(`${API}/bookings/${b.id}/cancel`, {
        headers: h.headers,
        data: { reason: 'Test clean-up' },
      });
    }
  });
});
