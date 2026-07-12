import { round2 } from './rounding';
import type { TaxRates } from './types';

/**
 * Decompose the tax portion out of a gross (tax-inclusive) selling price.
 *
 * Legacy nested reverse-division, applied in priority order VAT → NBT → service charge.
 * Source: extranet/app/Custom/Libraries/PricingCalculator.php:55-62
 *   $gross = ((($selling / (1 + $vat)) / (1 + $nbt)) / (1 + $service_charge));
 *   return round($selling - $gross, 2);
 */
export function taxFromSelling(selling: number, rates: TaxRates): number {
  const gross = selling / (1 + rates.vat) / (1 + rates.nbt) / (1 + rates.serviceCharge);
  return round2(selling - gross, 2);
}

/**
 * The commissionable total = selling price minus taxes.
 * Source: PricingCalculator::calculateCommissionableTotal (`return ($selling_price - $taxes)`).
 */
export function commissionableTotal(selling: number, taxes: number): number {
  return selling - taxes;
}
