import type { PlanFeatures } from '@yohobed/domain';
import { UNLIMITED } from '@yohobed/domain';
import { plans } from './schema';
import type { Database } from './client';
import type { Tx } from './scope';

/**
 * The subscription catalogue.
 *
 * Seeded rather than hardcoded so pricing and packaging can be changed in the database without a
 * deploy. Idempotent on `plans.code` — re-running the seed refreshes names/prices/features but
 * never orphans an existing subscription, because subscriptions reference the plan by id.
 *
 * Feature keys must exist in FEATURE_KEYS / LIMIT_KEYS (@yohobed/domain/entitlements); anything
 * else is silently ignored by `resolveEntitlements`, so keep them in step.
 */
export interface DefaultPlan {
  code: string;
  name: string;
  description: string;
  priceMonthly: string;
  sortOrder: number;
  features: PlanFeatures;
}

export const DEFAULT_PLANS: DefaultPlan[] = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'One small property. The front desk, and nothing you do not need.',
    priceMonthly: '29.00',
    sortOrder: 1,
    features: {
      features: {
        stay_view: true,
        room_view: true,
        housekeeping: true,
      },
      limits: { max_properties: 1, max_rooms: 20, max_users: 3 },
    },
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'A full PMS: folio, cashiering, night audit and channel distribution.',
    priceMonthly: '99.00',
    sortOrder: 2,
    features: {
      features: {
        stay_view: true,
        room_view: true,
        housekeeping: true,
        work_orders: true,
        folio: true,
        cashiering: true,
        pos: true,
        night_audit: true,
        channel_manager: true,
        guest_messaging: true,
        reports_advanced: true,
      },
      limits: { max_properties: 3, max_rooms: 150, max_users: 25 },
    },
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Everything in Pro, plus the B2B marketplace and the AI copilot, uncapped.',
    priceMonthly: '299.00',
    sortOrder: 3,
    features: {
      features: {
        stay_view: true,
        room_view: true,
        housekeeping: true,
        work_orders: true,
        folio: true,
        cashiering: true,
        pos: true,
        night_audit: true,
        channel_manager: true,
        guest_messaging: true,
        reports_advanced: true,
        b2b_marketplace: true,
        ai_copilot: true,
        multi_property: true,
      },
      limits: { max_properties: UNLIMITED, max_rooms: UNLIMITED, max_users: UNLIMITED },
    },
  },
];

/** Upsert the catalogue. Safe to re-run. */
export async function seedDefaultPlans(db: Tx | Database): Promise<void> {
  for (const p of DEFAULT_PLANS) {
    await db
      .insert(plans)
      .values({
        code: p.code,
        name: p.name,
        description: p.description,
        priceMonthly: p.priceMonthly,
        sortOrder: p.sortOrder,
        features: p.features,
      })
      .onConflictDoUpdate({
        target: plans.code,
        set: {
          name: p.name,
          description: p.description,
          priceMonthly: p.priceMonthly,
          sortOrder: p.sortOrder,
          features: p.features,
          updatedAt: new Date(),
        },
      });
  }
}
