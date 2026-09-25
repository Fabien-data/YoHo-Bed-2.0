import { count, eq } from 'drizzle-orm';
import { presetFor } from '@yohobed/locale';
import { businessSources, marketSegments, paymentMethods, transportModes } from './schema';
import type { Database } from './client';
import type { Tx } from './scope';

/**
 * The reservation desk's starter lists: market segments, business sources and payment methods,
 * copied from the country preset in @yohobed/locale.
 *
 * Single source of truth for every place a tenant comes into being — the migration (existing
 * tenants), self-serve registration and the e2e fixture — so none of them can drift into a tenant
 * with an empty Business Source dropdown.
 */

export interface PresetResult {
  marketSegments: number;
  businessSources: number;
  paymentMethods: number;
}

/**
 * Seed a tenant's lists ONCE. A tenant that already has any market segment has been seeded (or has
 * built its own), so it is left alone — re-running must never resurrect an entry the owner renamed.
 * Returns whether anything was seeded.
 */
export async function seedDefaultMasters(
  tx: Tx | Database,
  tenantId: string,
  country?: string | null,
): Promise<boolean> {
  // Transport modes arrived after the other lists (Sprint 5), so they are checked on their own:
  // tenants seeded before then get them on the next migrate.
  await ensureTransportModes(tx, tenantId, country);
  const [row] = await tx
    .select({ n: count() })
    .from(marketSegments)
    .where(eq(marketSegments.tenantId, tenantId));
  if ((row?.n ?? 0) > 0) {
    await ensureLaterSources(tx, tenantId, country);
    return false;
  }
  await applyRegionPreset(tx, tenantId, country);
  return true;
}

/**
 * Business sources added to the presets after tenants had been seeded, by short code. A tenant
 * seeded before one existed gets it on the next migrate — once: never when the tenant already has
 * that code, or a source of the same name it made itself.
 */
export const LATER_SOURCE_CODES = ['SOC'] as const;

export async function ensureLaterSources(
  tx: Tx | Database,
  tenantId: string,
  country?: string | null,
): Promise<number> {
  const preset = presetFor(country);
  const existing = await tx
    .select({ code: businessSources.shortCode, name: businessSources.name })
    .from(businessSources)
    .where(eq(businessSources.tenantId, tenantId));
  const codes = new Set(existing.map((s) => s.code.toUpperCase()));
  const names = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  const segments = await tx
    .select({ id: marketSegments.id, code: marketSegments.code })
    .from(marketSegments)
    .where(eq(marketSegments.tenantId, tenantId));
  const segmentByCode = new Map(segments.map((s) => [s.code, s.id]));

  let added = 0;
  for (const code of LATER_SOURCE_CODES) {
    const index = preset.businessSources.findIndex((s) => s.shortCode === code);
    const seed = preset.businessSources[index];
    if (!seed || codes.has(code) || names.has(seed.name.toLowerCase())) continue;
    const inserted = await tx
      .insert(businessSources)
      .values({
        tenantId,
        shortCode: seed.shortCode,
        name: seed.name,
        category: seed.category,
        palette: seed.palette,
        defaultMarketSegmentId: segmentByCode.get(seed.defaultSegment) ?? null,
        // Just before the entry that follows it in the preset, so it lands in the preset's order
        // among the sources the tenant was seeded with.
        sort: (index + 1) * 10 - 5,
      })
      .onConflictDoNothing({ target: [businessSources.tenantId, businessSources.shortCode] })
      .returning({ id: businessSources.id });
    added += inserted.length;
  }
  return added;
}

/**
 * Add a country preset's entries that the tenant does not have yet (matched by code). Existing
 * entries are never modified — this is the explicit "apply preset" action, safe to repeat.
 */
export async function applyRegionPreset(
  tx: Tx | Database,
  tenantId: string,
  country?: string | null,
): Promise<PresetResult> {
  const preset = presetFor(country);

  const segments = await tx
    .insert(marketSegments)
    .values(
      preset.marketSegments.map((s, i) => ({
        tenantId,
        code: s.code,
        name: s.name,
        grp: s.group,
        palette: s.palette,
        excludedFromSold: s.excludedFromSold ?? false,
        sort: (i + 1) * 10,
      })),
    )
    .onConflictDoNothing({ target: [marketSegments.tenantId, marketSegments.code] })
    .returning({ id: marketSegments.id });

  // Sources point at their default segment, which may be a pre-existing row of the tenant's.
  const known = await tx
    .select({ id: marketSegments.id, code: marketSegments.code })
    .from(marketSegments)
    .where(eq(marketSegments.tenantId, tenantId));
  const segmentByCode = new Map(known.map((s) => [s.code, s.id]));

  const sources = await tx
    .insert(businessSources)
    .values(
      preset.businessSources.map((s, i) => ({
        tenantId,
        shortCode: s.shortCode,
        name: s.name,
        category: s.category,
        palette: s.palette,
        defaultMarketSegmentId: segmentByCode.get(s.defaultSegment) ?? null,
        sort: (i + 1) * 10,
      })),
    )
    .onConflictDoNothing({ target: [businessSources.tenantId, businessSources.shortCode] })
    .returning({ id: businessSources.id });

  const methods = await tx
    .insert(paymentMethods)
    .values(
      preset.paymentMethods.map((m, i) => ({
        tenantId,
        code: m.code,
        name: m.name,
        shortName: m.shortName,
        category: m.category,
        requiresReference: m.requiresReference ?? false,
        isDefaultCash: m.isDefaultCash ?? false,
        currency: m.currency ?? null,
        sort: (i + 1) * 10,
      })),
    )
    .onConflictDoNothing({ target: [paymentMethods.tenantId, paymentMethods.code] })
    .returning({ id: paymentMethods.id });

  return {
    marketSegments: segments.length,
    businessSources: sources.length,
    paymentMethods: methods.length,
  };
}

/** The vehicles a hotel offers for pick-ups and drop-offs, by country. */
function transportModesFor(country?: string | null) {
  const common = [
    { code: 'CAR', name: 'Car' },
    { code: 'VAN', name: 'Van' },
    { code: 'SUV', name: 'SUV' },
    { code: 'COACH', name: 'Coach' },
  ];
  if (country === 'LK') return [...common, { code: 'TUK', name: 'Tuk-tuk' }];
  if (country === 'IN') return [...common, { code: 'AUTO', name: 'Auto-rickshaw' }];
  return common;
}

/** Seed a tenant's transport modes if it has none. Never touches a list the owner has edited. */
export async function ensureTransportModes(
  tx: Tx | Database,
  tenantId: string,
  country?: string | null,
): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(transportModes)
    .where(eq(transportModes.tenantId, tenantId));
  if ((row?.n ?? 0) > 0) return 0;
  const created = await tx
    .insert(transportModes)
    .values(
      transportModesFor(country).map((m, i) => ({
        tenantId,
        code: m.code,
        name: m.name,
        sort: (i + 1) * 10,
      })),
    )
    .onConflictDoNothing({ target: [transportModes.tenantId, transportModes.code] })
    .returning({ id: transportModes.id });
  return created.length;
}
