'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Moon, TriangleAlert } from 'lucide-react';
import { Badge, Button, Card, Skeleton, cn } from '@yohobed/ui';
import { getBusinessDate, getNightAuditLog, previewNightAudit, runNightAudit } from '@/lib/api';
import { useProperties } from '@/lib/queries';

/**
 * The day-end.
 *
 * The preview comes before the button on purpose: this is the one action in the product that
 * cannot be undone by clicking something else, so the auditor sees the damage first and then
 * confirms it explicitly.
 */
export default function NightAuditPage() {
  const qc = useQueryClient();
  const { data: properties } = useProperties();
  const propertyId = properties?.[0]?.id;
  const [confirming, setConfirming] = React.useState(false);

  const businessDate = useQuery({
    queryKey: ['business-date', propertyId],
    queryFn: () => getBusinessDate(propertyId!),
    enabled: !!propertyId,
  });
  const preview = useQuery({
    queryKey: ['audit-preview', propertyId, businessDate.data?.currentDate],
    queryFn: () => previewNightAudit(propertyId!),
    enabled: !!propertyId,
  });
  const log = useQuery({
    queryKey: ['audit-log', propertyId],
    queryFn: () => getNightAuditLog(propertyId!),
    enabled: !!propertyId,
  });

  const run = useMutation({
    mutationFn: () => runNightAudit(propertyId!),
    onSuccess: () => {
      setConfirming(false);
      // The audit touches almost everything, so everything that could be stale is dropped.
      for (const key of [
        'business-date',
        'audit-preview',
        'audit-log',
        'folio',
        'stayview',
        'drawers',
        'room-view',
        'reservations',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const p = preview.data;

  return (
    <div>
      <div className="mb-4">
        <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
          Cashiering
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Night audit</h1>
          {businessDate.data && (
            <Badge tone="brand">
              <CalendarClock size={12} />
              Business date {businessDate.data.currentDate}
            </Badge>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-ink-2">
          The business date is not today&rsquo;s date — it is the day the hotel is still working on.
          Everything posts against it until the audit rolls it forward.
        </p>
      </div>

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-bold text-ink">What this run will do</h2>
        {preview.isLoading || !p ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <dl className="mb-4 grid gap-3 sm:grid-cols-4">
              <Stat label="Rooms to charge" value={String(p.roomsToCharge)} />
              <Stat label="Charges to post" value={p.chargesToPost} />
              <Stat label="of which tax" value={p.taxesToPost} muted />
              <Stat
                label="No-shows"
                value={String(p.noShows.length)}
                alert={p.noShows.length > 0}
              />
            </dl>

            {p.noShows.length > 0 && (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-[var(--low-soft)] px-3 py-2 text-sm text-[var(--low-ink)]">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <span>
                  These reservations were due to arrive and never did. The audit will mark them as
                  no-shows: {p.noShows.join(', ')}
                </span>
              </p>
            )}

            <p className="mb-3 text-sm text-ink-2">
              Running the audit posts the night&rsquo;s room charges, marks any no-shows, closes
              every till still open, and moves the business date to{' '}
              <span className="font-semibold text-ink">{p.nextDate}</span>.
            </p>

            {confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  Close {p.date} and roll to {p.nextDate}?
                </span>
                <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
                  {run.isPending ? 'Running…' : 'Yes, run the audit'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button onClick={() => setConfirming(true)} disabled={!propertyId}>
                <Moon size={15} />
                Run night audit
              </Button>
            )}
            {run.isError && (
              <p className="mt-2 text-sm text-[var(--closed-ink)]">
                {(run.error as Error).message}
              </p>
            )}
          </>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-bold text-ink">Audit log</h2>
      {log.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (log.data ?? []).length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">No audits have been run yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3">Closed</th>
                <th className="px-4 py-3">Rolled to</th>
                <th className="px-4 py-3 text-right">Rooms</th>
                <th className="px-4 py-3 text-right">Posted</th>
                <th className="px-4 py-3 text-right">No-shows</th>
                <th className="px-4 py-3 text-right">Tills closed</th>
                <th className="px-4 py-3">Run by</th>
              </tr>
            </thead>
            <tbody>
              {(log.data ?? []).map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                    {r.fromDate}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-2">{r.toDate}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-2">
                    {r.roomsCharged}
                    {r.summary?.roomsSkipped ? (
                      <span className="ml-1 text-xs text-ink-3">
                        (+{r.summary.roomsSkipped} already billed)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {Number(r.chargesPosted).toFixed(2)}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-3 text-right font-mono tabular-nums',
                      r.noShows > 0 ? 'text-[var(--closed-ink)]' : 'text-ink-3',
                    )}
                  >
                    {r.noShows}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-3">
                    {r.drawersClosed}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">
                    {r.runBy ?? 'system'}
                    {r.runFromIp && <span className="ml-1 font-mono">({r.runFromIp})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  muted,
  alert,
}: {
  label: string;
  value: string;
  muted?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-mono text-lg font-bold tabular-nums',
          alert ? 'text-[var(--closed-ink)]' : muted ? 'text-ink-3' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
