import { and, eq } from 'drizzle-orm';
import {
  computeCommission,
  forwardNight,
  roundMoney,
  sellingPrice,
  type ForwardTax,
} from '@yohobed/domain';
import { presetFor } from '@yohobed/locale';
import type { Database } from './client';
import {
  availabilityCalendar,
  exchangeRates,
  occupancies,
  properties,
  propertyLevies,
  propertyTaxTypes,
  rateCalendar,
  ratePlans,
  rooms,
  taxDurations,
  taxTypes,
} from './schema';

/**
 * A demo hotel in Malaysia or India (Development Phase 02, Sprint 7), priced by the forward tax
 * engine exactly as a real one is once its country preset is applied: the regional taxes and
 * levies from `@yohobed/locale`, a pre-tax `net_price` on every night and the tax-inclusive
 * `selling_price` beside it. Dev and demo only — live hotels get their taxes switched on after a
 * tax adviser signs them off.
 */
export async function seedRegionalProperty(
  db: Database,
  tenantId: string,
  opts: {
    name: string;
    country: 'MY' | 'IN';
    stateCode: string;
    city: string;
    taxIds: Record<string, string>;
    roomName: string;
    quantity: number;
    /** Base price a weekday and a weekend night, in the property's currency. */
    weekday: number;
    weekend: number;
    rateCodeId: string;
    dates: string[];
    /** The rate to LKR to seed when none is loaded yet (the worker fetches real ones). */
    fxToLkr: number;
  },
): Promise<{ propertyId: string; roomId: string; occupancyId: string }> {
  const preset = presetFor(opts.country);
  const tax = preset.tax!;
  const currency = preset.baseCurrencies[0]!;

  const [property] = await db
    .insert(properties)
    .values({
      tenantId,
      name: opts.name,
      commissionType: 'percentage',
      commissionPercentage: '10',
      currency,
      countryCode: opts.country,
      stateCode: opts.stateCode,
      city: opts.city,
      timezone: preset.timezone,
      fyStartMonth: preset.fyStartMonth,
      taxIds: opts.taxIds,
      taxMode: tax.taxMode,
      settings: { requireGuestRegistration: tax.requireGuestRegistration },
    })
    .returning();
  const propertyId = property!.id;

  // The country's taxes, as applying its preset sets them up.
  const forward: ForwardTax[] = [];
  for (const seed of tax.taxes) {
    const [type] = await db
      .insert(taxTypes)
      .values({
        tenantId,
        name: seed.name,
        code: seed.code,
        compound: seed.compound,
        exemptible: seed.exemptible,
        displayGroup: seed.displayGroup,
        invoiceLabel: seed.invoiceLabel ?? null,
      })
      .returning();
    await db.insert(taxDurations).values(
      seed.rates.map((r) => ({
        tenantId,
        taxTypeId: type!.id,
        startDate: seed.from,
        endDate: '2099-12-31',
        ratePercent: r.ratePercent.toFixed(4),
        minAmount: r.minAmount === undefined ? null : r.minAmount.toFixed(2),
        maxAmount: r.maxAmount === undefined ? null : r.maxAmount.toFixed(2),
      })),
    );
    await db
      .insert(propertyTaxTypes)
      .values({ tenantId, propertyId, taxTypeId: type!.id, priority: seed.priority });
    for (const r of seed.rates) {
      forward.push({
        key: type!.id,
        name: seed.invoiceLabel ?? seed.name,
        code: seed.code,
        priority: seed.priority,
        rate: r.ratePercent / 100,
        exemptible: seed.exemptible,
        compound: seed.compound,
        displayGroup: seed.displayGroup,
        minAmount: r.minAmount ?? null,
        maxAmount: r.maxAmount ?? null,
      });
    }
  }
  for (const levy of tax.levies) {
    await db.insert(propertyLevies).values({
      tenantId,
      propertyId,
      code: levy.code,
      name: levy.name,
      amount: levy.amount.toFixed(2),
      currency: levy.currency,
      appliesTo: levy.appliesTo,
      validFrom: levy.from,
    });
  }

  const [room] = await db
    .insert(rooms)
    .values({ tenantId, propertyId, name: opts.roomName, quantity: opts.quantity })
    .returning();
  await db.insert(availabilityCalendar).values(
    opts.dates.map((date) => ({
      tenantId,
      propertyId,
      roomId: room!.id,
      date,
      physicalQuantity: opts.quantity,
      roomsToSell: opts.quantity,
      status: 'Open' as const,
    })),
  );
  const [plan] = await db
    .insert(ratePlans)
    .values({ tenantId, propertyId, roomId: room!.id, rateCodeId: opts.rateCodeId })
    .returning();
  const [occ] = await db
    .insert(occupancies)
    .values({ tenantId, ratePlanId: plan!.id, label: 'Double', accommodates: 2 })
    .returning();

  // base → YoHo commission → OTA gross-up = the pre-tax price; then the taxes on top.
  await db.insert(rateCalendar).values(
    opts.dates.map((date) => {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      const base = day === 0 || day === 6 ? opts.weekend : opts.weekday;
      const commission = computeCommission(base, { type: 'percentage', percentage: 10 });
      const net = roundMoney(sellingPrice(base, commission, 18));
      const night = forwardNight(net, forward);
      return {
        tenantId,
        occupancyId: occ!.id,
        date,
        basePrice: base.toFixed(2),
        commission: commission.toFixed(2),
        netPrice: night.net.toFixed(2),
        sellingPrice: night.selling.toFixed(2),
      };
    }),
  );

  // A MYR or INR booking snapshots a rate to LKR; seed one only if none is loaded.
  const [rate] = await db
    .select({ id: exchangeRates.id })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.base, currency), eq(exchangeRates.quote, 'LKR')))
    .limit(1);
  if (!rate) {
    await db
      .insert(exchangeRates)
      .values({ base: currency, quote: 'LKR', rate: opts.fxToLkr.toFixed(8), source: 'seed' });
  }

  return { propertyId, roomId: room!.id, occupancyId: occ!.id };
}
