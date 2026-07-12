import { describe, it, expect } from 'vitest';
import { roundUp, round2 } from '../src/index';

describe('roundUp (legacy round_up — always ceilings)', () => {
  it('ceilings up at the smallest fraction', () => {
    expect(roundUp(1.001)).toBe(1.01);
    expect(roundUp(1.0101)).toBe(1.02);
  });

  it('leaves exact 2dp values unchanged', () => {
    expect(roundUp(2)).toBe(2);
    expect(roundUp(1341.47)).toBe(1341.47);
  });

  it('ceilings the .xx4 case that half-up rounding would drop', () => {
    // half-up would give 1.00; legacy round_up gives 1.01
    expect(roundUp(1.004)).toBe(1.01);
  });

  it('handles the /0.82 selling-price quotient', () => {
    expect(roundUp(1100 / 0.82)).toBe(1341.47);
  });

  it('supports arbitrary places', () => {
    expect(roundUp(1.23001, 3)).toBe(1.231);
  });
});

describe('round2 (PHP round, half away from zero for money)', () => {
  it('rounds to 2 decimals', () => {
    expect(round2(174.754)).toBe(174.75);
    expect(round2(174.756)).toBe(174.76);
  });

  it('is a no-op on clean values', () => {
    expect(round2(750)).toBe(750);
  });
});
