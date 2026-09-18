'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import {
  Button,
  Card,
  CountedChips,
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
  TagChip,
  TagColorPicker,
  toast,
  type ColumnDef,
} from '@yohobed/ui';
import {
  createBusinessSource,
  updateBusinessSource,
  type BusinessSource,
  type CommissionPlan,
  type SourceCategory,
} from '@/lib/api';
import { queryKeys, useBusinessSources, useMarketSegments } from '@/lib/queries';
import {
  ActiveBadge,
  COMMISSION_PLAN_LABELS,
  NONE,
  SOURCE_CATEGORY_LABELS,
  SettingRow,
  errorMessage,
} from './shared';

type Filter = 'all' | SourceCategory;

interface Draft {
  id?: string;
  shortCode: string;
  name: string;
  category: SourceCategory;
  palette: string;
  defaultMarketSegmentId: string;
  commissionPlan: CommissionPlan;
  commissionValue: string;
  registrationNo: string;
  collectsTourismTax: boolean;
  sort: string;
  active: boolean;
}

const EMPTY: Draft = {
  shortCode: '',
  name: '',
  category: 'direct',
  palette: 'slate',
  defaultMarketSegmentId: NONE,
  commissionPlan: 'none',
  commissionValue: '0',
  registrationNo: '',
  collectsTourismTax: false,
  sort: '',
  active: true,
};

function toDraft(s: BusinessSource): Draft {
  return {
    id: s.id,
    shortCode: s.shortCode,
    name: s.name,
    category: s.category,
    palette: s.palette,
    defaultMarketSegmentId: s.defaultMarketSegmentId ?? NONE,
    commissionPlan: s.commissionPlan,
    commissionValue: String(Number(s.commissionValue)),
    registrationNo: s.registrationNo ?? '',
    collectsTourismTax: s.collectsTourismTax,
    sort: String(s.sort),
    active: s.active,
  };
}

/**
 * Yanolja's Business Source list: where reservations come from, grouped under the four
 * "Booking Source" categories, each with a colour, a default market segment and agent terms.
 */
export function BusinessSourcesTab({
  canEdit,
  countryCode,
}: {
  canEdit: boolean;
  countryCode?: string;
}) {
  const qc = useQueryClient();
  const sources = useBusinessSources();
  const segments = useMarketSegments();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const rows = sources.data ?? [];
  const segmentById = React.useMemo(
    () => new Map((segments.data ?? []).map((s) => [s.id, s])),
    [segments.data],
  );
  const visible = filter === 'all' ? rows : rows.filter((r) => r.category === filter);
  const count = (c: SourceCategory) => rows.filter((r) => r.category === c).length;

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        name: d.name.trim(),
        category: d.category,
        palette: d.palette,
        defaultMarketSegmentId: d.defaultMarketSegmentId === NONE ? null : d.defaultMarketSegmentId,
        commissionPlan: d.commissionPlan,
        commissionValue: d.commissionPlan === 'none' ? 0 : Number(d.commissionValue) || 0,
        registrationNo: d.registrationNo.trim() || null,
        collectsTourismTax: d.collectsTourismTax,
        ...(d.sort.trim() !== '' && { sort: Number(d.sort) }),
      };
      return d.id
        ? updateBusinessSource(d.id, { ...body, active: d.active })
        : createBusinessSource({ ...body, shortCode: d.shortCode.trim() });
    },
    onSuccess: (_, d) => {
      toast.success(d.id ? 'Source updated' : 'Source added');
      setDraft(null);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<BusinessSource>[] = [
    {
      header: 'Source',
      accessorKey: 'name',
      cell: ({ row }) => (
        <TagChip color={row.original.palette} code={row.original.shortCode}>
          {row.original.name}
        </TagChip>
      ),
    },
    {
      header: 'Category',
      accessorKey: 'category',
      cell: ({ row }) => SOURCE_CATEGORY_LABELS[row.original.category],
    },
    {
      header: 'Default segment',
      id: 'segment',
      cell: ({ row }) => {
        const seg = row.original.defaultMarketSegmentId
          ? segmentById.get(row.original.defaultMarketSegmentId)
          : undefined;
        return seg ? (
          <span className="text-ink-2">{seg.name}</span>
        ) : (
          <span className="text-ink-3">—</span>
        );
      },
    },
    {
      header: 'Commission',
      id: 'commission',
      cell: ({ row }) => {
        const s = row.original;
        if (s.commissionPlan === 'none') return <span className="text-ink-3">—</span>;
        const value = Number(s.commissionValue);
        const pct = s.commissionPlan.startsWith('pct_');
        return (
          <span className="font-mono tabular-nums text-ink-2">
            {pct ? `${value}%` : value.toFixed(2)}
            <span className="ml-1 font-sans text-xs text-ink-3">
              {COMMISSION_PLAN_LABELS[s.commissionPlan]}
            </span>
          </span>
        );
      },
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
        <CountedChips
          aria-label="Booking source"
          value={filter}
          onChange={setFilter}
          loading={sources.isLoading}
          chips={[
            { value: 'all', label: 'All', count: rows.length },
            { value: 'direct', label: 'Direct', count: count('direct') },
            { value: 'ota', label: 'OTA', count: count('ota') },
            { value: 'travel_agent', label: 'Travel agent', count: count('travel_agent') },
            { value: 'corporate', label: 'Corporate', count: count('corporate') },
          ]}
        />
        {canEdit && (
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={16} />
            Add source
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataGrid
          data={visible}
          columns={columns}
          loading={sources.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setDraft(toDraft(r))}
          emptyTitle="No business sources"
          emptyDescription="Sources tell you where each reservation came from and colour the Stay View."
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? draft.name || 'Business source' : 'New business source'}
            description="Where reservations come from. The Booking Source category decides which list a reservation picks this from."
            footer={
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                {canEdit && (
                  <Button
                    loading={save.isPending}
                    disabled={!draft.name.trim() || (!draft.id && !draft.shortCode.trim())}
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
                <Field label="Code" hint={draft.id ? 'Codes cannot change' : 'e.g. BDC'}>
                  <Input
                    value={draft.shortCode}
                    maxLength={16}
                    disabled={Boolean(draft.id)}
                    className="font-mono uppercase"
                    onChange={(e) => setDraft({ ...draft, shortCode: e.target.value })}
                  />
                </Field>
                <Field label="Name" className="col-span-2">
                  <Input
                    value={draft.name}
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Booking source">
                <Select
                  value={draft.category}
                  onValueChange={(v) => setDraft({ ...draft, category: v as SourceCategory })}
                >
                  <SelectTrigger aria-label="Booking source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SOURCE_CATEGORY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div>
                <div className="mb-1.5 text-sm font-medium text-ink-2">Colour</div>
                <TagColorPicker
                  value={draft.palette}
                  onChange={(palette) => setDraft({ ...draft, palette })}
                  disabled={!canEdit}
                />
              </div>

              <Field
                label="Default market segment"
                hint="A new reservation from this source starts with this segment."
              >
                <Select
                  value={draft.defaultMarketSegmentId}
                  onValueChange={(v) => setDraft({ ...draft, defaultMarketSegmentId: v })}
                >
                  <SelectTrigger aria-label="Default market segment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No default</SelectItem>
                    {(segments.data ?? [])
                      .filter((s) => s.active || s.id === draft.defaultMarketSegmentId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.code} · {s.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Commission" className="col-span-2">
                  <Select
                    value={draft.commissionPlan}
                    onValueChange={(v) =>
                      setDraft({ ...draft, commissionPlan: v as CommissionPlan })
                    }
                  >
                    <SelectTrigger aria-label="Commission plan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(COMMISSION_PLAN_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={draft.commissionPlan.startsWith('pct_') ? 'Rate (%)' : 'Amount'}>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    className="font-mono tabular-nums"
                    disabled={draft.commissionPlan === 'none'}
                    value={draft.commissionValue}
                    onChange={(e) => setDraft({ ...draft, commissionValue: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Registration no." className="col-span-2">
                  <Input
                    value={draft.registrationNo}
                    maxLength={40}
                    onChange={(e) => setDraft({ ...draft, registrationNo: e.target.value })}
                  />
                </Field>
                <Field label="Sort order">
                  <Input
                    type="number"
                    min={0}
                    className="font-mono tabular-nums"
                    value={draft.sort}
                    onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
                  />
                </Field>
              </div>

              {(countryCode === 'MY' || draft.id) && (
                <div className="rounded-lg border border-line px-3">
                  {countryCode === 'MY' && (
                    <SettingRow
                      title="Channel collects tourism tax"
                      description="The OTA already charged foreign guests the RM10 tourism tax, so the hotel must not charge it again."
                    >
                      <Switch
                        aria-label="Channel collects tourism tax"
                        checked={draft.collectsTourismTax}
                        onCheckedChange={(v) => setDraft({ ...draft, collectsTourismTax: v })}
                      />
                    </SettingRow>
                  )}
                  {draft.id && (
                    <SettingRow
                      title="Active"
                      description="Inactive sources stay on past reservations but are not offered for new ones."
                    >
                      <Switch
                        aria-label="Active"
                        checked={draft.active}
                        onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                      />
                    </SettingRow>
                  )}
                </div>
              )}
            </fieldset>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
