import { and, eq, inArray } from 'drizzle-orm';
import {
  priceDay,
  quoteSmartNight,
  roomPolicyFor,
  sellingFromCommissionable,
  taxFromSelling,
  type CommissionStructure,
  type SmartGuestMix,
  type SmartPropertyDocument,
} from '@yohobed/domain';
import type { Tx } from './scope';
import {
  commissionSlabs,
  properties,
  rateCalendar,
  smartPropertyPolicies,
  tenants,
} from './schema';
import { resolveTaxRatesForDates } from './tax';

/** Refresh-only providers cannot convey guest ages, meal rules or net minimums. */
export async function assertSmartChannelCapability(tx: Tx, propertyId: string) {
  const [policy] = await tx
    .select({ published: smartPropertyPolicies.published })
    .from(smartPropertyPolicies)
    .where(eq(smartPropertyPolicies.propertyId, propertyId));
  if (policy?.published)
    throw new Error(
      'Smart rate publishing is unsupported by this adapter. A verified guest-policy mapping is required; no channel rate update was sent.',
    );
}

/** Shared by setup preview, reservations and channel publication. No writes or implied exceptions. */
export async function quoteSmartStay(
  tx: Tx,
  input: {
    propertyId: string;
    occupancyId: string;
    dates: string[];
    guests?: SmartGuestMix;
    draft?: { document: SmartPropertyDocument; version: number };
    minimumException?: { authorized: boolean; reason: string };
  },
) {
  const [saved] = input.draft
    ? []
    : await tx
        .select()
        .from(smartPropertyPolicies)
        .where(eq(smartPropertyPolicies.propertyId, input.propertyId));
  const document = input.draft?.document ?? saved?.published;
  if (!document) return null;
  const policyVersion = input.draft?.version ?? saved!.publishedVersion!;
  const room = roomPolicyFor(document, input.occupancyId);
  const rate = document.rates[input.occupancyId];
  if (!room || !rate) throw new Error('Review and publish a smart policy for this guest rate.');
  if (!input.guests)
    throw new Error('Enter adult counts and every child age before pricing this room.');
  const [property] = await tx.select().from(properties).where(eq(properties.id, input.propertyId));
  if (!property) throw new Error('Property not found.');
  const [tenant] = await tx
    .select({ mode: tenants.distributionMode })
    .from(tenants)
    .where(eq(tenants.id, property.tenantId));
  let commission: CommissionStructure = {
    type: 'percentage',
    percentage: Number(property.commissionPercentage),
  };
  if (property.commissionType === 'slab' && tenant?.mode !== 'standalone') {
    const slabs = await tx
      .select()
      .from(commissionSlabs)
      .where(eq(commissionSlabs.propertyId, property.id));
    if (!slabs.length) throw new Error('Configure commission slabs before pricing.');
    commission = {
      type: 'slab',
      slabs: slabs.map((slab) => ({
        slabStart: Number(slab.slabStart),
        slabEnd: Number(slab.slabEnd),
        commission: Number(slab.commission),
      })),
    };
  }
  const prices = await tx
    .select()
    .from(rateCalendar)
    .where(
      and(
        eq(rateCalendar.occupancyId, rate.baseOccupancyId),
        inArray(rateCalendar.date, input.dates),
      ),
    );
  const byDate = new Map(prices.map((price) => [price.date, price]));
  const taxes = await resolveTaxRatesForDates(tx, input.propertyId, input.dates);
  const nights = input.dates.map((date) => {
    const base = byDate.get(date);
    if (!base) throw new Error(`Set the base rate for ${date}.`);
    const quote = quoteSmartNight({
      room,
      meal: rate.meal,
      guests: input.guests!,
      baseNetMinor: Math.round(Number(base.basePrice) * 100),
      mayOverrideMinimum: input.minimumException?.authorized,
      overrideReason: input.minimumException?.reason,
    });
    const net = quote.totalNetMinor / 100;
    const priced =
      tenant?.mode === 'standalone'
        ? { base: net, commission: 0, selling: net }
        : priceDay(net, commission);
    const gross = sellingFromCommissionable(priced.selling, taxes.get(date)!);
    const tax = taxFromSelling(gross, taxes.get(date)!);
    return {
      date,
      quote,
      basePrice: net.toFixed(2),
      commission: priced.commission.toFixed(2),
      sellingPrice: gross.toFixed(2),
      tax: tax.toFixed(2),
      economics: {
        hotelBaseNetMinor: quote.totalNetMinor,
        commissionMinor: Math.round(priced.commission * 100),
        channelMarginMinor: Math.max(
          0,
          Math.round((priced.selling - net - priced.commission) * 100),
        ),
        taxesMinor: Math.round(tax * 100),
        guestTotalMinor: Math.round(gross * 100),
      },
    };
  });
  return {
    document,
    policyVersion,
    currency: property.currency,
    nights,
    eligible: nights.every((night) => night.quote.eligible),
    issues: nights.flatMap((night) =>
      night.quote.issues.map((issue) => ({ ...issue, message: `${night.date}: ${issue.message}` })),
    ),
  };
}
