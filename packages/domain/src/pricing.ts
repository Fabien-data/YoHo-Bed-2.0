import { roundUp, round2 } from './rounding';
import { computeCommission } from './commission';
import type { CommissionStructure, PricingConstants } from './types';

/** Platform defaults from the legacy `.env`. */
export const DEFAULT_CONSTANTS: PricingConstants = {
  otaCommissionRate: 18, // OTA_COMMISSION_RATE
  commissionTotal: 25, // COMMISSION_TOTAL
  geniusRate: 10, // GENIUS_RATE
};

/**
 * The sellable price of a per-day rate, grossed up to cover the OTA commission.
 *
 * Source: extranet RatesAndAvailability.php:105
 *   round_up(($base_price + $commission) / (1 - (OTA_COMMISSION_RATE / 100)), 2)
 * With OTA = 18 this is the ubiquitous `/ 0.82`.
 */
export function sellingPrice(
  base: number,
  commission: number,
  otaRate: number = DEFAULT_CONSTANTS.otaCommissionRate,
): number {
  return roundUp((base + commission) / (1 - otaRate / 100), 2);
}

export interface PricedDay {
  base: number;
  commission: number;
  selling: number;
}

/**
 * Full per-day price for one occupancy-rate-plan from its base price:
 * resolve the commission (slab or percentage) then gross up for the OTA cut.
 */
export function priceDay(
  base: number,
  structure: CommissionStructure,
  otaRate: number = DEFAULT_CONSTANTS.otaCommissionRate,
): PricedDay {
  const commission = computeCommission(base, structure);
  const selling = sellingPrice(base, commission, otaRate);
  return { base, commission, selling };
}

/**
 * The base rate the property retains after the total (yoho + ota) commission.
 * Source: PricingCalculator::calculateSystemBaseRate
 *   $commissionable * ((100 - COMMISSION_TOTAL) / 100)
 */
export function systemBaseRate(
  commissionable: number,
  commissionTotal: number = DEFAULT_CONSTANTS.commissionTotal,
): number {
  return commissionable * ((100 - commissionTotal) / 100);
}

/**
 * Booking.com "genius" loyalty discount amount.
 * Source: PricingCalculator::calculateGeniusAmount
 *   round($commissionable * (GENIUS_RATE / 100), 2)
 */
export function geniusAmount(
  commissionable: number,
  geniusRate: number = DEFAULT_CONSTANTS.geniusRate,
): number {
  return round2(commissionable * (geniusRate / 100));
}

/**
 * Promotional deal amount added on top of a commissionable amount for a given deal rate (%).
 * Source: PricingCalculator::calculateDealAmount
 *   round(($commissionable / ((100 - $deal_rate) / 100)) - $commissionable, 2)
 */
export function dealAmount(commissionable: number, dealRate: number): number {
  return round2(commissionable / ((100 - dealRate) / 100) - commissionable);
}
