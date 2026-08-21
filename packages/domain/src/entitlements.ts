import type { CommissionStructure } from './types';

/**
 * Subscription entitlements and the distribution mode.
 *
 * Unlike the rest of this package these rules have no legacy counterpart — YohoBed 2.0 is sold as
 * a subscription SaaS, which the legacy platform never was. They live here rather than in the API
 * because both the Nest API and the Next.js app need to agree on what a plan grants, and this
 * package is the only dependency the two already share.
 */

/** Every gateable module. Adding a key here is what makes it sellable as part of a plan. */
export const FEATURE_KEYS = [
  'stay_view',
  'room_view',
  'housekeeping',
  'work_orders',
  'folio',
  'cashiering',
  'pos',
  'night_audit',
  'channel_manager',
  'guest_messaging',
  'reports_advanced',
  'b2b_marketplace',
  'ai_copilot',
  'multi_property',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Numeric caps. `UNLIMITED` (-1) means no ceiling. */
export const LIMIT_KEYS = ['max_properties', 'max_rooms', 'max_users'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const UNLIMITED = -1;

/** The shape stored in `plans.features` (jsonb). Absent keys are denied / zero. */
export interface PlanFeatures {
  features?: Partial<Record<FeatureKey, boolean>>;
  limits?: Partial<Record<LimitKey, number>>;
}

/** A per-tenant override row (`tenant_features`) — lets support grant one module off-plan. */
export interface FeatureOverride {
  key: string;
  enabled: boolean;
  limit?: number | null;
}

/** Fully resolved, every key present — so callers never have to handle `undefined`. */
export interface Entitlements {
  features: Record<FeatureKey, boolean>;
  limits: Record<LimitKey, number>;
}

function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(key);
}

function isLimitKey(key: string): key is LimitKey {
  return (LIMIT_KEYS as readonly string[]).includes(key);
}

/**
 * Resolve what a tenant may actually do: the plan's grants, then per-tenant overrides on top.
 *
 * Deny-by-default — a feature the plan does not mention is off, and a limit it does not mention
 * is 0. That way a newly added FEATURE_KEY is never accidentally live for existing subscribers.
 */
export function resolveEntitlements(
  plan: PlanFeatures | null | undefined,
  overrides: readonly FeatureOverride[] = [],
): Entitlements {
  const features = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, plan?.features?.[k] ?? false]),
  ) as Record<FeatureKey, boolean>;

  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, plan?.limits?.[k] ?? 0])) as Record<
    LimitKey,
    number
  >;

  for (const o of overrides) {
    if (isFeatureKey(o.key)) {
      features[o.key] = o.enabled;
      continue;
    }
    // A limit override only counts when it carries a number; `enabled: false` zeroes it.
    if (isLimitKey(o.key)) {
      limits[o.key] = o.enabled ? (o.limit ?? UNLIMITED) : 0;
    }
  }

  return { features, limits };
}

/** True when `used` is still inside the cap. `UNLIMITED` always passes. */
export function withinLimit(limit: number, used: number): boolean {
  return limit === UNLIMITED || used < limit;
}

/**
 * How a tenant reaches the market.
 *
 * - `yoho`       — a YoHo-distributed supplier. The platform commission and the payout/settlement
 *                  chain apply, exactly as the legacy platform worked.
 * - `standalone` — a hotel that bought the PMS as a subscription and sells its own inventory.
 *                  YoHo takes no cut; rates are simply the hotel's rates.
 */
export const DISTRIBUTION_MODES = ['yoho', 'standalone'] as const;
export type DistributionMode = (typeof DISTRIBUTION_MODES)[number];

/**
 * The commission structure to actually price with.
 *
 * Standalone tenants get a zero-percentage structure, which `computeCommission` evaluates to
 * `base / (1 - 0) - base = 0`. The parity core is therefore untouched: the distribution mode
 * selects the *input*, it does not branch the pricing maths.
 */
export function commissionStructureFor(
  mode: DistributionMode,
  configured: CommissionStructure,
): CommissionStructure {
  return mode === 'standalone' ? { type: 'percentage', percentage: 0 } : configured;
}
