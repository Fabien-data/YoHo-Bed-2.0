'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import { countryList, countryName, formatPhone } from '@yohobed/locale';
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
import { createSalesPerson, updateSalesPerson, type SalesPerson } from '@/lib/api';
import { queryKeys, useSalesPersons } from '@/lib/queries';
import { ActiveBadge, NONE, SettingRow, errorMessage } from './shared';

interface Draft {
  id?: string;
  code: string;
  name: string;
  email: string;
  mobile: string;
  phone: string;
  countryCode: string;
  active: boolean;
}

const EMPTY: Draft = {
  code: '',
  name: '',
  email: '',
  mobile: '',
  phone: '',
  countryCode: NONE,
  active: true,
};

/**
 * Yanolja's Salesperson database: who brought the business in, so a reservation can be credited
 * to them. Deactivated rather than deleted, because past reservations still name them.
 */
export function SalesPersonsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const people = useSalesPersons();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const countries = React.useMemo(() => countryList(), []);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        name: d.name.trim(),
        email: d.email.trim() || null,
        mobile: d.mobile.trim() || null,
        phone: d.phone.trim() || null,
        countryCode: d.countryCode === NONE ? null : d.countryCode,
      };
      return d.id
        ? updateSalesPerson(d.id, { ...body, active: d.active })
        : createSalesPerson({ ...body, code: d.code.trim() });
    },
    onSuccess: (_, d) => {
      toast.success(d.id ? 'Sales person updated' : 'Sales person added');
      setDraft(null);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<SalesPerson>[] = [
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
      header: 'Email',
      accessorKey: 'email',
      cell: ({ row }) => row.original.email ?? <span className="text-ink-3">—</span>,
    },
    {
      header: 'Mobile',
      accessorKey: 'mobile',
      cell: ({ row }) =>
        row.original.mobile ? (
          <span className="font-mono text-xs">{formatPhone(row.original.mobile)}</span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      header: 'Country',
      accessorKey: 'countryCode',
      cell: ({ row }) => (row.original.countryCode ? countryName(row.original.countryCode) : '—'),
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
          Credit a reservation to the person who brought it in.
        </p>
        {canEdit && (
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={16} />
            Add sales person
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataGrid
          data={people.data ?? []}
          columns={columns}
          loading={people.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) =>
            setDraft({
              id: r.id,
              code: r.code,
              name: r.name,
              email: r.email ?? '',
              mobile: r.mobile ?? '',
              phone: r.phone ?? '',
              countryCode: r.countryCode ?? NONE,
              active: r.active,
            })
          }
          emptyTitle="No sales persons yet"
          emptyDescription="Add the people who bring in corporate, group and agent business."
          emptyAction={
            canEdit ? (
              <Button variant="secondary" onClick={() => setDraft({ ...EMPTY })}>
                <Plus size={16} />
                Add sales person
              </Button>
            ) : undefined
          }
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? draft.name || 'Sales person' : 'New sales person'}
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
                <Field label="Code" hint={draft.id ? 'Codes cannot change' : 'e.g. SP-01'}>
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
                    maxLength={160}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Email">
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mobile" hint="With country code, e.g. +94 77 123 4567">
                  <Input
                    type="tel"
                    value={draft.mobile}
                    onChange={(e) => setDraft({ ...draft, mobile: e.target.value })}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Country">
                <Select
                  value={draft.countryCode}
                  onValueChange={(v) => setDraft({ ...draft, countryCode: v })}
                >
                  <SelectTrigger aria-label="Country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {countries.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
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
