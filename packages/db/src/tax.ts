import { eq, inArray } from 'drizzle-orm';
import type { Tx } from './scope';
import { propertyTaxTypes, taxDurations } from './schema';

/** Priority-ordered tax rates for a property on a date, as decimal fractions (0.10 = 10%). */
export interface PropertyTaxRates {
  /** priority 1 */
  serviceCharge: number;
  /** priority 2 */
  nbt: number;
  /** priority 3 */
  vat: number;
}

/**
 * Resolve a property's tax rates for each date in `dates`, reproducing the legacy priority model
 * (Constants.php / PricingCalculator.php): each linked tax type contributes the rate of its
 * duration covering the date, summed into serviceCharge (priority 1), nbt (2), vat (3). Rates are
 * returned as decimal fractions for direct use with `taxFromSelling`. A property with no tax
 * config yields zero rates for every date — the common (and current seed) case. Call inside
 * `withTenant(...)` so RLS is in force.
 */
export async function resolveTaxRatesForDates(
  tx: Tx,
  propertyId: string,
  dates: string[],
): Promise<Map<string, PropertyTaxRates>> {
  const out = new Map<string, PropertyTaxRates>();

  const links = await tx
    .select({ priority: propertyTaxTypes.priority, taxTypeId: propertyTaxTypes.taxTypeId })
    .from(propertyTaxTypes)
    .where(eq(propertyTaxTypes.propertyId, propertyId));

  if (links.length === 0) {
    for (const d of dates) out.set(d, { serviceCharge: 0, nbt: 0, vat: 0 });
    return out;
  }

  const durations = await tx
    .select()
    .from(taxDurations)
    .where(
      inArray(
        taxDurations.taxTypeId,
        links.map((l) => l.taxTypeId),
      ),
    );

  for (const d of dates) {
    const rates: PropertyTaxRates = { serviceCharge: 0, nbt: 0, vat: 0 };
    for (const link of links) {
      // ISO date strings compare lexically, so `<=`/`>=` are correct date comparisons here.
      const dur = durations.find(
        (x) => x.taxTypeId === link.taxTypeId && x.startDate <= d && x.endDate >= d,
      );
      const frac = dur ? Number(dur.ratePercent) / 100 : 0;
      if (link.priority === 1) rates.serviceCharge += frac;
      else if (link.priority === 2) rates.nbt += frac;
      else if (link.priority === 3) rates.vat += frac;
    }
    out.set(d, rates);
  }
  return out;
}
