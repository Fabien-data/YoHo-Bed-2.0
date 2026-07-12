import { describe, it, expect } from 'vitest';
import { computeCommission, CommissionSlabNotFoundError } from '../src/index';
import type { CommissionStructure } from '../src/index';

const slabStructure: CommissionStructure = {
  type: 'slab',
  slabs: [
    { slabStart: 0, slabEnd: 999, commission: 100 },
    { slabStart: 1000, slabEnd: 1999, commission: 250 },
    { slabStart: 2000, slabEnd: 5000, commission: 500 },
  ],
};

describe('computeCommission — percentage', () => {
  it('grosses the base up by the yoho percentage and takes the delta', () => {
    // 1000 / (1 - 0.10) - 1000 = 111.111... -> round_up -> 111.12
    expect(computeCommission(1000, { type: 'percentage', percentage: 10 })).toBe(111.12);
  });

  it('handles other percentages', () => {
    // 2000 / 0.85 - 2000 = 352.941... -> round_up -> 352.95
    expect(computeCommission(2000, { type: 'percentage', percentage: 15 })).toBe(352.95);
  });
});

describe('computeCommission — slab', () => {
  it('selects the slab whose inclusive range covers the base', () => {
    expect(computeCommission(1500, slabStructure)).toBe(250);
  });

  it('treats slab bounds as inclusive on both ends', () => {
    expect(computeCommission(1000, slabStructure)).toBe(250);
    expect(computeCommission(1999, slabStructure)).toBe(250);
    expect(computeCommission(2000, slabStructure)).toBe(500);
  });

  it('throws when no slab covers the base price', () => {
    expect(() => computeCommission(6000, slabStructure)).toThrow(CommissionSlabNotFoundError);
  });
});
