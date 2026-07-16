/**
 * Domain types for the YoHoBed pricing engine.
 *
 * These mirror the legacy data model (Laravel 5.4 extranet + CodeIgniter backend) but are
 * expressed cleanly. All monetary values are plain numbers in the property's base currency
 * (legacy stores LKR). We deliberately mirror the legacy IEEE-754 float arithmetic so the
 * computed numbers match the legacy stored values bit-for-bit (see rounding.ts).
 */

/** Yoho commission model attached to a property (legacy `commissionstructures.type`). */
export type CommissionStructure =
  { type: 'slab'; slabs: CommissionSlab[] } | { type: 'percentage'; percentage: number };

/** A single commission slab (legacy `commissionslabs`). Bounds are inclusive on both ends. */
export interface CommissionSlab {
  slabStart: number;
  slabEnd: number;
  commission: number;
}

/**
 * The three priority-ordered tax rates for a property on a given date, as decimal fractions
 * (e.g. 0.10 for 10%). Summed from `property_tax_types -> tax_durations.amount` by priority
 * (legacy Constants.php:41-51 / PricingCalculator.php:30-43).
 */
export interface TaxRates {
  /** priority 1 */
  serviceCharge: number;
  /** priority 2 */
  nbt: number;
  /** priority 3 */
  vat: number;
}

/** Platform-wide economic constants (legacy `.env`). */
export interface PricingConstants {
  /** OTA commission percentage, legacy `OTA_COMMISSION_RATE` (=18 → the `/0.82` divisor). */
  otaCommissionRate: number;
  /** Total commission percentage (yoho + ota), legacy `COMMISSION_TOTAL` (=25). */
  commissionTotal: number;
  /** Booking.com genius discount percentage, legacy `GENIUS_RATE` (=10). */
  geniusRate: number;
}
