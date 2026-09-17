'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import { SUPPORTED_CURRENCIES } from '@yohobed/domain';
import {
  Badge,
  Button,
  Card,
  DataGrid,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Switch,
  toast,
  type ColumnDef,
} from '@yohobed/ui';
import {
  createPaymentMethod,
  updatePaymentMethod,
  type PaymentCategory,
  type PaymentMethod,
  type Property,
} from '@/lib/api';
import { queryKeys, usePaymentMethods } from '@/lib/queries';
import { ActiveBadge, NONE, PAYMENT_CATEGORY_LABELS, SettingRow, errorMessage } from './shared';

interface Draft {
  id?: string;
  code: string;
  name: string;
  shortName: string;
  category: PaymentCategory;
  currency: string;
  propertyId: string;
  requiresReference: boolean;
  isDefaultCash: boolean;
  isGuestAdvance: boolean;
  sort: string;
  active: boolean;
}

const EMPTY: Draft = {
  code: '',
  name: '',
  shortName: '',
  category: 'card',
  currency: NONE,
  propertyId: NONE,
  requiresReference: false,
  isDefaultCash: false,
  isGuestAdvance: false,
  sort: '',
  active: true,
};

function toDraft(m: PaymentMethod): Draft {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    shortName: m.shortName,
    category: m.category,
    currency: m.currency ?? NONE,
    propertyId: m.propertyId ?? NONE,
    requiresReference: m.requiresReference,
    isDefaultCash: m.isDefaultCash,
    isGuestAdvance: m.isGuestAdvance,
    sort: String(m.sort),
    active: m.active,
  };
}

/**
 * The Payment Mode dropdown. Payments are recorded, never processed here: the category decides
 * what the money does (cash goes into a drawer, city ledger bills an account), and a transfer or
 * QR payment asks for its reference so it can be traced later.
 */
export function PaymentMethodsTab({
  canEdit,
  properties,
}: {
  canEdit: boolean;
  properties: Property[];
}) {
  const qc = useQueryClient();
  const methods = usePaymentMethods();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const propertyName = (id: string | null) =>
    id ? (properties.find((p) => p.id === id)?.name ?? 'One property') : 'All properties';

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        name: d.name.trim(),
        shortName: d.shortName.trim() || d.name.trim().slice(0, 24),
        category: d.category,
        currency: d.currency === NONE ? null : d.currency,
        propertyId: d.propertyId === NONE ? null : d.propertyId,
        requiresReference: d.requiresReference,
        isDefaultCash: d.category === 'cash' && d.isDefaultCash,
        isGuestAdvance: d.isGuestAdvance,
        ...(d.sort.trim() !== '' && { sort: Number(d.sort) }),
      };
      return d.id
        ? updatePaymentMethod(d.id, { ...body, active: d.active })
        : createPaymentMethod({ ...body, code: d.code.trim() });
    },
    onSuccess: (_, d) => {
      toast.success(d.id ? 'Payment method updated' : 'Payment method added');
      setDraft(null);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<PaymentMethod>[] = [
    {
      header: 'Method',
      accessorKey: 'name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{row.original.name}</span>
          {row.original.isDefaultCash && <Badge tone="brand">Default cash</Badge>}
        </div>
      ),
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: ({ row }) => <span className="font-mono text-xs text-ink-2">{row.original.code}</span>,
    },
    {
      header: 'Type',
      accessorKey: 'category',
      cell: ({ row }) => PAYMENT_CATEGORY_LABELS[row.original.category],
    },
    {
      header: 'Reference',
      accessorKey: 'requiresReference',
      cell: ({ row }) =>
        row.original.requiresReference ? (
          <span className="text-ink-2">Required</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      header: 'Currency',
      accessorKey: 'currency',
      cell: ({ row }) =>
        row.original.currency ? (
          <span className="font-mono text-xs text-ink-2">{row.original.currency}</span>
        ) : (
          <span className="text-ink-3">Property&rsquo;s</span>
        ),
    },
    {
      header: 'Available at',
      id: 'where',
      cell: ({ row }) => (
        <span className="text-ink-2">{propertyName(row.original.propertyId)}</span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'active',
      cell: ({ row }) => <ActiveBadge active={row.original.active} />,
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-3">
          Offered in the Payment Mode list when a payment is recorded. Cash methods count into the
          cash drawer; City Ledger bills a company or travel agent.
        </p>
        {canEdit && (
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={16} />
            Add method
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataGrid
          data={methods.data ?? []}
          columns={columns}
          loading={methods.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDraft(toDraft(r))}
          emptyTitle="No payment methods"
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? draft.name || 'Payment method' : 'New payment method'}
            description="How a guest can pay at this hotel."
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                {canEdit && (
                  <Button
                    loading={save.isPending}
                    disabled={!draft.name.trim() || (!draft.id && !draft.code.trim())}
                    onClick={() => save.mutate(draft)}
                  >
                    Save
                  </Button>
                )}
              </div>
            }
          >
            <fieldset disabled={!canEdit} className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Code" hint={draft.id ? 'Codes cannot change' : 'e.g. LANKAQR'}>
                  <Input
                    value={draft.code}
                    maxLength={16}
                    disabled={Boolean(draft.id)}
                    className="font-mono uppercase"
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                </Field>
                <Field label="Name" className="col-span-2">
                  <Input
                    value={draft.name}
                    maxLength={80}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Short name" hint="Shown on receipts">
                  <Input
                    value={draft.shortName}
                    maxLength={24}
                    onChange={(e) => setDraft({ ...draft, shortName: e.target.value })}
                  />
                </Field>
                <Field label="Type" className="col-span-2">
                  <Select
                    value={draft.category}
                    onValueChange={(v) =>
                      setDraft({
                        ...draft,
                        category: v as PaymentCategory,
                        isDefaultCash: v === 'cash' ? draft.isDefaultCash : false,
                      })
                    }
                  >
                    <SelectTrigger aria-label="Type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PAYMENT_CATEGORY_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Available at">
                  <Select
                    value={draft.propertyId}
                    onValueChange={(v) => setDraft({ ...draft, propertyId: v })}
                  >
                    <SelectTrigger aria-label="Available at">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>All properties</SelectItem>
                      {properties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Currency" hint="For foreign cash, e.g. Cash (USD)">
                  <Select
                    value={draft.currency}
                    onValueChange={(v) => setDraft({ ...draft, currency: v })}
                  >
                    <SelectTrigger aria-label="Currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Property currency</SelectItem>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <Field label="Sort order" className="w-32">
                <Input
                  type="number"
                  min={0}
                  className="font-mono tabular-nums"
                  value={draft.sort}
                  onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
                />
              </Field>

              <div className="rounded-lg border border-line px-3">
                <SettingRow
                  title="Reference number required"
                  description="Bank transfers, QR and online payments need their transaction reference to be traced."
                >
                  <Switch
                    aria-label="Reference number required"
                    checked={draft.requiresReference}
                    onCheckedChange={(v) => setDraft({ ...draft, requiresReference: v })}
                  />
                </SettingRow>
                {draft.category === 'cash' && (
                  <SettingRow
                    title="Default cash method"
                    description="Pre-selected when cash is taken. Only one method can be the default."
                  >
                    <Switch
                      aria-label="Default cash method"
                      checked={draft.isDefaultCash}
                      onCheckedChange={(v) => setDraft({ ...draft, isDefaultCash: v })}
                    />
                  </SettingRow>
                )}
                <SettingRow
                  title="Record as guest advance"
                  description="Money taken with this method before arrival is treated as a deposit."
                >
                  <Switch
                    aria-label="Record as guest advance"
                    checked={draft.isGuestAdvance}
                    onCheckedChange={(v) => setDraft({ ...draft, isGuestAdvance: v })}
                  />
                </SettingRow>
                {draft.id && (
                  <SettingRow title="Active">
                    <Switch
                      aria-label="Active"
                      checked={draft.active}
                      onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                    />
                  </SettingRow>
                )}
              </div>
            </fieldset>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
