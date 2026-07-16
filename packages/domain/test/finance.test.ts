import { describe, it, expect } from 'vitest';
import { computeSettlement, priceDay, decomposeBooking } from '../src/index';

describe('computeSettlement', () => {
  it('splits a booking total into property base + yoho + ota, and always reconciles', () => {
    // A night priced from base 120 at 10% commission, OTA 18%: selling 162.61, yoho commission 13.34.
    const { commission, selling } = priceDay(120, { type: 'percentage', percentage: 10 }, 18);
    const s = computeSettlement(selling, 120, commission);

    expect(s.propertyBase).toBe(120);
    expect(s.yohoCommission).toBe(13.34);
    expect(s.otaCommission).toBe(29.27);
    expect(s.platformMargin).toBe(42.61);
    // The invariant: base + yoho + ota === gross.
    expect(s.propertyBase + s.yohoCommission + s.otaCommission).toBeCloseTo(s.grossSelling, 2);
  });

  it('handles a zero-commission booking (property keeps everything)', () => {
    const s = computeSettlement(100, 100, 0);
    expect(s).toMatchObject({
      propertyBase: 100,
      yohoCommission: 0,
      otaCommission: 0,
      platformMargin: 0,
    });
  });
});

/**
 * The tax-aware settlement decomposition (Compartment A). Proves the reconciliation invariant
 *   gross = propertyBase + yohoCommission + otaCommission + taxes
 * and that an untaxed booking is byte-identical to the pre-tax `computeSettlement`.
 */
describe('decomposeBooking — tax-aware settlement split', () => {
  it('reconciles gross to base + yoho + ota + taxes', () => {
    // Base Rs 18,000 → Yoho commission Rs 2,000 → commissionable Rs 24,390.24 (÷0.82),
    // then a ~10% tax layer grosses it up to Rs 26,829.27 charged.
    const d = decomposeBooking(26829.27, 2439.03, 18000, 2000);
    expect(d.commissionable).toBeCloseTo(24390.24, 2);
    expect(d.propertyBase).toBe(18000);
    expect(d.yohoCommission).toBe(2000);
    expect(d.otaCommission).toBeCloseTo(4390.24, 2);

    const sum = d.propertyBase + d.yohoCommission + d.otaCommission + d.taxes;
    expect(sum).toBeCloseTo(d.grossSelling, 2);
  });

  it('collapses to computeSettlement when there is no tax', () => {
    const gross = 24390.25;
    const base = 18000;
    const yoho = 2000;
    const d = decomposeBooking(gross, 0, base, yoho);
    const s = computeSettlement(gross, base, yoho);

    expect(d.taxes).toBe(0);
    expect(d.commissionable).toBe(gross);
    expect(d.propertyBase).toBe(s.propertyBase);
    expect(d.yohoCommission).toBe(s.yohoCommission);
    expect(d.otaCommission).toBe(s.otaCommission);
  });
});
