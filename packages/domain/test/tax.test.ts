import { describe, it, expect } from 'vitest';
import { taxFromSelling, commissionableTotal } from '../src/index';
import type { TaxRates } from '../src/index';

const noTax: TaxRates = { serviceCharge: 0, nbt: 0, vat: 0 };

describe('taxFromSelling — nested reverse-division (VAT -> NBT -> service charge)', () => {
  it('returns zero when there are no taxes', () => {
    expect(taxFromSelling(500, noTax)).toBe(0);
  });

  it('extracts a single VAT layer', () => {
    // 110 / 1.10 = 100 gross -> 10.00 tax
    expect(taxFromSelling(110, { serviceCharge: 0, nbt: 0, vat: 0.1 })).toBe(10);
  });

  it('extracts a single service-charge layer', () => {
    expect(taxFromSelling(110, { serviceCharge: 0.1, nbt: 0, vat: 0 })).toBe(10);
  });

  it('stacks two layers multiplicatively (not additively)', () => {
    // 121 / 1.1 / 1.1 = 100 gross -> 21.00 tax (additive would be 20)
    expect(taxFromSelling(121, { serviceCharge: 0, nbt: 0.1, vat: 0.1 })).toBe(21);
  });
});

describe('commissionableTotal', () => {
  it('is selling minus taxes', () => {
    expect(commissionableTotal(1000, 174.75)).toBe(825.25);
  });
});
