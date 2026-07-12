import { describe, it, expect } from 'vitest';
import { computeSettlement, priceDay } from '../src/index';

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
    expect(s).toMatchObject({ propertyBase: 100, yohoCommission: 0, otaCommission: 0, platformMargin: 0 });
  });
});
