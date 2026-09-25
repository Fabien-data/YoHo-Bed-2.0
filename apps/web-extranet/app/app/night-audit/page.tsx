'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDots,
  CashRegister,
  ClockClockwise,
  DoorOpen,
  MoonStars,
  Robot,
  UserMinus,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  InlineAlert,
  PageHeader,
  Skeleton,
  cn,
  toast,
} from '@yohobed/ui';
import {
  describeError,
  getBusinessDate,
  getNightAuditLog,
  previewNightAudit,
  runNightAudit,
  type AuditPreview,
} from '@/lib/api';
import { useTenantRole } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';

/** Where the owner changes how the day closes. */
const SETTINGS_HREF = '/app/configuration/reservation-settings';

/**
 * The day-end.
 *
 * The preview comes before the button on purpose: this is the one action in the product that
 * cannot be undone by clicking something else, so the auditor sees the damage first and then
 * confirms it explicitly.
 *
 * Since 2026-09-26 the day can close by itself at the owner's time, and stays nobody checked out
 * are checked out with it; this page says which, and still lets the owner close the day early.
 */
export default function NightAuditPage() {
  const qc = useQueryClient();
  const { propertyId } = useActiveProperty();
  const isOwner = useTenantRole() === 'OWNER';
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
    onSuccess: (r) => {
      toast.success(`${r.fromDate} is closed`, {
        description: `The business date is now ${r.toDate}.`,
      });
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
        'housekeeping',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (e) => toast.error(describeError(e, 'The night audit did not run')),
  });

  const p = preview.data;

  return (
    <div>
      <PageHeader
        eyebrow="Cashiering"
        title="Night audit"
        description="The business date is the day the hotel is still working on. Everything posts against it until the audit closes it and moves to the next."
        actions={
          businessDate.data && (
            <Badge tone="brand">
              <CalendarDots size={12} aria-hidden />
              Business date {businessDate.data.currentDate}
            </Badge>
          )
        }
      />

      {p?.schedule && <HowTheDayCloses p={p} isOwner={isOwner} />}

      <Card className="mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">
          What closing {p?.date ?? 'the day'} will do
        </h2>
        {preview.isLoading || !p ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            <dl className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <Stat label="Rooms to charge" value={String(p.roomsToCharge)} />
              <Stat label="Charges to post" value={p.chargesToPost} />
              <Stat label="of which tax" value={p.taxesToPost} muted />
              <Stat
                label="No-shows"
                value={String(p.noShows.length)}
                alert={p.noShows.length > 0}
              />
              <Stat
                label={p.autoCheckout ? 'To check out' : 'Still in house'}
                value={String(p.overstays?.length ?? 0)}
                alert={(p.overstays?.length ?? 0) > 0}
              />
              <Stat
                label="Tills open"
                value={String(p.openTills?.length ?? 0)}
                alert={(p.openTills?.length ?? 0) > 0}
              />
            </dl>

            <div className="mb-4 flex flex-col gap-2">
              {(p.unarrived?.length ?? 0) > 0 && (
                <InlineAlert tone="warn" title="Due to arrive, never checked in">
                  The audit marks these as no-shows and puts the rest of each stay back on sale:{' '}
                  {p.unarrived!.map((u) => `${u.guestName} (${u.reference})`).join(', ')}. A guest
                  who turns up later can be reinstated from the reservation.
                </InlineAlert>
              )}
              {(p.overstays?.length ?? 0) > 0 &&
                (p.autoCheckout ? (
                  <InlineAlert tone="info" title="Past their departure, still checked in">
                    The audit checks these out and marks their rooms for cleaning; anything they
                    still owe stays on the bill:{' '}
                    {p.overstays!.map((o) => `${o.guestName} (${o.reference})`).join(', ')}. Extend
                    a stay first if the guest is staying on.
                  </InlineAlert>
                ) : (
                  <InlineAlert tone="warn" title="Past their departure, still checked in">
                    Automatic check-out is off, so these stay in house:{' '}
                    {p.overstays!.map((o) => `${o.guestName} (${o.reference})`).join(', ')}. Check
                    them out, or extend their stays.
                  </InlineAlert>
                ))}
              {(p.openTills?.length ?? 0) > 0 && (
                <InlineAlert tone="warn" title="Tills still open">
                  The audit closes {p.openTills!.map((t) => t.drawer).join(', ')} as uncounted.
                  Count and close them under Cashiering first if you can.
                </InlineAlert>
              )}
            </div>

            <p className="mb-3 text-sm text-ink-2">
              Running the audit posts the night&rsquo;s room charges, marks any no-shows
              {p.autoCheckout ? ', checks out stays past their departure' : ''}, closes every till
              still open, and moves the business date to{' '}
              <span className="font-semibold text-ink">{p.nextDate}</span>.
            </p>

            <Button
              onClick={() => setConfirming(true)}
              disabled={!propertyId || !isOwner}
              loading={run.isPending}
              title={isOwner ? undefined : 'Only the owner can run the night audit'}
            >
              <MoonStars size={15} aria-hidden />
              {p.schedule?.mode === 'auto' ? 'Close the day now' : 'Run night audit'}
            </Button>
            {!isOwner && (
              <p className="mt-2 text-xs text-ink-3">Only the owner can run the night audit.</p>
            )}
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title={`Close ${p.date}?`}
              description={`Room charges are posted, no-shows marked${p.autoCheckout && (p.overstays?.length ?? 0) > 0 ? `, ${p.overstays!.length} overdue stay${p.overstays!.length === 1 ? '' : 's'} checked out` : ''} and open tills closed uncounted. The business date moves to ${p.nextDate}; this cannot be undone.`}
              confirmLabel="Close the day"
              cancelLabel="Not yet"
              onConfirm={() => run.mutate()}
            />
          </>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-ink">Audit log</h2>
      {log.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (log.data ?? []).length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">No audits have been run yet.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                <th className="px-4 py-3">Closed</th>
                <th className="px-4 py-3">Rolled to</th>
                <th className="px-4 py-3 text-right">Rooms</th>
                <th className="px-4 py-3 text-right">Posted</th>
                <th className="px-4 py-3 text-right">No-shows</th>
                <th className="px-4 py-3 text-right">Checked out</th>
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
                      r.noShows > 0 ? 'text-closed-ink' : 'text-ink-3',
                    )}
                  >
                    {r.noShows}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-3">
                    {r.summary?.checkedOutAutomatically?.length ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-3">
                    {r.drawersClosed}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">
                    {r.trigger === 'auto' ? (
                      <Badge tone="info" dot={false}>
                        <Robot size={12} aria-hidden /> Automatic
                      </Badge>
                    ) : (
                      <>
                        {r.runBy ?? 'system'}
                        {r.runFromIp && <span className="ml-1 font-mono">({r.runFromIp})</span>}
                      </>
                    )}
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

/** The two automations and how they are set, with the way to change them. */
function HowTheDayCloses({ p, isOwner }: { p: AuditPreview; isOwner: boolean }) {
  const auto = p.schedule!.mode === 'auto';
  const dueAt = p.schedule!.dueAt?.replace('T', ' at ');
  return (
    <Card className="mb-4 grid gap-3 p-4 md:grid-cols-2">
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-brand-soft p-2 text-brand-ink">
          <ClockClockwise size={18} aria-hidden />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink">
            {auto
              ? `The day closes by itself at ${p.schedule!.time}`
              : 'The day closes when you run it'}
          </p>
          <p className="text-ink-2">
            {auto
              ? `${p.date} closes on ${dueAt}, hotel time. You can close it earlier here.`
              : 'Nothing is posted or rolled forward until the owner runs the audit.'}
          </p>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <span className="rounded-lg bg-brand-soft p-2 text-brand-ink">
          {p.autoCheckout ? (
            <DoorOpen size={18} aria-hidden />
          ) : (
            <UserMinus size={18} aria-hidden />
          )}
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink">
            {p.autoCheckout
              ? 'Overdue stays check out automatically'
              : 'Overdue stays wait for the desk'}
          </p>
          <p className="text-ink-2">
            {p.autoCheckout
              ? 'A guest still checked in after their departure day is checked out, and the room is marked for cleaning.'
              : 'Guests past their departure stay checked in until someone checks them out.'}
          </p>
        </div>
      </div>
      {isOwner && (
        <Link
          href={SETTINGS_HREF}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink hover:underline md:col-span-2"
        >
          <CashRegister size={14} aria-hidden /> Change how the day closes
        </Link>
      )}
    </Card>
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
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</dt>
      <dd
        className={cn(
          'mt-1 font-mono text-lg font-bold tabular-nums',
          alert ? 'text-closed-ink' : muted ? 'text-ink-3' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
