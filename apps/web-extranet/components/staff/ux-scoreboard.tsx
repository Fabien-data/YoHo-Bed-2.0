'use client';

import * as React from 'react';
import { Badge, Card, EmptyState, SegmentedControl } from '@yohobed/ui';
import { describeError, getUxScoreboard, type UxScoreboard } from '@/lib/api';

/**
 * Task labels and, where docs/UX-STANDARD.md §3 sets one, the click budget for the "vs budget"
 * column. A task without a budget shows its median alone.
 */
const TASKS: Record<string, { label: string; clicks?: number }> = {
  'reservation.quick': { label: 'Quick Reservation', clicks: 8 },
  'reservation.full': { label: 'Full reservation page' },
  'stay.check_in': { label: 'Check in', clicks: 3 },
  'stay.check_out': { label: 'Check out', clicks: 5 },
  'folio.take_payment': { label: 'Take a payment', clicks: 4 },
  'search.find_booking': { label: 'Find a booking', clicks: 2 },
  'night_audit.run': { label: 'Night audit' },
};

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;

function seconds(ms: number | null) {
  return ms === null ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/**
 * The UX scoreboard (UX-0): are hotels actually finding YoHoBed fast and easy? Task times and
 * clicks from real use, the pulse survey beside the industry baseline, and "had to take it back"
 * signals read straight from the records.
 */
export function UxScoreboardPanel({
  tenantId,
  tenantName,
}: {
  tenantId: string | null;
  tenantName?: string;
}) {
  const [days, setDays] = React.useState<'7' | '30' | '90'>('30');
  const [scope, setScope] = React.useState<'all' | 'tenant'>('all');
  const [data, setData] = React.useState<UxScoreboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    setError(null);
    getUxScoreboard(Number(days), scope === 'tenant' && tenantId ? tenantId : undefined)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(describeError(e, 'The scoreboard could not be loaded')));
    return () => {
      live = false;
    };
  }, [days, scope, tenantId]);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h2 className="text-lg font-bold tracking-tight text-ink">UX scoreboard</h2>
          <p className="text-sm text-ink-2">
            Real task times and clicks, the staff pulse survey against the industry baseline, and
            actions taken back within minutes. No guest data is collected.
          </p>
        </div>
        <SegmentedControl
          aria-label="Scope"
          options={[
            { value: 'all', label: 'All hotels' },
            { value: 'tenant', label: tenantName ? tenantName : 'Selected hotel' },
          ]}
          value={scope}
          onChange={setScope}
        />
        <SegmentedControl aria-label="Period" options={PERIODS} value={days} onChange={setDays} />
      </div>

      {error && <p className="mt-3 text-sm text-closed-ink">{error}</p>}

      {data && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-3 py-2">Task</th>
                  <th className="px-3 py-2 text-right">Done</th>
                  <th className="px-3 py-2 text-right">Dropped</th>
                  <th className="px-3 py-2 text-right">Median</th>
                  <th className="px-3 py-2 text-right">p90</th>
                  <th className="px-3 py-2 text-right">Clicks</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState title="No tasks measured in this period yet." />
                    </td>
                  </tr>
                ) : (
                  data.tasks.map((t) => {
                    const meta = TASKS[t.task];
                    const budget = meta?.clicks;
                    const over =
                      budget !== undefined && t.medianClicks !== null && t.medianClicks > budget;
                    return (
                      <tr key={t.task} className="border-t border-line">
                        <td className="px-3 py-2 text-ink">{meta?.label ?? t.task}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {t.completed}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {t.abandoned}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {seconds(t.medianMs)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {seconds(t.p90Ms)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">
                          {t.medianClicks ?? '—'}
                          {budget !== undefined && (
                            <span className={over ? 'text-closed-ink' : 'text-ink-3'}>
                              {' '}
                              / {budget}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-semibold text-ink">Staff pulse survey</h3>
            <p className="text-xs text-ink-3">
              Share agreeing (4–5 of 5). Baseline: the 2025 Cloudbeds/NYU survey of 500 hotel
              employees.
            </p>
            <ul className="mt-3 space-y-3">
              {data.survey.map((s) => {
                const ahead = s.agreePct !== null && s.agreePct >= s.baselinePct;
                return (
                  <li key={s.key} className="text-sm">
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 text-ink-2">{s.text}</span>
                      <span className="font-mono tabular-nums text-ink">
                        {s.agreePct === null ? '—' : `${s.agreePct}%`}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-ink-3">
                        vs {s.baselinePct}%
                      </span>
                    </div>
                    <div className="text-xs text-ink-3">
                      {s.responses} response{s.responses === 1 ? '' : 's'}
                      {s.agreePct !== null && (
                        <Badge tone={ahead ? 'avail' : 'low'} className="ml-2">
                          {ahead ? 'ahead of the industry' : 'behind the industry'}
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <h3 className="mt-5 text-sm font-semibold text-ink">Taken back within minutes</h3>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              <dt className="text-ink-2">Folio charges voided within 10 minutes</dt>
              <dd className="font-mono tabular-nums">{data.mistakes.quickVoids}</dd>
              <dt className="text-ink-2">Bookings cancelled within 5 minutes</dt>
              <dd className="font-mono tabular-nums">{data.mistakes.quickCancels}</dd>
              <dt className="text-ink-2">Invoices credited within a day</dt>
              <dd className="font-mono tabular-nums">{data.mistakes.quickCreditNotes}</dd>
              <dt className="text-ink-2">Screens that crashed</dt>
              <dd className="font-mono tabular-nums">{data.clientErrors}</dd>
            </dl>
          </Card>
        </div>
      )}
    </section>
  );
}
