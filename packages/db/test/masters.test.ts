import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { TAG_COLORS } from '@yohobed/domain';
import { REGION_PRESETS } from '@yohobed/locale';
import {
  applyRegionPreset,
  businessSources,
  createDb,
  marketSegments,
  paymentMethods,
  seedDefaultMasters,
  tenants,
  withTenant,
  type DbHandle,
} from '../src/index';
import { appUrlFrom } from './app-url';

/**
 * The reservation master lists: seeded once per tenant from the country preset, never re-seeded,
 * extendable by an explicit "apply preset", and fenced per tenant by RLS like everything else.
 */
const superUrl = process.env.DATABASE_URL;
if (!superUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: these integration tests must never be skipped.');
}
const run = superUrl ? describe : describe.skip;

describe('regional presets', () => {
  it('only use palette keys the design system defines', () => {
    const palette = new Set<string>(TAG_COLORS);
    for (const preset of Object.values(REGION_PRESETS)) {
      for (const s of preset.marketSegments) expect(palette.has(s.palette), s.code).toBe(true);
      for (const s of preset.businessSources)
        expect(palette.has(s.palette), s.shortCode).toBe(true);
    }
  });
});

run('reservation master lists', () => {
  let sup: DbHandle;
  let app: DbHandle;
  let tenantLk = '';
  let tenantIn = '';
  const stamp = Date.now();

  beforeAll(async () => {
    sup = createDb(superUrl as string);
    app = createDb(appUrlFrom(superUrl as string));
    const [lk] = await sup.db
      .insert(tenants)
      .values({ name: 'Masters LK', email: `masters-lk+${stamp}@yohobed.test` })
      .returning();
    const [inn] = await sup.db
      .insert(tenants)
      .values({ name: 'Masters IN', email: `masters-in+${stamp}@yohobed.test` })
      .returning();
    tenantLk = lk!.id;
    tenantIn = inn!.id;
  });

  afterAll(async () => {
    if (tenantLk) await sup.db.delete(tenants).where(eq(tenants.id, tenantLk));
    if (tenantIn) await sup.db.delete(tenants).where(eq(tenants.id, tenantIn));
    await sup?.close();
    await app?.close();
  });

  it('seeds a tenant from its country preset, with sources linked to their segments', async () => {
    expect(await seedDefaultMasters(sup.db, tenantLk, 'LK')).toBe(true);

    const segs = await sup.db
      .select()
      .from(marketSegments)
      .where(eq(marketSegments.tenantId, tenantLk));
    const sources = await sup.db
      .select()
      .from(businessSources)
      .where(eq(businessSources.tenantId, tenantLk));
    const methods = await sup.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.tenantId, tenantLk));

    expect(segs).toHaveLength(REGION_PRESETS.LK.marketSegments.length);
    expect(sources).toHaveLength(REGION_PRESETS.LK.businessSources.length);
    expect(methods.map((m) => m.code)).toContain('LANKAQR');

    const ota = segs.find((s) => s.code === 'OTA')!;
    const bdc = sources.find((s) => s.shortCode === 'BDC')!;
    expect(bdc.category).toBe('ota');
    expect(bdc.defaultMarketSegmentId).toBe(ota.id);
    expect(segs.find((s) => s.code === 'COMP')?.excludedFromSold).toBe(true);
  });

  it('never re-seeds a tenant that already has lists', async () => {
    await sup.db
      .update(marketSegments)
      .set({ name: 'Walk-ins & phone' })
      .where(and(eq(marketSegments.tenantId, tenantLk), eq(marketSegments.code, 'BAR')));
    await sup.db.delete(paymentMethods).where(eq(paymentMethods.tenantId, tenantLk));

    expect(await seedDefaultMasters(sup.db, tenantLk, 'LK')).toBe(false);
    const methods = await sup.db
      .select()
      .from(paymentMethods)
      .where(eq(paymentMethods.tenantId, tenantLk));
    expect(methods).toHaveLength(0);
  });

  it('applies another preset by adding only the codes that are missing', async () => {
    await seedDefaultMasters(sup.db, tenantIn, 'IN');
    const before = await sup.db
      .select()
      .from(businessSources)
      .where(eq(businessSources.tenantId, tenantIn));
    await sup.db
      .update(businessSources)
      .set({ name: 'Booking.com (renamed)' })
      .where(and(eq(businessSources.tenantId, tenantIn), eq(businessSources.shortCode, 'BDC')));

    const added = await applyRegionPreset(sup.db, tenantIn, 'MY');
    // MY adds its own OTAs (Traveloka, Agoda B2B) and payment methods; shared codes are kept.
    expect(added.businessSources).toBe(2);
    expect(added.paymentMethods).toBeGreaterThan(0);

    const after = await sup.db
      .select()
      .from(businessSources)
      .where(eq(businessSources.tenantId, tenantIn));
    expect(after).toHaveLength(before.length + 2);
    expect(after.find((s) => s.shortCode === 'BDC')?.name).toBe('Booking.com (renamed)');
    expect(after.map((s) => s.shortCode)).toContain('MMT');

    // Repeating is a no-op.
    expect(await applyRegionPreset(sup.db, tenantIn, 'MY')).toEqual({
      marketSegments: 0,
      businessSources: 0,
      paymentMethods: 0,
    });
  });

  it('fences the lists per tenant under RLS', async () => {
    const seen = await withTenant(app.db, tenantLk, (tx) => tx.select().from(marketSegments));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.tenantId === tenantLk)).toBe(true);

    const methods = await withTenant(app.db, tenantIn, (tx) => tx.select().from(paymentMethods));
    expect(methods.every((m) => m.tenantId === tenantIn)).toBe(true);

    await expect(
      withTenant(app.db, tenantLk, (tx) =>
        tx.insert(marketSegments).values({ tenantId: tenantIn, code: 'X', name: 'Smuggled' }),
      ),
    ).rejects.toThrow();
  });

  it('rejects values outside the allowed vocabularies', async () => {
    await expect(
      sup.db.insert(paymentMethods).values({
        tenantId: tenantLk,
        code: 'BAD',
        name: 'Bad',
        shortName: 'Bad',
        category: 'bitcoin',
      }),
    ).rejects.toThrow();
    await expect(
      sup.db
        .insert(marketSegments)
        .values({ tenantId: tenantLk, code: 'BAD', name: 'Bad', grp: 'vip' }),
    ).rejects.toThrow();
  });
});
