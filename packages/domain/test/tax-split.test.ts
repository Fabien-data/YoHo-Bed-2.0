import { describe, expect, it } from 'vitest';
import { taxFromSelling } from '../src/tax';
import { splitInclusiveTax, type TaxComponent } from '../src/tax-split';
import { sumMoney } from '../src/money';

/** A Sri Lankan hotel bill: service charge, then SSCL, then VAT on top of both. */
const LK: TaxComponent[] = [
  { key: 'sc', name: 'Service Charge', priority: 1, rate: 0.1, exemptible: false },
  { key: 'sscl', name: 'SSCL', priority: 2, rate: 0.025, exemptible: false },
  { key: 'vat', name: 'VAT', priority: 3, rate: 0.18, exemptible: true },
];
const LK_RATES = { serviceCharge: 0.1, nbt: 0.025, vat: 0.18 };

describe('splitInclusiveTax', () => {
  it('splits a Sri Lankan room night into its three taxes, adding up to the stored tax', () => {
    const tax = taxFromSelling(10000, LK_RATES);
    expect(tax).toBe(2483.75);
    const lines = splitInclusiveTax(10000, LK, tax);
    expect(lines.map((l) => [l.key, l.amount])).toEqual([
      ['sc', 751.63],
      ['sscl', 206.7],
      ['vat', 1525.42],
    ]);
    expect(sumMoney(lines.map((l) => l.amount))).toBe(tax);
  });

  it('adds up to the legacy figure for any price', () => {
    for (let i = 0; i < 300; i++) {
      const selling = Math.round(Math.random() * 5_000_000) / 100;
      const tax = taxFromSelling(selling, LK_RATES);
      const lines = splitInclusiveTax(selling, LK, tax);
      expect(sumMoney(lines.map((l) => l.amount))).toBe(tax);
    }
  });

  it('shares one slot between two taxes by their rates', () => {
    const two: TaxComponent[] = [
      { key: 'a', name: 'State VAT', priority: 3, rate: 0.06, exemptible: true },
      { key: 'b', name: 'Federal VAT', priority: 3, rate: 0.12, exemptible: true },
    ];
    const tax = taxFromSelling(1180, { serviceCharge: 0, nbt: 0, vat: 0.18 });
    const lines = splitInclusiveTax(1180, two, tax);
    expect(lines.map((l) => l.amount)).toEqual([60, 120]);
  });

  it('returns nothing for an untaxed or free night', () => {
    expect(splitInclusiveTax(5000, [], 0)).toEqual([]);
    expect(splitInclusiveTax(0, LK, 0)).toEqual([]);
    const zeroRated = LK.map((c) => ({ ...c, rate: 0 }));
    expect(splitInclusiveTax(5000, zeroRated, 0)).toEqual([]);
  });
});
