'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, SegmentedControl, Skeleton } from '@yohobed/ui';
import { formatDate } from '@yohobed/locale';
import { listInvoices, type InvoiceKind } from '@/lib/api';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'tax_invoice', label: 'Tax invoices' },
  { value: 'credit_note', label: 'Credit notes' },
  { value: 'proforma', label: 'Pro-formas' },
] as const;

/** The documents this property has issued, newest first — the accountant's list. */
export function RecentInvoices({ propertyId }: { propertyId: string | undefined }) {
  const [kind, setKind] = React.useState<(typeof FILTERS)[number]['value']>('all');
  const invoices = useQuery({
    queryKey: ['invoices', 'property', propertyId, kind],
    queryFn: () =>
      listInvoices({
        ...(propertyId ? { propertyId } : {}),
        ...(kind === 'all' ? {} : { kind: kind as InvoiceKind }),
      }),
    enabled: Boolean(propertyId),
  });

  return (
    <Card className="mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
          Invoices &amp; credit notes
        </div>
        <SegmentedControl
          aria-label="Document kind"
          value={kind}
          onChange={setKind}
          options={FILTERS}
        />
      </div>

      {invoices.isLoading ? (
        <Skeleton className="mt-4 h-40 w-full" />
      ) : invoices.data?.length ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="py-2">Number</th>
                <th className="py-2">Date</th>
                <th className="py-2">Billed to</th>
                <th className="py-2">Booking</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.slice(0, 50).map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/app/invoices/${d.id}`}
                      className="font-mono text-ink underline-offset-2 hover:underline"
                    >
                      {d.number}
                    </Link>
                    {d.creditedAt && (
                      <Badge tone="closed" dot={false} className="ml-2">
                        credited
                      </Badge>
                    )}
                  </td>
                  <td className="py-2 text-xs text-ink-2">
                    {formatDate(d.invoiceDate ?? d.issuedAt.slice(0, 10))}
                  </td>
                  <td className="py-2 text-ink-2">{d.payerName ?? '—'}</td>
                  <td className="py-2 font-mono text-xs text-ink-3">{d.bookingReference ?? '—'}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-ink">
                    {d.currency} {Number(d.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-3">Nothing issued yet.</p>
      )}
    </Card>
  );
}
