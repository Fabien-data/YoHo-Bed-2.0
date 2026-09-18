'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from '@phosphor-icons/react';
import {
  Badge,
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
  createMarketSegment,
  updateMarketSegment,
  type MarketSegment,
  type MarketSegmentGroup,
} from '@/lib/api';
import { queryKeys, useMarketSegments } from '@/lib/queries';
import { ActiveBadge, SEGMENT_GROUP_LABELS, SettingRow, errorMessage } from './shared';

type Filter = 'all' | MarketSegmentGroup;

interface Draft {
  id?: string;
  code: string;
  name: string;
  group: MarketSegmentGroup;
  palette: string;
  excludedFromSold: boolean;
  sort: string;
  active: boolean;
}

const EMPTY: Draft = {
  code: '',
  name: '',
  group: 'transient',
  palette: 'slate',
  excludedFromSold: false,
  sort: '',
  active: true,
};

/**
 * Yanolja's Market Segment: why the guest is staying. Revenue reports split by it, so a
 * complimentary or house-use segment is kept out of the rooms-sold figures.
 */
export function MarketSegmentsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const segments = useMarketSegments();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const rows = segments.data ?? [];
  const visible = filter === 'all' ? rows : rows.filter((r) => r.grp === filter);
  const count = (g: MarketSegmentGroup) => rows.filter((r) => r.grp === g).length;

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        name: d.name.trim(),
        group: d.group,
        palette: d.palette,
        excludedFromSold: d.excludedFromSold,
        ...(d.sort.trim() !== '' && { sort: Number(d.sort) }),
      };
      return d.id
        ? updateMarketSegment(d.id, { ...body, active: d.active })
        : createMarketSegment({ ...body, code: d.code.trim() });
    },
    onSuccess: (_, d) => {
      toast.success(d.id ? 'Segment updated' : 'Segment added');
      setDraft(null);
      qc.invalidateQueries({ queryKey: queryKeys.config });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: ColumnDef<MarketSegment>[] = [
    {
      header: 'Segment',
      accessorKey: 'name',
      cell: ({ row }) => (
        <TagChip color={row.original.palette} code={row.original.code}>
          {row.original.name}
        </TagChip>
      ),
    },
    {
      header: 'Group',
      accessorKey: 'grp',
      cell: ({ row }) => SEGMENT_GROUP_LABELS[row.original.grp],
    },
    {
      header: 'Rooms sold',
      accessorKey: 'excludedFromSold',
      cell: ({ row }) =>
        row.original.excludedFromSold ? (
          <Badge tone="low">Not counted</Badge>
        ) : (
          <span className="text-ink-3">Counted</span>
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
        <CountedChips
          aria-label="Segment group"
          value={filter}
          onChange={setFilter}
          loading={segments.isLoading}
          chips={[
            { value: 'all', label: 'All', count: rows.length },
            { value: 'transient', label: 'Transient', count: count('transient') },
            { value: 'group', label: 'Group', count: count('group') },
            { value: 'contract', label: 'Contract', count: count('contract') },
            { value: 'non_revenue', label: 'Non-revenue', count: count('non_revenue') },
          ]}
        />
        {canEdit && (
          <Button onClick={() => setDraft({ ...EMPTY })}>
            <Plus size={16} />
            Add segment
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        <DataGrid
          data={visible}
          columns={columns}
          loading={segments.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) =>
            setDraft({
              id: r.id,
              code: r.code,
              name: r.name,
              group: r.grp,
              palette: r.palette,
              excludedFromSold: r.excludedFromSold,
              sort: String(r.sort),
              active: r.active,
            })
          }
          emptyTitle="No market segments"
        />
      </Card>

      <Sheet open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        {draft && (
          <SheetContent
            title={draft.id ? draft.name || 'Market segment' : 'New market segment'}
            description="Why the guest is staying — used to analyse revenue by segment."
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
                <Field label="Code" hint={draft.id ? 'Codes cannot change' : 'e.g. MICE'}>
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
                    maxLength={120}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Group" className="col-span-2">
                  <Select
                    value={draft.group}
                    onValueChange={(v) => setDraft({ ...draft, group: v as MarketSegmentGroup })}
                  >
                    <SelectTrigger aria-label="Group">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SEGMENT_GROUP_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

              <div>
                <div className="mb-1.5 text-sm font-medium text-ink-2">Colour</div>
                <TagColorPicker
                  value={draft.palette}
                  onChange={(palette) => setDraft({ ...draft, palette })}
                  disabled={!canEdit}
                />
              </div>

              <div className="rounded-lg border border-line px-3">
                <SettingRow
                  title="Leave out of rooms sold"
                  description="For complimentary and house-use stays, so occupancy and average rate stay honest."
                >
                  <Switch
                    aria-label="Leave out of rooms sold"
                    checked={draft.excludedFromSold}
                    onCheckedChange={(v) => setDraft({ ...draft, excludedFromSold: v })}
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
