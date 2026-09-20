'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  Field,
  Input,
  InlineAlert,
  Skeleton,
  toast,
} from '@yohobed/ui';
import { getDocumentSequences, setDocumentSequence } from '@/lib/api';
import { errorMessage } from './shared';

const LABEL: Record<string, string> = {
  tax_invoice: 'Tax invoice',
  invoice: 'Invoice',
  bill: 'Bill (no VAT)',
  credit_note: 'Credit note',
  proforma: 'Pro-forma',
  receipt: 'Payment receipt',
};

export const DOCUMENT_SERIES_KEY = (propertyId: string) =>
  ['config', 'document-sequences', propertyId] as const;

/**
 * The property's document numbering: what the next tax invoice, bill, credit note, pro-forma and
 * receipt will be numbered. A series only ever moves forward — a hotel coming from another system
 * continues its numbering here, and nothing can hand out a number twice.
 */
export function DocumentSeries({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const series = useQuery({
    queryKey: DOCUMENT_SERIES_KEY(propertyId),
    queryFn: () => getDocumentSequences(propertyId),
  });
  const [editing, setEditing] = React.useState<{ docType: string; period: string } | null>(null);
  const [value, setValue] = React.useState('');

  const save = useMutation({
    mutationFn: () =>
      setDocumentSequence(propertyId, {
        docType: editing!.docType,
        period: editing!.period,
        nextValue: Number(value),
      }),
    onSuccess: () => {
      toast.success('Numbering updated');
      setEditing(null);
      qc.invalidateQueries({ queryKey: DOCUMENT_SERIES_KEY(propertyId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Card className="mt-4 p-5">
      <h2 className="text-sm font-semibold text-ink">Document numbering</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-3">
        The next number of each series. Numbers are gap-free and unique to this property, and a
        series can only be moved forward.
      </p>

      {series.isLoading ? (
        <Skeleton className="mt-4 h-32 w-full" />
      ) : series.data ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[30rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="py-2">Series</th>
                <th className="py-2">Period</th>
                <th className="py-2">Next number</th>
                {canEdit && <th className="w-24 py-2" />}
              </tr>
            </thead>
            <tbody>
              {series.data.next.map((n) => {
                const current =
                  series.data.series.find((s) => s.docType === n.docType && s.period === n.period)
                    ?.nextValue ?? 1;
                return (
                  <tr
                    key={`${n.docType}-${n.period}`}
                    className="border-b border-line last:border-0"
                  >
                    <td className="py-2 text-ink">{LABEL[n.docType] ?? n.docType}</td>
                    <td className="py-2 font-mono text-xs text-ink-2">{n.period}</td>
                    <td className="py-2 font-mono text-ink">{n.number}</td>
                    {canEdit && (
                      <td className="py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing({ docType: n.docType, period: n.period });
                            setValue(String(current));
                          }}
                        >
                          Set
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {series.data.profile === 'lk_vat' && (
            <p className="mt-3 text-xs text-ink-3">
              Sri Lankan tax invoices are numbered to Gazette 2481/22 — year, month, branch code and
              the month&apos;s running number — and carry your TIN.
            </p>
          )}
        </div>
      ) : (
        <InlineAlert tone="error">The numbering could not be loaded.</InlineAlert>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent title="Set the next number" className="max-w-md">
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (Number(value) >= 1) save.mutate();
            }}
          >
            <p className="text-sm text-ink-2">
              Use this to continue the numbering of the system you came from. It can only go
              forward: a number already on a document must never be handed out again.
            </p>
            <Field label="Next number" htmlFor="seq-next" required>
              <Input
                id="seq-next"
                type="number"
                min={1}
                className="font-mono"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending} disabled={!(Number(value) >= 1)}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
