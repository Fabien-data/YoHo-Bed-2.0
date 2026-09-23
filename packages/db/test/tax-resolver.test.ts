import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createDb,
  properties,
  propertyTaxTypes,
  resolveForwardTaxesForDates,
  resolveTaxComponentsForDates,
  resolveTaxRatesForDates,
  taxDurations,
  taxTypes,
  tenants,
  withTenant,
  type DbHandle,
} from '../src/index';
import { forwardNight } from '@yohobed/domain';
import { appUrlFrom } from './app-url';

/**
 * Tax engine v2 (Sprint 7) at the database: slab rows belong to the forward engine alone. The
 * legacy resolvers — the Sri Lanka parity path — must never see them, or a property with India's
 * two GST slabs would be charged both.
 */
const superUrl = process.env.DATABASE_URL;
if (!superUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: these integration tests must never be skipped.');
}
const run = superUrl ? describe : describe.skip;

run('tax resolvers', () => {
  let sup: DbHandle;
  let app: DbHandle;
  let tenantId = '';
  let propertyId = '';
  const stamp = Date.now();

  beforeAll(async () => {
    sup = createDb(superUrl as string);
    app = createDb(appUrlFrom(superUrl as string));
    const [t] = await sup.db
      .insert(tenants)
      .values({ name: 'Tax IN', email: `tax-in+${stamp}@yohobed.test` })
      .returning();
    tenantId = t!.id;
    const [p] = await sup.db
      .insert(properties)
      .values({
        tenantId,
        name: 'Tax IN Hotel',
        countryCode: 'IN',
        currency: 'INR',
        taxMode: 'exclusive_forward',
      })
      .returning();
    propertyId = p!.id;
    const [gst] = await sup.db
      .insert(taxTypes)
      .values({ tenantId, name: 'GST', code: 'GST', displayGroup: 'gst_split' })
      .returning();
    await sup.db.insert(taxDurations).values([
      {
        tenantId,
        taxTypeId: gst!.id,
        startDate: '2025-09-22',
        endDate: '2099-12-31',
        ratePercent: '5',
        maxAmount: '7500',
      },
      {
        tenantId,
        taxTypeId: gst!.id,
        startDate: '2025-09-22',
        endDate: '2099-12-31',
        ratePercent: '18',
        minAmount: '7500.01',
      },
    ]);
    await sup.db
      .insert(propertyTaxTypes)
      .values({ tenantId, propertyId, taxTypeId: gst!.id, priority: 1 });
  });

  afterAll(async () => {
    await sup.db.delete(tenants).where(eq(tenants.id, tenantId));
    await sup.close();
    await app.close();
  });

  it('the legacy resolvers ignore slab rows', async () => {
    const rates = await withTenant(app.db, tenantId, (tx) =>
      resolveTaxRatesForDates(tx, propertyId, ['2026-10-01']),
    );
    expect(rates.get('2026-10-01')).toEqual({ serviceCharge: 0, nbt: 0, vat: 0 });
    const parts = await withTenant(app.db, tenantId, (tx) =>
      resolveTaxComponentsForDates(tx, propertyId, ['2026-10-01']),
    );
    expect(parts.get('2026-10-01')).toEqual([]);
  });

  it('the forward resolver returns both slabs, and the engine picks one by price', async () => {
    const taxes = await withTenant(app.db, tenantId, (tx) =>
      resolveForwardTaxesForDates(tx, propertyId, ['2026-10-01']),
    );
    const day = taxes.get('2026-10-01')!;
    expect(day.map((t) => t.rate).sort()).toEqual([0.05, 0.18]);
    expect(forwardNight(7500, day).selling).toBe(7875);
    expect(forwardNight(8000, day).selling).toBe(9440);
  });

  it('nothing is in force before the rates took effect', async () => {
    const taxes = await withTenant(app.db, tenantId, (tx) =>
      resolveForwardTaxesForDates(tx, propertyId, ['2025-09-21']),
    );
    expect(taxes.get('2025-09-21')).toEqual([]);
  });

  it('is fenced per tenant', async () => {
    const other = await withTenant(app.db, '00000000-0000-0000-0000-000000000000', (tx) =>
      resolveForwardTaxesForDates(tx, propertyId, ['2026-10-01']),
    );
    expect(other.get('2026-10-01')).toEqual([]);
  });
});
