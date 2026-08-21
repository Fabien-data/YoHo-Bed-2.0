'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Receipt } from 'lucide-react';
import { Badge, Button, Card, Sheet, SheetContent, Skeleton, type Tone } from '@yohobed/ui';
import { getUnsettledFolios } from '@/lib/api';
import { useProperties } from '@/lib/queries';
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
  const { data: properties } = useProperties();
  const propertyId = properties?.[0]?.id;
  const [openFor, setOpenFor] = React.useState<string | null>(null);

  const folios = useQuery({
    queryKey: ['folios', 'unsettled', propertyId],
    queryFn: () => getUnsettledFolios(propertyId!),
    enabled: !!propertyId,
  });

  const rows = folios.data ?? [];
  const outstanding = rows.reduce((s, r) => s + Number(r.balance), 0);

  return (
    <div>
      <div className="mb-4">
        <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
          Cashiering
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Unsettled folios</h1>
          {rows.length > 0 && (
            <Badge tone="closed">
              {rows[0]!.currency} {outstanding.toFixed(2)} outstanding
            </Badge>
          )}
        </div>
      </div>

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
                      {r.vip && <Crown size={12} className="text-[var(--low-ink)]" />}
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
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-[var(--closed-ink)]">
                    {Number(r.balance).toFixed(2)}
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
