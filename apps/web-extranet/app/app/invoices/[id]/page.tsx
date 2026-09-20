'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Receipt } from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Field,
  InlineAlert,
  Input,
  Skeleton,
  Dialog,
  DialogContent,
  toast,
} from '@yohobed/ui';
import { ApiError, createCreditNote, getInvoice } from '@/lib/api';
import { PrintInvoice } from '@/components/invoices/print-invoice';

/** One issued document, as it prints — and the one correction it allows: a credit note. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [crediting, setCrediting] = React.useState(false);
  const [reason, setReason] = React.useState('');

  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id) });

  const credit = useMutation({
    mutationFn: () => createCreditNote(id, reason.trim()),
    onSuccess: (note) => {
      toast.success(`Credit note ${note.number} issued`);
      setCrediting(false);
      setReason('');
      qc.invalidateQueries({ queryKey: ['invoice'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['folio'] });
      router.push(`/app/invoices/${note.id}`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'The credit note could not be issued.'),
  });

  if (invoice.isLoading) return <Skeleton className="h-[40rem] w-full" />;
  if (!invoice.data) {
    return <InlineAlert tone="error">That document could not be found.</InlineAlert>;
  }
  const doc = invoice.data;
  const creditable = ['tax_invoice', 'invoice', 'bill'].includes(doc.kind) && !doc.creditedAt;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="rounded-lg p-1.5 text-ink-2 transition duration-1 hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{doc.number}</h1>
        <Badge tone={doc.creditedAt ? 'closed' : 'avail'} dot={false}>
          {doc.creditedAt ? 'Credited' : doc.title}
        </Badge>
        <div className="flex-1" />
        {creditable && (
          <Button variant="outline" onClick={() => setCrediting(true)}>
            <Receipt size={16} /> Credit note
          </Button>
        )}
      </div>

      <div className="rounded-xl border border-line bg-surface p-4 shadow-card print:border-0 print:shadow-none">
        <PrintInvoice invoice={doc} />
      </div>

      <Dialog open={crediting} onOpenChange={setCrediting}>
        <DialogContent title={`Credit note against ${doc.number}`} className="max-w-lg">
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (reason.trim().length >= 3) credit.mutate();
            }}
          >
            <p className="text-sm text-ink-2">
              An issued document is never changed or deleted. A credit note cancels it, and the bill
              can then be invoiced again.
            </p>
            <Field label="Reason" htmlFor="credit-reason" required>
              <Input
                id="credit-reason"
                value={reason}
                maxLength={300}
                placeholder="e.g. Company name and TIN were wrong"
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCrediting(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={credit.isPending} disabled={reason.trim().length < 3}>
                Issue credit note
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
