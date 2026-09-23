import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  availabilityCalendar,
  ledgerAccountRates,
  ledgerAccounts,
  occupancies,
  properties,
  rateCalendar,
  rateCodes,
  ratePlans,
  resolveTaxComponentsForDates,
  resolveTaxRatesForDates,
  rooms,
  quoteSmartStay,
  type Tx,
} from '@yohobed/db';
import {
  applyLastMinuteDrop,
  audienceAllows,
  complimentaryNight,
  discountPercent,
  exemptNight,
  overrideNight,
  overridePrices,
  roundMoney,
  splitInclusiveTax,
  taxFromSelling,
  type DistributionModeLike,
  type RateAudience,
  type RateOverride,
  type RateSource,
  type Residency,
  type TaxLine,
  type SmartGuestMix,
  type SmartNightQuote,
} from '@yohobed/domain';
import { eachNight } from '../common/dates';

/** How a line is priced beyond the rate calendar. Everything off is the legacy path. */
export interface PricingPolicy {
  /** A typed rate. */
  override?: RateOverride | null;
  /** Price from this travel agent's or company's contract rates. */
  contractAccountId?: string | null;
  complimentary?: boolean;
  /** Remove the taxes a tax-exempt guest is excused from. */
  taxExempt?: boolean;
}

export interface PriceLineInput {
  roomId: string;
  occupancyId: string;
  checkin: string;
  checkout: string;
  rooms: number;
  guests?: SmartGuestMix;
  /** Trusted server authorization; the reason alone never grants an exception. */
  minimumException?: { authorized: boolean; reason: string };
  /** Confirmed external contracts retain their provider amount, independently of current policies. */
  externalContract?: boolean;
  policy?: PricingPolicy;
  /** The guest's residency; checked against the rate plan's audience when `checkAudience`. */
  residency?: Residency | null;
  /** The new reservation flow checks these; the legacy walk-in and amend paths never did. */
  checkAudience?: boolean;
  requireActivePlan?: boolean;
  /** The arrival date's min/max-stay rules. Legacy create checks them; amend does not. */
  checkRestrictions?: boolean;
  /** The message for a stay with unpriced nights (create and amend word it differently). */
  unpricedMessage?: string;
  /** Zero-based line number, used to name the line in errors. */
  lineIndex?: number;
}

/** One stored night, per room — the `booking_days` row. Money as two-decimal strings. */
export interface PricedNight {
  date: string;
  basePrice: string;
  commission: string;
  sellingPrice: string;
  tax: string;
  listSellingPrice: string;
  rateSource: RateSource;
  taxLines: TaxLine[];
  smartQuote?: SmartNightQuote;
}

export interface PricedLine {
  roomId: string;
  roomName: string;
  occupancyId: string;
  ratePlanId: string;
  rateCode: string;
  rateName: string;
  audience: RateAudience;
  accommodates: number;
  /** The rate plan's default market segment. */
  marketSegmentId: string | null;
  propertyId: string;
  currency: string;
  timezone: string;
  rooms: number;
  nights: PricedNight[];
  /** Totals for the line (× rooms), as the booking row stores them. */
  amount: string;
  totalBase: string;
  taxes: string;
  commissionable: string;
  /** What the line would cost at the list price. */
  listAmount: string;
  /** Percent below the list price (negative when raised). */
  discountPct: number;
  /** The line's pricing, summarised: calendar, override, contract or complimentary. */
  rateSource: RateSource;
  /**
   * The unrounded running totals, exactly as the legacy walk-in accumulated them. Coupon and
   * referral maths take these, so a calendar-priced booking discounts to the same cent it did.
   */
  raw: { amount: number; taxes: number; commissionable: number };
  policyVersion?: number;
}

const money = (n: number) => n.toFixed(2);

/**
 * The one place a stay is priced (Development Phase 02).
 *
 * Quote, create and amend all come through here, so the price the desk is quoted is the price
 * that is stored. A night priced from the rate calendar follows the legacy engine exactly — the
 * same operations in the same order as the walk-in code this replaced, which a golden test pins.
 * Overrides, contract rates, complimentary rooms and tax exemption are layered on top from
 * `@yohobed/domain/rate-policy` and never change a calendar night.
 */
@Injectable()
export class ReservationPricer {
  async priceLine(tx: Tx, input: PriceLineInput, mode: DistributionModeLike): Promise<PricedLine> {
    const label = input.lineIndex !== undefined ? `Room ${input.lineIndex + 1}: ` : '';

    // BUG #2: price on the EXPLICIT occupancy key, and verify it belongs to the room.
    const [occ] = await tx
      .select({
        propertyId: rooms.propertyId,
        roomId: ratePlans.roomId,
        roomName: rooms.name,
        ratePlanId: ratePlans.id,
        planStatus: ratePlans.status,
        audience: ratePlans.audience,
        marketSegmentId: ratePlans.marketSegmentId,
        rateCode: rateCodes.code,
        rateName: rateCodes.name,
        currency: properties.currency,
        timezone: properties.timezone,
        accommodates: occupancies.accommodates,
      })
      .from(occupancies)
      .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
      .innerJoin(rateCodes, eq(rateCodes.id, ratePlans.rateCodeId))
      .innerJoin(rooms, eq(rooms.id, ratePlans.roomId))
      .innerJoin(properties, eq(properties.id, rooms.propertyId))
      .where(eq(occupancies.id, input.occupancyId));
    if (!occ) throw new NotFoundException('Occupancy not found');
    if (occ.roomId !== input.roomId) {
      throw new BadRequestException(`${label}Occupancy does not belong to this room`);
    }
    if (input.requireActivePlan && occ.planStatus !== 'Active') {
      throw new BadRequestException(`${label}The ${occ.rateCode} rate is not active`);
    }
    const audience = occ.audience as RateAudience;
    if (input.checkAudience && !audienceAllows(audience, input.residency)) {
      throw new BadRequestException({
        reason: 'rate_audience',
        message: input.residency
          ? `${label}The ${occ.rateCode} rate is for ${audience} guests only`
          : `${label}Say whether the guest is local or foreign to use the ${occ.rateCode} ${audience} rate`,
        line: input.lineIndex,
      });
    }

    const nights = eachNight(input.checkin, input.checkout);

    // Min/max-stay restriction on the arrival date (legacy parity: arrival-based rules).
    if (input.checkRestrictions) {
      const [arrival] = await tx
        .select({ minStay: availabilityCalendar.minStay, maxStay: availabilityCalendar.maxStay })
        .from(availabilityCalendar)
        .where(
          and(
            eq(availabilityCalendar.roomId, input.roomId),
            eq(availabilityCalendar.date, nights[0]!),
          ),
        );
      if (arrival) {
        if (nights.length < arrival.minStay) {
          throw new BadRequestException(
            `${label}Minimum stay for arrivals on ${nights[0]} is ${arrival.minStay} nights`,
          );
        }
        if (arrival.maxStay > 0 && nights.length > arrival.maxStay) {
          throw new BadRequestException(
            `${label}Maximum stay for arrivals on ${nights[0]} is ${arrival.maxStay} nights`,
          );
        }
      }
    }

    // Price snapshot for the correct occupancy.
    let smart: Awaited<ReturnType<typeof quoteSmartStay>> = null;
    try {
      if (!input.externalContract)
        smart = await quoteSmartStay(tx, {
          propertyId: occ.propertyId,
          occupancyId: input.occupancyId,
          dates: nights,
          guests: input.guests,
          minimumException: input.minimumException,
        });
    } catch (error) {
      throw new BadRequestException({
        message: label + (error as Error).message,
        line: input.lineIndex,
      });
    }
    if (smart && !smart.eligible)
      throw new BadRequestException({
        message: label + smart.issues.map((issue) => issue.message).join(' '),
        issues: smart.issues,
        line: input.lineIndex,
      });
    const priceRows = smart
      ? smart.nights.map((night) => ({ ...night, lastMinuteDropPct: '0' }))
      : await tx
          .select()
          .from(rateCalendar)
          .where(
            and(
              eq(rateCalendar.occupancyId, input.occupancyId),
              inArray(rateCalendar.date, nights),
            ),
          );
    if (priceRows.length !== nights.length) {
      throw new BadRequestException(
        `${label}${input.unpricedMessage ?? 'Prices are not set for all nights of this stay'}`,
      );
    }
    const byDate = new Map(priceRows.map((r) => [r.date, r]));

    // Untaxed properties resolve to zero rates, so taxes = 0.
    const taxByDate = await resolveTaxRatesForDates(tx, occ.propertyId, nights);
    const componentsByDate = await resolveTaxComponentsForDates(tx, occ.propertyId, nights);

    // The list price of every night: the calendar price after any last-minute drop.
    const list = nights.map((d) => {
      const p = byDate.get(d)!;
      const selling = applyLastMinuteDrop(Number(p.sellingPrice), Number(p.lastMinuteDropPct));
      return { date: d, p, selling, tax: taxFromSelling(selling, taxByDate.get(d)!) };
    });

    const policy = input.policy ?? {};
    const target = await this.targetPrices(tx, policy, input, occ.ratePlanId, list, label);

    const priced: PricedNight[] = [];
    let amount = 0;
    let totalBase = 0;
    let taxes = 0;
    let listAmount = 0;
    for (let i = 0; i < list.length; i++) {
      const { date: d, p, selling: listSelling, tax: listTax } = list[i]!;
      const rates = taxByDate.get(d)!;
      let night: {
        base: number | string;
        commission: number | string;
        selling: number;
        tax: number;
      };
      let source: RateSource;

      if (policy.complimentary) {
        night = complimentaryNight();
        source = 'complimentary';
      } else {
        const t = target?.[i];
        if (t === undefined || t.price === listSelling) {
          // The legacy path: the stored base and commission as the calendar has them.
          night = {
            base: p.basePrice,
            commission: p.commission,
            selling: listSelling,
            tax: listTax,
          };
          source = 'calendar';
        } else {
          const newTax = taxFromSelling(t.price, rates);
          night = overrideNight(
            {
              base: Number(p.basePrice),
              commission: Number(p.commission),
              selling: listSelling,
              tax: listTax,
            },
            t.price,
            newTax,
            mode,
          );
          source = t.source;
        }
      }

      let lines = splitInclusiveTax(night.selling, componentsByDate.get(d) ?? [], night.tax);
      if (policy.taxExempt && !policy.complimentary) {
        const exempt = exemptNight(night.selling, night.tax, lines);
        night = { ...night, selling: exempt.selling, tax: exempt.tax };
        lines = exempt.lines;
      }
      const smartQuote = smart?.nights[i]?.quote;
      if (smartQuote) {
        const actualCore = Math.round(Number(night.base) * 100) - smartQuote.bedNetMinor;
        if (actualCore < smartQuote.minimumNetMinor) {
          if (!input.minimumException?.authorized || !input.minimumException.reason.trim())
            throw new BadRequestException({
              reason: 'minimum_net_rate',
              message: `${label}${d}: room and meals are below the hotel minimum. An authorized exception and reason are required.`,
              line: input.lineIndex,
            });
          smartQuote.belowMinimum = true;
          smartQuote.exceptionReason = input.minimumException.reason.trim();
        }
      }

      amount += night.selling * input.rooms;
      totalBase += Number(night.base) * input.rooms;
      taxes += night.tax * input.rooms;
      listAmount += listSelling * input.rooms;

      priced.push({
        date: d,
        basePrice: typeof night.base === 'string' ? night.base : money(night.base),
        commission:
          typeof night.commission === 'string' ? night.commission : money(night.commission),
        sellingPrice: money(night.selling),
        tax: money(night.tax),
        listSellingPrice: money(listSelling),
        rateSource: source,
        taxLines: lines,
        ...(smartQuote ? { smartQuote } : {}),
      });
    }
    const commissionable = amount - taxes;

    const sources = new Set(priced.map((n) => n.rateSource));
    const rateSource: RateSource = policy.complimentary
      ? 'complimentary'
      : sources.has('override')
        ? 'override'
        : sources.has('contract')
          ? 'contract'
          : 'calendar';

    return {
      roomId: input.roomId,
      roomName: occ.roomName,
      occupancyId: input.occupancyId,
      ratePlanId: occ.ratePlanId,
      rateCode: occ.rateCode,
      rateName: occ.rateName,
      audience,
      accommodates: occ.accommodates,
      marketSegmentId: occ.marketSegmentId,
      propertyId: occ.propertyId,
      currency: occ.currency,
      timezone: occ.timezone,
      rooms: input.rooms,
      nights: priced,
      amount: money(amount),
      totalBase: money(totalBase),
      taxes: money(taxes),
      commissionable: money(commissionable),
      listAmount: money(listAmount),
      discountPct: discountPercent(roundMoney(listAmount), roundMoney(amount)),
      rateSource,
      raw: { amount, taxes, commissionable },
      ...(smart ? { policyVersion: smart.policyVersion } : {}),
    };
  }

  /**
   * The tax-inclusive price each night should have under the policy, or null for the calendar
   * price throughout. An override applies to every night; a contract rate only to the nights a
   * contract row (or the account's standing discount) covers.
   */
  private async targetPrices(
    tx: Tx,
    policy: PricingPolicy,
    input: PriceLineInput,
    ratePlanId: string,
    list: Array<{ date: string; selling: number }>,
    label: string,
  ): Promise<Array<{ price: number; source: RateSource } | undefined> | null> {
    if (policy.complimentary) return null;

    if (policy.override) {
      let prices: number[];
      try {
        prices = overridePrices(
          policy.override,
          list.map((n) => n.date),
          list.map((n) => n.selling),
        );
      } catch (e) {
        throw new BadRequestException(`${label}${(e as Error).message}`);
      }
      return prices.map((price) => ({ price, source: 'override' as const }));
    }

    if (policy.contractAccountId) {
      const first = list[0]!.date;
      const last = list[list.length - 1]!.date;
      const [account] = await tx
        .select({ discountPct: ledgerAccounts.discountPct })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.id, policy.contractAccountId));
      const rows = await tx
        .select()
        .from(ledgerAccountRates)
        .where(
          and(
            eq(ledgerAccountRates.ledgerAccountId, policy.contractAccountId),
            eq(ledgerAccountRates.roomId, input.roomId),
            eq(ledgerAccountRates.active, true),
            lte(ledgerAccountRates.validFrom, last),
            gte(ledgerAccountRates.validTo, first),
          ),
        );
      const standing = Number(account?.discountPct ?? 0);

      return list.map((n) => {
        const covering = rows
          .filter(
            (r) =>
              r.validFrom <= n.date &&
              r.validTo >= n.date &&
              (r.ratePlanId === null || r.ratePlanId === ratePlanId),
          )
          // The row naming the meal plan wins, then the most recent contract.
          .sort(
            (a, b) =>
              Number(b.ratePlanId !== null) - Number(a.ratePlanId !== null) ||
              b.validFrom.localeCompare(a.validFrom) ||
              b.createdAt.getTime() - a.createdAt.getTime(),
          )[0];
        if (covering) {
          const price =
            covering.mode === 'fixed'
              ? roundMoney(Number(covering.value))
              : roundMoney(n.selling * (1 - Number(covering.value) / 100));
          return { price, source: 'contract' as const };
        }
        if (standing > 0) {
          return {
            price: roundMoney(n.selling * (1 - standing / 100)),
            source: 'contract' as const,
          };
        }
        return undefined;
      });
    }

    return null;
  }
}
