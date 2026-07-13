import { describe, it, expect } from 'vitest';
import { taxFromSelling, commissionableTotal, sellingFromCommissionable } from '../src/index';
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

describe('sellingFromCommissionable — inverse gross-up (service charge -> NBT -> VAT)', () => {
  it('returns the commissionable unchanged when there are no taxes', () => {
    expect(sellingFromCommissionable(100, noTax)).toBe(100);
  });

  it('adds a single VAT layer', () => {
    expect(sellingFromCommissionable(100, { serviceCharge: 0, nbt: 0, vat: 0.1 })).toBe(110);
  });

  it('stacks layers multiplicatively (not additively)', () => {
    // 100 * 1.1 * 1.1 = 121 (additive would be 120)
    expect(sellingFromCommissionable(100, { serviceCharge: 0, nbt: 0.1, vat: 0.1 })).toBe(121);
  });

  it('round-trips with taxFromSelling: commissionable = selling - taxes', () => {
    const rates: TaxRates = { serviceCharge: 0.1, nbt: 0.02, vat: 0.15 };
    const commissionable = 1000;
    const selling = sellingFromCommissionable(commissionable, rates);
    const taxes = taxFromSelling(selling, rates);
    expect(selling - taxes).toBeCloseTo(commissionable, 2);
  });
});
