'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DotsSixVertical, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { mealsOf, type MealPlan } from '@yohobed/domain';
import { displayMealCode } from '@yohobed/locale';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Skeleton,
  Switch,
  Tooltip,
  cn,
  toast,
} from '@yohobed/ui';
import {
  deleteRateType,
  listRateTypes,
  orderRateTypes,
  updateRateType,
  type RateType,
} from '@/lib/api';
import { money } from '@/lib/format';
import { usePropertySettings } from '@/lib/queries';
import { errorMessage } from './shared';

export const rateTypesKey = (propertyId?: string) => ['config', 'rate-types', propertyId] as const;

/** "Breakfast and dinner", "No meals". */
export function mealsText(plan: MealPlan): string {
  const m = mealsOf(plan);
  if (m.allInclusive) return 'All inclusive';
  const meals = [m.breakfast && 'Breakfast', m.lunch && 'lunch', m.dinner && 'dinner'].filter(
    Boolean,
  ) as string[];
  if (!meals.length) return 'No meals';
  return meals.length === 1
    ? meals[0]!
    : `${meals.slice(0, -1).join(', ')} and ${meals[meals.length - 1]}`;
}

const GRID =
  'grid grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[1.75rem_3.25rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem]';

/**
 * Yanolja's Rate Type list (Configuration → Rate types): the pricing structures the hotel sells,
 * in its own order, with the meals and the add-ons each includes.
 */
export function RateTypesList({
  propertyId,
  canEdit,
  currency,
}: {
  propertyId: string;
  canEdit: boolean;
  currency: string;
}) {
  const qc = useQueryClient();
  const key = rateTypesKey(propertyId);
  const types = useQuery({ queryKey: key, queryFn: () => listRateTypes(propertyId) });
  const settings = usePropertySettings(propertyId);
  const style = settings.data?.mealCodeStyle ?? 'international';
  const [search, setSearch] = React.useState('');
  const [deleting, setDeleting] = React.useState<RateType | null>(null);
  const [switchingOff, setSwitchingOff] = React.useState<RateType | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['config', 'rate-plans'] });
    qc.invalidateQueries({ queryKey: ['room-availability'] });
  };
  const toggle = useMutation({
    mutationFn: ({ row, active }: { row: RateType; active: boolean }) =>
      updateRateType(row.id, { active }),
    onSuccess: (_, { row, active }) => {
      toast.success(active ? `${row.name} is on sale again` : `${row.name} is no longer sold`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (row: RateType) => deleteRateType(row.id),
    onSuccess: (_, row) => {
      toast.success(`${row.name} is deleted`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => orderRateTypes(propertyId, ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<RateType[]>(key);
      if (before)
        qc.setQueryData(
          key,
          ids.map((id) => before.find((r) => r.id === id)!),
        );
      return { before };
    },
    onError: (e, _ids, ctx) => {
      if (ctx?.before) qc.setQueryData(key, ctx.before);
      toast.error(errorMessage(e));
    },
    onSuccess: () => toast.success('Order saved'),
    onSettled: refresh,
  });

  const all = types.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = q
    ? all.filter((r) => r.name.toLowerCase().includes(q) || r.shortCode.toLowerCase().includes(q))
    : all;
  const moveTo = (id: string, index: number) => {
    const ids = all.map((r) => r.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    if (ids.join() !== all.map((r) => r.id).join()) reorder.mutate(ids);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <MagnifyingGlass
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Input
            aria-label="Search rate types"
            placeholder="Search rate type"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        {canEdit && (
          <Button asChild>
            <Link href="/app/configuration/rate-types/new">
              <Plus size={16} aria-hidden /> Add rate type
            </Link>
          </Button>
        )}
      </div>
      <Card className="overflow-hidden">
        <div
          className={cn(
            GRID,
            'border-b border-line bg-surface-2 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2',
          )}
        >
          <span />
          <span>Sold</span>
          <span>Rate type</span>
          <span className="hidden md:block">Included meal plan</span>
          <span className="hidden md:block">Add-ons</span>
          <span className="text-right">Action</span>
        </div>
        {types.isLoading ? (
          <Skeleton className="m-3 h-10" />
        ) : rows.length === 0 ? (
          <EmptyState
            title={q ? 'No rate type matches' : 'No rate types yet'}
            description={
              q
                ? 'Try another name or code.'
                : 'Add what you sell — Room only, Bed and breakfast, a honeymoon package.'
            }
          />
        ) : (
          <ul aria-label="Rate types">
            {rows.map((r) => {
              const index = all.findIndex((x) => x.id === r.id);
              return (
                <li
                  key={r.id}
                  draggable={canEdit && !q}
                  onDragStart={(e) => {
                    setDragId(r.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => {
                    if (dragId && dragId !== r.id) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && dragId !== r.id) moveTo(dragId, index);
                    setDragId(null);
                  }}
                  className={cn(
                    GRID,
                    'border-b border-line px-3 py-2.5 last:border-0',
                    dragId === r.id && 'opacity-40',
                    !r.active && 'bg-surface-2',
                  )}
                >
                  <button
                    type="button"
                    disabled={!canEdit || !!q}
                    aria-label={`Move ${r.name}. Use the up and down arrow keys.`}
                    title="Drag to reorder"
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp' && index > 0) {
                        e.preventDefault();
                        moveTo(r.id, index - 1);
                      } else if (e.key === 'ArrowDown' && index < all.length - 1) {
                        e.preventDefault();
                        moveTo(r.id, index + 1);
                      }
                    }}
                    className="flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink disabled:cursor-default disabled:opacity-40"
                  >
                    <DotsSixVertical size={16} weight="bold" aria-hidden />
                  </button>
                  <Switch
                    aria-label={`Sell ${r.name}`}
                    checked={r.active}
                    disabled={!canEdit || toggle.isPending}
                    onCheckedChange={(on) =>
                      on ? toggle.mutate({ row: r, active: true }) : setSwitchingOff(r)
                    }
                  />
                  <Link
                    href={`/app/configuration/rate-types/${r.id}`}
                    className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink hover:underline"
                  >
                    <span className="truncate">{r.name}</span>{' '}
                    <span className="rounded-md border border-line px-1.5 font-mono text-[11px] text-ink-3">
                      {r.shortCode}
                    </span>
                  </Link>
                  <span className="hidden text-sm text-ink-2 md:block">
                    <span className="font-mono text-ink">{displayMealCode(r.mealPlan, style)}</span>{' '}
                    · {mealsText(r.mealPlan)}
                  </span>
                  <span className="hidden truncate text-sm text-ink-2 md:block">
                    {r.addOns.length
                      ? r.addOns.map((a) => `${a.name} (${money(a.amount, currency)})`).join(', ')
                      : '—'}
                  </span>
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" size="icon" asChild>
                      <Link
                        href={`/app/configuration/rate-types/${r.id}`}
                        aria-label={`Edit ${r.name}`}
                      >
                        <PencilSimple size={15} aria-hidden />
                      </Link>
                    </Button>
                    {canEdit && (
                      <Tooltip
                        label={
                          r.ratePlans > 0
                            ? `Sold by ${r.ratePlans} rate plan${r.ratePlans === 1 ? '' : 's'} — switch it off instead`
                            : `Delete ${r.name}`
                        }
                      >
                        <span>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={`Delete ${r.name}`}
                            disabled={r.ratePlans > 0}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash size={15} aria-hidden />
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={switchingOff !== null}
        onOpenChange={(open) => !open && setSwitchingOff(null)}
        title={switchingOff ? `Stop selling ${switchingOff.name}?` : ''}
        description="Its rates are no longer offered for new reservations. Stays already booked on it keep their prices, and you can switch it on again at any time."
        confirmLabel="Stop selling"
        cancelLabel="Keep selling"
        onConfirm={() => switchingOff && toggle.mutate({ row: switchingOff, active: false })}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        description="No rate plan sells it, so nothing else changes. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}
