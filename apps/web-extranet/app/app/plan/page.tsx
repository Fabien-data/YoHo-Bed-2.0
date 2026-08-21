'use client';

import { useEffect, useState } from 'react';
import {
  getTenantPlan,
  listPlans,
  FEATURE_LABELS,
  LIMIT_LABELS,
  type CataloguePlan,
  type TenantPlan,
} from '@/lib/api';
import { Card, Pill } from '@/components/ui';

const STATUS_TONE = {
  active: 'avail',
  trialing: 'brand',
  past_due: 'low',
  cancelled: 'closed',
} as const;

const STATUS_LABEL = {
  active: 'Active',
  trialing: 'Trial',
  past_due: 'Payment overdue',
  cancelled: 'Cancelled',
} as const;

function limitText(value: number): string {
  if (value === -1) return 'Unlimited';
  if (value === 0) return 'Not included';
  return String(value);
}

export default function PlanPage() {
  const [tenantPlan, setTenantPlan] = useState<TenantPlan | null>(null);
  const [catalogue, setCatalogue] = useState<CataloguePlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getTenantPlan(), listPlans()])
      .then(([p, c]) => {
        setTenantPlan(p);
        setCatalogue(c);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const entitlements = tenantPlan?.entitlements;
  const included = Object.entries(entitlements?.features ?? {}).filter(([, on]) => on);
  const excluded = Object.entries(entitlements?.features ?? {}).filter(([, on]) => !on);

  return (
    <div>
      <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
        Subscription
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Your plan</h1>
      <p className="mt-2 max-w-2xl text-base text-ink-2">
        What your subscription includes today, and what the other tiers add. To change plan, contact
        YoHoBed support.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-ink-3">Loading…</p>
      ) : !tenantPlan?.plan ? (
        <Card className="mt-6 p-8">
          <h2 className="text-lg font-bold text-ink">No active subscription</h2>
          <p className="mt-2 max-w-xl text-sm text-ink-2">
            Your account has not been placed on a plan yet, so the paid modules are switched off.
            Contact YoHoBed support to get started.
          </p>
        </Card>
      ) : (
        <>
          {/* Current plan */}
          <Card className="mt-6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-2xl font-bold tracking-tight text-ink">
                {tenantPlan.plan.name}
              </span>
              {tenantPlan.subscription && (
                <Pill tone={STATUS_TONE[tenantPlan.subscription.status]}>
                  {STATUS_LABEL[tenantPlan.subscription.status]}
                </Pill>
              )}
              {tenantPlan.distributionMode === 'yoho' && (
                <Pill tone="brand">YoHo distribution</Pill>
              )}
              <span className="ml-auto font-mono text-lg tabular-nums text-ink">
                {tenantPlan.plan.currency} {tenantPlan.plan.priceMonthly}
                <span className="text-sm text-ink-3"> / month</span>
              </span>
            </div>
            {tenantPlan.plan.description && (
              <p className="mt-2 max-w-2xl text-sm text-ink-2">{tenantPlan.plan.description}</p>
            )}

            {tenantPlan.subscription?.currentPeriodEnd && (
              <p className="mt-3 font-mono text-xs text-ink-3">
                Current period ends {tenantPlan.subscription.currentPeriodEnd}
              </p>
            )}

            {/* Limits */}
            <div className="mt-5 flex flex-wrap gap-4 border-t border-line pt-5">
              {Object.entries(entitlements?.limits ?? {}).map(([key, value]) => (
                <div key={key} className="min-w-[130px]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                    {LIMIT_LABELS[key] ?? key}
                  </div>
                  <div className="mt-0.5 text-lg font-bold tabular-nums text-ink">
                    {limitText(value)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* What's included */}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card className="p-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">Included</h2>
              <ul className="mt-3 flex flex-col gap-2">
                {included.map(([key]) => (
                  <li key={key} className="flex items-center gap-2 text-sm text-ink">
                    <span style={{ color: 'var(--avail-ink)' }}>✓</span>
                    {FEATURE_LABELS[key] ?? key}
                  </li>
                ))}
                {included.length === 0 && <li className="text-sm text-ink-3">Nothing yet.</li>}
              </ul>
            </Card>

            <Card className="p-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink-2">
                Not in your plan
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {excluded.map(([key]) => (
                  <li key={key} className="flex items-center gap-2 text-sm text-ink-3">
                    <span>·</span>
                    {FEATURE_LABELS[key] ?? key}
                  </li>
                ))}
                {excluded.length === 0 && (
                  <li className="text-sm text-ink-3">You have everything.</li>
                )}
              </ul>
            </Card>
          </div>

          {/* Catalogue */}
          {catalogue.length > 0 && (
            <>
              <h2 className="mt-10 text-lg font-bold tracking-tight text-ink">All plans</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                {catalogue.map((p) => {
                  const current = p.code === tenantPlan.plan?.code;
                  return (
                    <Card
                      key={p.id}
                      className="p-6"
                      style={current ? { borderColor: 'var(--brand)' } : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-ink">{p.name}</span>
                        {current && <Pill tone="brand">Current</Pill>}
                      </div>
                      <div className="mt-1 font-mono text-xl tabular-nums text-ink">
                        {p.currency} {p.priceMonthly}
                        <span className="text-xs text-ink-3"> / mo</span>
                      </div>
                      {p.description && <p className="mt-2 text-sm text-ink-2">{p.description}</p>}
                      <ul className="mt-4 flex flex-col gap-1.5">
                        {Object.entries(p.features.features ?? {})
                          .filter(([, on]) => on)
                          .map(([key]) => (
                            <li key={key} className="text-xs text-ink-2">
                              {FEATURE_LABELS[key] ?? key}
                            </li>
                          ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
