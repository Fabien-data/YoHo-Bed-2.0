import { describe, it, expect } from 'vitest';
import { couponDiscount, referralCommission } from '../src/index';

describe('couponDiscount', () => {
  it('takes a percentage off the amount', () => {
    // 26881.25 * 10% = 2688.125 -> 2688.13
    expect(couponDiscount(26881.25, 'percentage', 10)).toBe(2688.13);
  });

  it('takes a fixed amount off, capped at the amount', () => {
    expect(couponDiscount(1000, 'fixed', 300)).toBe(300);
    expect(couponDiscount(200, 'fixed', 300)).toBe(200); // never more than the amount
  });

  it('is never negative', () => {
    expect(couponDiscount(0, 'percentage', 50)).toBe(0);
  });
});

describe('referralCommission', () => {
  it('is a percentage of the commissionable amount', () => {
    // 24390.24 * 5% = 1219.512 -> 1219.51
    expect(referralCommission(24390.24, 5)).toBe(1219.51);
  });
});
