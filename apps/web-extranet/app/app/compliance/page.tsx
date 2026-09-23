'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, WarningCircle } from '@phosphor-icons/react';
import { countryName } from '@yohobed/locale';
import {
  Badge,
  Button,
  Card,
  DataGrid,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  InlineAlert,
  PageHeader,
  toast,
  type ColumnDef,
} from '@yohobed/ui';
import { describeError, getFormCTracker, submitFormC, type FormCRow } from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';

function due(row: FormCRow): { label: string; tone: 'closed' | 'low' | 'avail' | 'muted' } {
  if (row.submitted) return { label: 'Filed', tone: 'avail' };
  if (row.overdue) return { label: 'Overdue', tone: 'closed' };
  const h = row.hoursLeft ?? 0;
  return {
    label: h >= 1 ? `${Math.floor(h)} h left` : `${Math.max(1, Math.round(h * 60))} min left`,
    tone: h < 6 ? 'low' : 'muted',
  };
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * India's Form C (Development Phase 02, Sprint 7): every foreign guest must be registered on the
 * Bureau of Immigration portal within 24 hours of arrival. This is the desk's work list — who is
 * due, how long is left — and the record of each filing's reference.
 */
export default function FormCPage() {
  const qc = useQueryClient();
  const { property } = useActiveProperty();
  const propertyId = property?.id;
  const tracker = useQuery({
    queryKey: ['form-c', propertyId],
    queryFn: () => getFormCTracker(propertyId!),
    enabled: Boolean(propertyId),
    // The countdown moves; refresh it every minute.
    refetchInterval: 60_000,
  });
  const [filing, setFiling] = React.useState<FormCRow | null>(null);
  const [reference, setReference] = React.useState('');

  const file = useMutation({
    mutationFn: () => submitFormC(filing!.bookingId, reference.trim()),
    onSuccess: () => {
      toast.success(`Form C recorded for ${filing!.guestName}`);
      setFiling(null);
      setReference('');
      qc.invalidateQueries({ queryKey: ['form-c'] });
    },
  });

  const columns: ColumnDef<FormCRow>[] = [
    {
      header: 'Guest',
      accessorKey: 'guestName',
      cell: ({ row }) => (
        <div>
          <span className="font-medium text-ink">{row.original.guestName}</span>
          <span className="block text-xs text-ink-3">
            {row.original.nationalityCode ? countryName(row.original.nationalityCode) : 'Foreign'} ·{' '}
            <span className="font-mono">{row.original.reference}</span>
          </span>
        </div>
      ),
    },
    {
      header: 'Arrived',
      accessorKey: 'checkedInAt',
      cell: ({ row }) => <span className="text-ink-2">{when(row.original.checkedInAt)}</span>,
    },
    {
      header: 'Due by',
      accessorKey: 'dueAt',
      cell: ({ row }) => {
        const d = due(row.original);
        return (
          <div className="flex items-center gap-2">
            <span className="text-ink-2">{when(row.original.dueAt)}</span>
            <Badge tone={d.tone}>{d.label}</Badge>
          </div>
        );
      },
    },
    {
      header: 'Form C',
      accessorKey: 'formCReference',
      cell: ({ row }) =>
        row.original.submitted ? (
          <span className="font-mono text-xs text-ink-2">{row.original.formCReference}</span>
        ) : (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              file.reset();
              setFiling(row.original);
            }}
          >
            Record filing
          </Button>
        ),
    },
  ];

  const data = tracker.data;
  return (
    <div>
      <PageHeader
        eyebrow="Front desk"
        title="Form C"
        description="Foreign guests must be registered with the Bureau of Immigration within 24 hours of arrival. File each one on the Form C portal, then record its reference here."
      />

      {data && !data.required ? (
        <EmptyState
          title="Form C is for hotels in India"
          description={`${property?.name ?? 'This property'} is in ${countryName(property?.countryCode ?? '')}.`}
        />
      ) : (
        <>
          {data && (data.overdue ?? 0) > 0 && (
            <InlineAlert tone="error" className="mb-4">
              <p className="flex items-center gap-2 font-medium">
                <WarningCircle size={16} /> {data.overdue} Form C filing
                {data.overdue === 1 ? ' is' : 's are'} overdue.
              </p>
            </InlineAlert>
          )}
          {data && (data.pending ?? 0) === 0 && data.rows.length > 0 && (
            <p className="mb-3 flex items-center gap-2 text-sm text-avail-ink">
              <CheckCircle size={16} /> Every foreign guest is registered.
            </p>
          )}
          <Card className="overflow-hidden">
            <DataGrid
              data={data?.rows ?? []}
              columns={columns}
              loading={tracker.isLoading}
              rowKey={(r) => r.bookingId}
              emptyTitle="No foreign guests in the last two weeks"
              emptyDescription="Guests from abroad appear here when they check in, with the time their Form C is due."
            />
          </Card>
          {tracker.isError && (
            <InlineAlert tone="error" className="mt-3">
              {describeError(tracker.error)}
            </InlineAlert>
          )}
        </>
      )}

      <Dialog open={filing !== null} onOpenChange={(o) => !o && setFiling(null)}>
        <DialogContent
          title={filing ? `Form C for ${filing.guestName}` : 'Form C'}
          className="max-w-md"
        >
          <form
            className="flex flex-col gap-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (reference.trim().length >= 3) file.mutate();
            }}
          >
            <p className="flex items-center gap-2 text-sm text-ink-2">
              <Clock size={15} /> Due by {filing ? when(filing.dueAt) : ''}
            </p>
            <Field label="Form C reference" hint="The application number the portal gives you">
              <Input
                autoFocus
                value={reference}
                maxLength={60}
                className="font-mono"
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
            {file.isError && <InlineAlert tone="error">{describeError(file.error)}</InlineAlert>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFiling(null)}>
                Not now
              </Button>
              <Button type="submit" loading={file.isPending} disabled={reference.trim().length < 3}>
                Record filing
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
