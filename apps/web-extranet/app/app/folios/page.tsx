'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Receipt } from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Sheet,
  SheetContent,
  Skeleton,
  type Tone,
} from '@yohobed/ui';
import { getUnsettledFolios } from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { FolioPanel } from '@/components/folio/folio-panel';

const STATUS_TONE: Record<string, Tone> = {
  CheckedIn: 'avail',
  CheckedOut: 'closed',
  Approved: 'brand',
  Pending: 'low',
};

/**
 * Every stay that still owes money.
 *
 * Ordered in-house first: a balance on a guest still in the building can be collected, while one
 * on a departed guest is already a debt. That ordering is the whole point of the screen.
 */
export default function UnsettledFoliosPage() {
  const { propertyId } = useActiveProperty();
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  const folios = useQuery({
    queryKey: ['folios', 'unsettled', propertyId],
    queryFn: () => getUnsettledFolios(propertyId!),
    enabled: !!propertyId,
  });

  const rows = folios.data ?? [];
  // Currency is per-folio (properties differ in base currency), so the total must be grouped —
  // summing raw numbers and stamping the first row's currency would fabricate a figure.
  const outstanding = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.balance));
    return [...totals.entries()].map(([c, v]) => `${c} ${v.toFixed(2)}`).join(' + ');
  }, [rows]);

  return (
    <div>
      <PageHeader
        eyebrow="Cashiering"
        title="Unsettled folios"
        actions={
          rows.length > 0 ? <Badge tone="closed">{outstanding} outstanding</Badge> : undefined
        }
      />

      {folios.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">Every bill is settled.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-4 py-3">Guest</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3">Room</th>
                <th className="px-4 py-3">Departure</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Charges</th>
                <th className="px-4 py-3 text-right">Paid</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.folioId}
                  className="border-b border-line last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 font-semibold text-ink">
                      {r.vip && <Crown size={12} className="text-low-ink" />}
                      {r.guestName}
                    </span>
                    {r.window > 1 && <span className="text-xs text-ink-3">{r.label}</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-2">{r.reference}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-2">
                    {r.roomCodes.length > 0 ? r.roomCodes.join(', ') : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-2">{r.checkout}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[r.status] ?? 'muted'}>{r.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-2">
                    {Number(r.charges).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-2">
                    {Number(r.paid).toFixed(2)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold tabular-nums text-closed-ink">
                    {r.currency} {Number(r.balance).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpenFor(r.bookingId)}>
                      <Receipt size={14} />
                      Bill
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Sheet open={openFor !== null} onOpenChange={(o) => !o && setOpenFor(null)}>
        <SheetContent title="Guest bill" wide>
          {openFor && <FolioPanel bookingId={openFor} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
