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
