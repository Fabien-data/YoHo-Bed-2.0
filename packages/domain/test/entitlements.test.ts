import { describe, it, expect } from 'vitest';
import {
  FEATURE_KEYS,
  LIMIT_KEYS,
  UNLIMITED,
  resolveEntitlements,
  withinLimit,
  commissionStructureFor,
  computeCommission,
  type CommissionStructure,
  type PlanFeatures,
} from '../src/index';

describe('resolveEntitlements', () => {
  it('denies everything when there is no plan', () => {
    const e = resolveEntitlements(null);
    expect(Object.values(e.features).every((v) => v === false)).toBe(true);
    expect(Object.values(e.limits).every((v) => v === 0)).toBe(true);
  });

  it('returns every key, so callers never see undefined', () => {
    const e = resolveEntitlements({ features: { stay_view: true } });
    expect(Object.keys(e.features).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(Object.keys(e.limits).sort()).toEqual([...LIMIT_KEYS].sort());
  });

  it('grants exactly what the plan lists and nothing more', () => {
    const plan: PlanFeatures = {
      features: { stay_view: true, housekeeping: true },
      limits: { max_rooms: 20 },
    };
    const e = resolveEntitlements(plan);
    expect(e.features.stay_view).toBe(true);
    expect(e.features.housekeeping).toBe(true);
    expect(e.features.night_audit).toBe(false);
    expect(e.limits.max_rooms).toBe(20);
    expect(e.limits.max_properties).toBe(0);
  });

  it('lets a tenant override grant a feature the plan does not include', () => {
    const e = resolveEntitlements({ features: { stay_view: true } }, [
      { key: 'night_audit', enabled: true },
    ]);
    expect(e.features.night_audit).toBe(true);
  });

  it('lets a tenant override revoke a feature the plan does include', () => {
    const e = resolveEntitlements({ features: { pos: true } }, [{ key: 'pos', enabled: false }]);
    expect(e.features.pos).toBe(false);
  });

  it('raises a numeric limit via an override, and treats a disabled override as zero', () => {
    const plan: PlanFeatures = { limits: { max_rooms: 20 } };
    expect(
      resolveEntitlements(plan, [{ key: 'max_rooms', enabled: true, limit: 50 }]).limits.max_rooms,
    ).toBe(50);
    expect(resolveEntitlements(plan, [{ key: 'max_rooms', enabled: false }]).limits.max_rooms).toBe(
      0,
    );
  });

  it('treats an enabled limit override with no number as unlimited', () => {
    const e = resolveEntitlements({ limits: { max_rooms: 20 } }, [
      { key: 'max_rooms', enabled: true },
    ]);
    expect(e.limits.max_rooms).toBe(UNLIMITED);
  });

  it('ignores unknown override keys rather than throwing', () => {
    const e = resolveEntitlements({ features: { stay_view: true } }, [
      { key: 'not_a_real_feature', enabled: true },
    ]);
    expect(e.features.stay_view).toBe(true);
  });
});

describe('withinLimit', () => {
  it('allows usage below the cap and blocks at it', () => {
    expect(withinLimit(3, 2)).toBe(true);
    expect(withinLimit(3, 3)).toBe(false);
  });

  it('always allows when unlimited', () => {
    expect(withinLimit(UNLIMITED, 10_000)).toBe(true);
  });

  it('blocks everything at zero — the deny-by-default case', () => {
    expect(withinLimit(0, 0)).toBe(false);
  });
});

describe('commissionStructureFor', () => {
  const configured = { type: 'percentage', percentage: 10 } as const;

  it('leaves a YoHo-distributed tenant on its configured structure', () => {
    expect(commissionStructureFor('yoho', configured)).toEqual(configured);
  });

  it('zeroes the platform cut for a standalone PMS subscriber', () => {
    // The point of the flag: it selects the pricing INPUT, it does not branch the maths.
    const standalone = commissionStructureFor('standalone', configured);
    expect(computeCommission(10_000, standalone)).toBe(0);
    expect(computeCommission(10_000, configured)).toBeGreaterThan(0);
  });

  it('zeroes a slab structure too, not just a percentage one', () => {
    const slabbed: CommissionStructure = {
      type: 'slab',
      slabs: [{ slabStart: 0, slabEnd: 100_000, commission: 750 }],
    };
    expect(computeCommission(10_000, commissionStructureFor('standalone', slabbed))).toBe(0);
    expect(computeCommission(10_000, slabbed)).toBe(750);
  });
});
