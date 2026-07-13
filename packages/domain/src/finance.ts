import { round2 } from './rounding';

export interface Settlement {
  /** Total charged to the guest (the grossed-up selling price). */
  grossSelling: number;
  /** Net payable to the property — their base rate. */
  propertyBase: number;
  /** The platform's (Yoho) commission. */
  yohoCommission: number;
  /** The OTA's commission (the remainder of the margin). */
  otaCommission: number;
  /** Total margin kept by platform + OTA = grossSelling − propertyBase. */
  platformMargin: number;
}

/**
 * Split a booking total into what the property is settled vs. the commissions retained.
 *
 * Selling was grossed up from the base by (Yoho + OTA) commission, so the property is paid the
 * base; `yohoCommission` is the stored platform commission; whatever margin remains is the OTA
 * cut. By construction this always reconciles: propertyBase + yohoCommission + otaCommission =
 * grossSelling. Mirrors the legacy payout intent (Calculator::bookingPayable) in clean form.
 */
export function computeSettlement(
  grossSelling: number,
  propertyBase: number,
  yohoCommission: number,
): Settlement {
  const platformMargin = round2(grossSelling - propertyBase);
  const otaCommission = round2(platformMargin - yohoCommission);
  return {
    grossSelling: round2(grossSelling),
    propertyBase: round2(propertyBase),
    yohoCommission: round2(yohoCommission),
    otaCommission,
    platformMargin,
  };
}

export interface BookingEconomics {
  /** Total charged to the guest — the tax-inclusive selling total. */
  grossSelling: number;
  /** Tax portion decomposed out of the selling total (legacy calculateTaxFromSelling). */
  taxes: number;
  /** grossSelling − taxes; the base for the commission split (legacy commissionable_total). */
  commissionable: number;
  /** Net payable to the property — their base rate. */
  propertyBase: number;
  /** The platform's (Yoho) commission. */
  yohoCommission: number;
  /** The OTA's commission (the remainder of the commissionable margin). */
  otaCommission: number;
}

/**
 * Tax-aware settlement: split a booking's charged (tax-inclusive) total into taxes plus the
 * property/Yoho/OTA settlement.
 *
 * Model: grossSelling = propertyBase + yohoCommission + otaCommission + taxes. Taxes are first
 * decomposed out (legacy PricingCalculator::calculateCommissionableTotal → `selling − taxes`);
 * the property is paid its base, Yoho keeps the stored commission, and the OTA takes the rest of
 * the commissionable margin. Reconciles by construction. With `taxes = 0` this collapses to
 * exactly `computeSettlement` — so untaxed properties are unchanged to the cent.
 */
export function decomposeBooking(
  grossSelling: number,
  taxes: number,
  propertyBase: number,
  yohoCommission: number,
): BookingEconomics {
  const commissionable = round2(grossSelling - taxes);
  const otaCommission = round2(commissionable - propertyBase - yohoCommission);
  return {
    grossSelling: round2(grossSelling),
    taxes: round2(taxes),
    commissionable,
    propertyBase: round2(propertyBase),
    yohoCommission: round2(yohoCommission),
    otaCommission,
  };
}
