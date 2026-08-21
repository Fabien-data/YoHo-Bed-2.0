import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { plans, subscriptions, tenantFeatures, tenants, type Tx } from '@yohobed/db';
import {
  resolveEntitlements,
  type DistributionMode,
  type Entitlements,
  type FeatureKey,
} from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';

export interface TenantPlan {
  plan: {
    code: string;
    name: string;
    description: string | null;
    priceMonthly: string;
    currency: string;
  } | null;
  subscription: {
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: Date | null;
    seats: number;
  } | null;
  distributionMode: DistributionMode;
  entitlements: Entitlements;
}

/**
 * Subscriptions and entitlements.
 *
 * `plans` and `tenants` carry no RLS policy, so they are read on the unscoped handle. Every read
 * or write of `subscriptions` / `tenant_features` goes through `withTenant`, which is what sets
 * the `app.tenant_id` GUC the RLS policies filter on — without it those tables return nothing.
 */
@Injectable()
export class BillingService {
  constructor(private readonly dbs: DatabaseService) {}

  /** The public catalogue, cheapest first. Used by the pricing page and the staff plan picker. */
  async catalogue() {
    return this.dbs.db
      .select({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        description: plans.description,
        priceMonthly: plans.priceMonthly,
        currency: plans.currency,
        features: plans.features,
      })
      .from(plans)
      .where(eq(plans.status, 'active'))
      .orderBy(asc(plans.sortOrder));
  }

  /**
   * What this tenant is on and what it may do.
   *
   * A tenant with no subscription row resolves to a deny-all entitlement set rather than an
   * error — an owner who registered a minute ago and has not been placed on a plan yet should
   * see an upgrade prompt, not a 500.
   *
   * Pass `tx` when the caller already holds a tenant-scoped transaction, to avoid nesting one.
   */
  async forTenant(tenantId: string, tx?: Tx): Promise<TenantPlan> {
    const scoped = tx
      ? await this.readScoped(tenantId, tx)
      : await this.dbs.withTenant(tenantId, (t) => this.readScoped(tenantId, t));

    const [t] = await this.dbs.db
      .select({ distributionMode: tenants.distributionMode })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    const { row, overrides } = scoped;
    // A cancelled or past-due subscription grants nothing — the plan's features are ignored.
    const active = row && (row.status === 'active' || row.status === 'trialing');

    return {
      plan: row
        ? {
            code: row.planCode,
            name: row.planName,
            description: row.planDescription,
            priceMonthly: row.priceMonthly,
            currency: row.currency,
          }
        : null,
      subscription: row
        ? {
            status: row.status,
            currentPeriodStart: row.currentPeriodStart,
            currentPeriodEnd: row.currentPeriodEnd,
            trialEndsAt: row.trialEndsAt,
            seats: row.seats,
          }
        : null,
      distributionMode: (t?.distributionMode ?? 'yoho') as DistributionMode,
      entitlements: resolveEntitlements(active ? row.features : null, overrides),
    };
  }

  private async readScoped(tenantId: string, tx: Tx) {
    const [row] = await tx
      .select({
        planCode: plans.code,
        planName: plans.name,
        planDescription: plans.description,
        priceMonthly: plans.priceMonthly,
        currency: plans.currency,
        features: plans.features,
        status: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        seats: subscriptions.seats,
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, tenantId));

    const overrides = await tx
      .select({
        key: tenantFeatures.key,
        enabled: tenantFeatures.enabled,
        limit: tenantFeatures.limitValue,
      })
      .from(tenantFeatures)
      .where(eq(tenantFeatures.tenantId, tenantId));

    return { row, overrides };
  }

  async entitlements(tenantId: string, tx?: Tx): Promise<Entitlements> {
    return (await this.forTenant(tenantId, tx)).entitlements;
  }

  async has(tenantId: string, feature: FeatureKey): Promise<boolean> {
    return (await this.entitlements(tenantId)).features[feature];
  }

  /** Staff-only: move a tenant onto a plan, creating the subscription if it does not exist. */
  async setPlan(tenantId: string, planCode: string): Promise<TenantPlan> {
    const [plan] = await this.dbs.db.select().from(plans).where(eq(plans.code, planCode));
    if (!plan) throw new NotFoundException(`Unknown plan '${planCode}'`);

    await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .insert(subscriptions)
        .values({ tenantId, planId: plan.id, status: 'active' })
        .onConflictDoUpdate({
          target: subscriptions.tenantId,
          set: { planId: plan.id, status: 'active', updatedAt: new Date() },
        }),
    );

    return this.forTenant(tenantId);
  }

  /** Staff-only: flip a tenant between YoHo-distributed and standalone PMS. */
  async setDistributionMode(tenantId: string, mode: DistributionMode): Promise<TenantPlan> {
    await this.dbs.db
      .update(tenants)
      .set({ distributionMode: mode, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    return this.forTenant(tenantId);
  }
}
