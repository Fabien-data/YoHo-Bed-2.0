import { describe, expect, it } from 'vitest';
import { roundMoney, splitProportional, sumMoney, toCents } from '../src/money';

describe('roundMoney', () => {
  it('rounds half away from zero, past binary noise', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(2.344)).toBe(2.34);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(0)).toBe(0);
  });

  it('never rounds up the way the legacy round_up does', () => {
    expect(roundMoney(10.001)).toBe(10);
    expect(toCents(24390.244)).toBe(2439024);
  });
});

describe('splitProportional', () => {
  it('gives leftover cents to the largest remainders, earliest first on a tie', () => {
    expect(splitProportional(100, [1, 1, 1])).toEqual([33.34, 33.33, 33.33]);
    expect(splitProportional(301, [100, 200])).toEqual([100.33, 200.67]);
  });

  it('splits evenly when there is nothing to weigh by', () => {
    expect(splitProportional(0.05, [0, 0])).toEqual([0.03, 0.02]);
    expect(splitProportional(10, [])).toEqual([]);
  });

  it('keeps the sign of a negative total', () => {
    expect(splitProportional(-10, [1, 3])).toEqual([-2.5, -7.5]);
  });

  it('always adds back to the total', () => {
    for (let i = 0; i < 200; i++) {
      const total = Math.round(Math.random() * 1_000_000) / 100;
      const weights = Array.from({ length: 1 + (i % 7) }, () => Math.random() * 500);
      const parts = splitProportional(total, weights);
      expect(sumMoney(parts)).toBe(roundMoney(total));
    }
  });
});
