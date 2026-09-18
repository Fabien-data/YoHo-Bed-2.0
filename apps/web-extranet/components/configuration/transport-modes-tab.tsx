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
  Sheet,
  SheetContent,
  Switch,
  toast,
  type ColumnDef,
} from '@yohobed/ui';
import {
  createTransportMode,
  listTransportModes,
  updateTransportMode,
  type TransportMode,
} from '@/lib/api';
import { queryKeys } from '@/lib/queries';
import { ActiveBadge, SettingRow, errorMessage } from './shared';

interface Draft {
  id?: string;
  code: string;
  name: string;
  defaultPrice: string;
  sort: string;
  active: boolean;
}

const EMPTY: Draft = { code: '', name: '', defaultPrice: '', sort: '', active: true };

export const TRANSPORT_MODES_KEY = ['config', 'transport-modes'] as const;

/**
 * Yanolja's Transportation Mode list: the vehicles a pick-up or drop-off can be booked in, each with
 * the price the desk starts from. Deactivated rather than deleted — past transfers still name them.
 */
export function TransportModesTab({ canEdit, currency }: { canEdit: boolean; currency: string }) {
  const qc = useQueryClient();
  const modes = useQuery({ queryKey: TRANSPORT_MODES_KEY, queryFn: listTransportModes });
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        name: d.name.trim(),
        defaultPrice: Number(d.defaultPrice) || 0,
        ...(d.sort.trim() ? { sort: Number(d.sort) } : {}),
      };
      return d.id
        ? updateTransportMode(d.id, { ...body, active: d.active })
        : createTransportMode({ ...body, code: d.code.trim() });
    },
    onSuccess: (_, d) => {
      toast.success(d.id ? 'Transport mode updated' : 'Transport mode added');
      setDraft(null);
      qc.invalidateQueries({ queryKey: TRANSPORT_MODES_KEY });
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<TransportMode>[] = [
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => <span className="font-medium text-ink">{row.original.name}</span>,
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: ({ row }) => <span className="font-mono text-xs text-ink-2">{row.original.code}</span>,
    },
    {
      header: `Default price (${currency})`,
      accessorKey: 'defaultPrice',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-ink">
          {Number(row.original.defaultPrice).toFixed(2)}
        </span>
      ),
    },
    {
      header: 'Status',
      accessorKey: 'active',
      cell: ({ row }) => <ActiveBadge active={row.original.active} />,
    },
  ];

  const open = (m: TransportMode) =>
    setDraft({
      id: m.id,
      code: m.code,
      name: m.name,
      defaultPrice: Number(m.defaultPrice) ? m.defaultPrice : '',
      sort: String(m.sort),
      active: m.active,
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-ink-3">
          Vehicles for airport pick-ups and drop-offs. A transfer is charged to the guest when it is
          marked done.
        </p>
        {canEdit && (
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={16} />
            Add transport mode
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataGrid
          data={modes.data ?? []}
          columns={columns}
          loading={modes.isLoading}
          rowKey={(r) => r.id}
          onRowClick={open}
          emptyTitle="No transport modes yet"
          emptyDescription="Add the cars, vans and tuk-tuks your hotel sends to the airport."
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(o) => !o && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? draft.name || 'Transport mode' : 'New transport mode'}
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
                <Field label="Code" hint={draft.id ? 'Codes cannot change' : 'e.g. VAN'}>
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
                    maxLength={60}
                    placeholder="e.g. Van (up to 8)"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={`Default price (${currency})`}
                  hint="Tax inclusive. The desk can change it on each transfer."
                >
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
                <Field label="Order" hint="Lower comes first in lists">
                  <Input
                    type="number"
                    min={0}
                    value={draft.sort}
                    onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
                  />
                </Field>
              </div>
              {draft.id && (
                <div className="rounded-lg border border-line px-3">
                  <SettingRow title="Active">
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
