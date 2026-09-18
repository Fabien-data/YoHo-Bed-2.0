import { describe, expect, it } from 'vitest';
import { decomposeBooking } from '../src/finance';
import {
  complimentaryNight,
  discountPercent,
  exemptNight,
  overrideNight,
  overridePrices,
} from '../src/rate-policy';

/** A YoHo-distributed night: base 18,000 + 10% commission, grossed up for the OTA (÷0.82). */
const LIST = { base: 18000, commission: 2000, selling: 24390.25, tax: 0 };

function otaMargin(n: { base: number; commission: number; selling: number; tax: number }) {
  return decomposeBooking(n.selling, n.tax, n.base, n.commission).otaCommission;
}

describe('overrideNight — YoHo-distributed', () => {
  it('keeps the list economics when the price does not move (r = 1)', () => {
    const n = overrideNight(LIST, 24390.25, 0, 'yoho');
    expect(n).toEqual({ base: 18000, commission: 2000, selling: 24390.25, tax: 0 });
  });

  it('scales base and commission with the price, rounding half-up', () => {
    const n = overrideNight(LIST, 12195.13, 0, 'yoho');
    expect(n.base).toBe(9000);
    expect(n.commission).toBe(1000);
    expect(otaMargin(n)).toBe(2195.13);
  });

  it('pays nothing on a zero price (r = 0)', () => {
    expect(overrideNight(LIST, 0, 0, 'yoho')).toEqual({
      base: 0,
      commission: 0,
      selling: 0,
      tax: 0,
    });
  });

  it('never leaves the OTA a negative margin', () => {
    // A last-minute drop can already have eaten the margin: list excl. 50 < base + commission.
    const eroded = { base: 70, commission: 10, selling: 50, tax: 0 };
    const n = overrideNight(eroded, 50, 0, 'yoho');
    expect(n.base).toBe(50);
    expect(n.commission).toBe(0);
    expect(otaMargin(n)).toBe(0);

    for (let i = 0; i < 300; i++) {
      const price = Math.round(Math.random() * 4_000_000) / 100;
      expect(otaMargin(overrideNight(LIST, price, 0, 'yoho'))).toBeGreaterThanOrEqual(0);
    }
  });

  it('scales from the tax-exclusive price on a taxed night', () => {
    const taxed = { base: 1000, commission: 111.12, selling: 1731.93, tax: 376.71 };
    const n = overrideNight(taxed, 865.97, 188.36, 'yoho');
    // r = (865.97 − 188.36) ÷ (1731.93 − 376.71) = 0.5
    expect(n.base).toBe(500);
    expect(n.commission).toBe(55.56);
    expect(otaMargin(n)).toBeGreaterThanOrEqual(0);
  });
});

describe('overrideNight — standalone', () => {
  it('gives the property the whole tax-exclusive price and no commission', () => {
    const list = { base: 1000, commission: 0, selling: 1150, tax: 150 };
    expect(overrideNight(list, 920, 120, 'standalone')).toEqual({
      base: 800,
      commission: 0,
      selling: 920,
      tax: 120,
    });
  });
});

describe('complimentary and exemption', () => {
  it('zeroes a complimentary night', () => {
    expect(complimentaryNight()).toEqual({ base: 0, commission: 0, selling: 0, tax: 0 });
  });

  it('removes only the exemptible taxes', () => {
    const lines = [
      { key: 'sc', name: 'Service Charge', priority: 1, rate: 0.1, amount: 100, exemptible: false },
      { key: 'vat', name: 'VAT', priority: 3, rate: 0.18, amount: 198, exemptible: true },
    ];
    const r = exemptNight(1298, 298, lines);
    expect(r.selling).toBe(1100);
    expect(r.tax).toBe(100);
    expect(r.exempted).toBe(198);
    expect(r.lines.map((l) => l.key)).toEqual(['sc']);
  });

  it('changes nothing when no tax is exemptible', () => {
    const lines = [
      { key: 'sc', name: 'Service Charge', priority: 1, rate: 0.1, amount: 100, exemptible: false },
    ];
    expect(exemptNight(1100, 100, lines)).toEqual({ selling: 1100, tax: 100, lines, exempted: 0 });
  });
});

describe('overridePrices', () => {
  const dates = ['2027-01-01', '2027-01-02'];

  it('applies a nightly rate to every night', () => {
    expect(overridePrices({ mode: 'nightly', amount: 150.005 }, dates, [100, 200])).toEqual([
      150.01, 150.01,
    ]);
  });

  it('spreads a stay total in proportion to the list prices', () => {
    expect(overridePrices({ mode: 'total', amount: 301 }, dates, [100, 200])).toEqual([
      100.33, 200.67,
    ]);
  });

  it('takes a percentage off each night', () => {
    expect(overridePrices({ mode: 'discount_pct', pct: 15 }, dates, [100, 250])).toEqual([
      85, 212.5,
    ]);
  });

  it('needs a price for every night in per-night mode', () => {
    expect(
      overridePrices(
        { mode: 'per_night', amounts: { '2027-01-01': 90, '2027-01-02': 95 } },
        dates,
        [100, 100],
      ),
    ).toEqual([90, 95]);
    expect(() =>
      overridePrices({ mode: 'per_night', amounts: { '2027-01-01': 90 } }, dates, [100, 100]),
    ).toThrow(/2027-01-02/);
  });
});

describe('discountPercent', () => {
  it('reports a discount as positive and a raise as negative', () => {
    expect(discountPercent(200, 150)).toBe(25);
    expect(discountPercent(200, 250)).toBe(-25);
    expect(discountPercent(300, 200)).toBe(33.3333);
    expect(discountPercent(0, 0)).toBe(0);
    expect(discountPercent(0, 10)).toBe(-100);
  });
});
