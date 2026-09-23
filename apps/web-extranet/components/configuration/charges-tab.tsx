'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import {
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
  createChargeParticular,
  listChargeParticulars,
  updateChargeParticular,
  type ChargeParticular,
} from '@/lib/api';
import { ActiveBadge, SettingRow, errorMessage } from './shared';

const CATEGORIES = [
  { value: 'food', label: 'Food' },
  { value: 'beverage', label: 'Beverage' },
  { value: 'service', label: 'Service' },
  { value: 'room', label: 'Room' },
  { value: 'misc', label: 'Other' },
] as const;

interface Draft {
  id?: string;
  code: string;
  name: string;
  category: (typeof CATEGORIES)[number]['value'];
  defaultPrice: string;
  taxRatePct: string;
  taxInclusive: boolean;
  active: boolean;
}

const EMPTY: Draft = {
  code: '',
  name: '',
  category: 'food',
  defaultPrice: '',
  taxRatePct: '',
  taxInclusive: true,
  active: true,
};

export const CHARGES_KEY = ['charge-particulars'] as const;

/**
 * The charges the desk rings up (UX-2): a minibar, a laundry bag, an airport transfer, each with
 * the price and tax it is normally posted at.
 *
 * Setting them up here is what makes a charge one tap on the bill instead of a description, a
 * price and a quantity typed by hand every time. An item is deactivated rather than deleted —
 * bills it has already been posted to still name it.
 */
export function ChargesTab({ canEdit, currency }: { canEdit: boolean; currency: string }) {
  const qc = useQueryClient();
  const items = useQuery({ queryKey: CHARGES_KEY, queryFn: listChargeParticulars });
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        name: d.name.trim(),
        category: d.category,
        defaultPrice: Number(d.defaultPrice) || 0,
        taxRatePct: Number(d.taxRatePct) || 0,
        taxInclusive: d.taxInclusive,
      };
      return d.id
        ? updateChargeParticular(d.id, { ...body, active: d.active })
        : createChargeParticular({ ...body, code: d.code.trim().toUpperCase() });
    },
    onSuccess: (_, d) => {
      toast.success(d.id ? 'Charge updated' : 'Charge added');
      setDraft(null);
      qc.invalidateQueries({ queryKey: CHARGES_KEY });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<ChargeParticular>[] = [
    {
      header: 'Charge',
      accessorKey: 'name',
      cell: ({ row }) => <span className="font-medium text-ink">{row.original.name}</span>,
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: ({ row }) => <span className="font-mono text-xs text-ink-2">{row.original.code}</span>,
    },
    {
      header: `Price (${currency})`,
      accessorKey: 'defaultPrice',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-ink">
          {Number(row.original.defaultPrice).toFixed(2)}
        </span>
      ),
    },
    {
      header: 'Tax',
      accessorKey: 'taxRatePct',
      cell: ({ row }) => (
        <span className="text-ink-2">
          {Number(row.original.taxRatePct) > 0
            ? `${Number(row.original.taxRatePct)}% ${row.original.taxInclusive ? 'in the price' : 'on top'}`
            : 'None'}
        </span>
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
          What the desk can put on a guest&apos;s bill in one tap. The first eight appear as buttons
          on the bill, in this order.
        </p>
        {canEdit && (
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={16} />
            Add a charge
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataGrid
          data={items.data ?? []}
          columns={columns}
          loading={items.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(p) =>
            setDraft({
              id: p.id,
              code: p.code,
              name: p.name,
              category: p.category as Draft['category'],
              defaultPrice: Number(p.defaultPrice) ? p.defaultPrice : '',
              taxRatePct: Number(p.taxRatePct) ? String(Number(p.taxRatePct)) : '',
              taxInclusive: p.taxInclusive,
              active: p.active,
            })
          }
          emptyTitle="No charges set up yet"
          emptyDescription="Add the minibar, laundry and transfers your desk rings up most."
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? draft.name || 'Charge' : 'New charge'}
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
                <Field label="Code" hint={draft.id ? 'Codes cannot change' : 'e.g. MINIBAR'}>
                  <Input
                    value={draft.code}
                    maxLength={32}
                    disabled={Boolean(draft.id)}
                    className="font-mono uppercase"
                    onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                  />
                </Field>
                <Field label="Name" className="col-span-2">
                  <Input
                    value={draft.name}
                    maxLength={120}
                    placeholder="e.g. Minibar"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Price (${currency})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="font-mono"
                    value={draft.defaultPrice}
                    onChange={(e) => setDraft({ ...draft, defaultPrice: e.target.value })}
                  />
                </Field>
                <Field label="What kind">
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: v as Draft['category'] })}
                  >
                    <SelectTrigger aria-label="Kind of charge">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tax rate %" hint="Leave empty for an untaxed charge">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step="0.001"
                    className="font-mono"
                    value={draft.taxRatePct}
                    onChange={(e) => setDraft({ ...draft, taxRatePct: e.target.value })}
                  />
                </Field>
                <div className="rounded-lg border border-line px-3">
                  <SettingRow
                    title="Tax is in the price"
                    description="Off adds the tax on top when it is posted"
                  >
                    <Switch
                      aria-label="Tax is in the price"
                      checked={draft.taxInclusive}
                      onCheckedChange={(v) => setDraft({ ...draft, taxInclusive: v })}
                    />
                  </SettingRow>
                </div>
              </div>
              {draft.id && (
                <div className="rounded-lg border border-line px-3">
                  <SettingRow title="Active" description="Off keeps it off the bill from now on">
                    <Switch
                      aria-label="Active"
                      checked={draft.active}
                      onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                    />
                  </SettingRow>
                </div>
              )}
            </fieldset>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
