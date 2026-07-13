import { describe, it, expect } from 'vitest';
import {
  sellingPrice,
  priceDay,
  systemBaseRate,
  geniusAmount,
  dealAmount,
  applyLastMinuteDrop,
} from '../src/index';
import type { CommissionStructure } from '../src/index';

describe('sellingPrice — gross up for OTA commission (/0.82 at 18%)', () => {
  it('applies (base + commission) / (1 - ota/100), rounded up', () => {
    // (1000 + 100) / 0.82 = 1341.463... -> 1341.47
    expect(sellingPrice(1000, 100, 18)).toBe(1341.47);
  });

  it('defaults the OTA rate to 18', () => {
    expect(sellingPrice(1000, 100)).toBe(1341.47);
  });

  it('works with zero commission', () => {
    // 500 / 0.82 = 609.756... -> 609.76
    expect(sellingPrice(500, 0, 18)).toBe(609.76);
  });
});

describe('priceDay — base -> commission -> selling', () => {
  it('prices a percentage-commission property', () => {
    // commission 111.12; (1000 + 111.12)/0.82 = 1355.024... -> 1355.03
    const priced = priceDay(1000, { type: 'percentage', percentage: 10 }, 18);
    expect(priced).toEqual({ base: 1000, commission: 111.12, selling: 1355.03 });
  });

  it('prices a slab-commission property', () => {
    const slab: CommissionStructure = {
      type: 'slab',
      slabs: [{ slabStart: 1000, slabEnd: 1999, commission: 250 }],
    };
    // (1500 + 250)/0.82 = 2134.146... -> 2134.15
    const priced = priceDay(1500, slab, 18);
    expect(priced).toEqual({ base: 1500, commission: 250, selling: 2134.15 });
  });
});

describe('downstream economics', () => {
  it('systemBaseRate retains (100 - commissionTotal)%', () => {
    expect(systemBaseRate(1000, 25)).toBe(750);
    expect(systemBaseRate(1000)).toBe(750);
  });

  it('geniusAmount is geniusRate% of the commissionable amount', () => {
    expect(geniusAmount(1000, 10)).toBe(100);
    expect(geniusAmount(1000)).toBe(100);
  });

  it('dealAmount grosses up the commissionable amount by the deal rate', () => {
    // 1000 / 0.80 - 1000 = 250
    expect(dealAmount(1000, 20)).toBe(250);
    // 800 / 0.75 - 800 = 266.666... -> 266.67
    expect(dealAmount(800, 25)).toBe(266.67);
  });
});

describe('applyLastMinuteDrop — last-minute discount on the selling price', () => {
  it('returns the selling price unchanged when the drop is zero', () => {
    expect(applyLastMinuteDrop(31625, 0)).toBe(31625);
  });

  it('applies a percentage discount, rounded to 2 places', () => {
    // 31625 * (1 - 0.15) = 26881.25
    expect(applyLastMinuteDrop(31625, 15)).toBe(26881.25);
  });
});
