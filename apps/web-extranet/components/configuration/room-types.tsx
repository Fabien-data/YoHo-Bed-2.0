'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DotsSixVertical,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { BED_TYPES } from '@yohobed/domain';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Switch,
  TagDot,
  Tooltip,
  cn,
  toast,
} from '@yohobed/ui';
import {
  deleteRoomType,
  listRoomTypes,
  orderRoomTypes,
  updateRoomType,
  type RoomTypeRow,
} from '@/lib/api';
import { errorMessage } from './shared';

export const roomTypesKey = (propertyId?: string) => ['config', 'room-types', propertyId] as const;

/** "2 / 1", or a dash when the hotel has not said. */
const pair = (a?: number | null, c?: number | null) =>
  a == null && c == null ? '—' : `${a ?? 0} / ${c ?? 0}`;

const GRID =
  'grid grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_auto] items-center gap-3 md:grid-cols-[1.75rem_3.25rem_minmax(0,1fr)_5.5rem_6rem_6rem_7.5rem]';

/**
 * Yanolja's Room Type list (Configuration → Room types): every type in the hotel's own order, on
 * or off, with the guests its rate includes (Base) and the most it takes (Max). Drag a row by its
 * handle — or focus the handle and press ↑/↓ — to change the order everything else follows.
 */
export function RoomTypesList({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = roomTypesKey(propertyId);
  const types = useQuery({ queryKey: key, queryFn: () => listRoomTypes(propertyId) });
  const [search, setSearch] = React.useState('');
  const [switchingOff, setSwitchingOff] = React.useState<RoomTypeRow | null>(null);
  const [deleting, setDeleting] = React.useState<RoomTypeRow | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    // The desk's pickers and the calendars list room types too.
    qc.invalidateQueries({ queryKey: ['room-availability'] });
    qc.invalidateQueries({ queryKey: ['stayview'] });
  };

  const toggle = useMutation({
    mutationFn: ({ row, active }: { row: RoomTypeRow; active: boolean }) =>
      updateRoomType(row.id, { active }),
    onSuccess: (_, { row, active }) => {
      toast.success(active ? `${row.name} is on sale again` : `${row.name} is no longer sold`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (row: RoomTypeRow) => deleteRoomType(row.id),
    onSuccess: (_, row) => {
      toast.success(`${row.name} is deleted`);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => orderRoomTypes(propertyId, ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: key });
      const before = qc.getQueryData<RoomTypeRow[]>(key);
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
    ? all.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.shortCode ?? '').toLowerCase().includes(q),
      )
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
            aria-label="Search room types"
            placeholder="Search room type"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        {canEdit && (
          <Button asChild>
            <Link href="/app/configuration/room-types/new">
              <Plus size={16} aria-hidden /> Add room type
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
          <span>Room type</span>
          <span className="hidden text-right md:block">Rooms</span>
          <span className="hidden text-right md:block">Base (A/C)</span>
          <span className="hidden text-right md:block">Max (A/C)</span>
          <span className="text-right">Action</span>
        </div>
        {types.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={q ? 'No room type matches' : 'No room types yet'}
            description={
              q
                ? 'Try another name or short code.'
                : 'Add the kinds of room you sell — Double, Quadruple, Suite — then their rooms and rates.'
            }
          />
        ) : (
          <ul aria-label="Room types">
            {rows.map((r) => {
              const index = all.findIndex((x) => x.id === r.id);
              return (
                <li
                  key={r.id}
                  data-room-type={r.id}
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
                    checked={r.active ?? true}
                    disabled={!canEdit || toggle.isPending}
                    onCheckedChange={(on) =>
                      on ? toggle.mutate({ row: r, active: true }) : setSwitchingOff(r)
                    }
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/app/configuration/room-types/${r.id}`}
                      className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink hover:underline"
                    >
                      {r.color && <TagDot color={r.color} />}
                      <span className="truncate">{r.name}</span>{' '}
                      {r.shortCode && (
                        <span className="rounded-md border border-line px-1.5 font-mono text-[11px] text-ink-3">
                          {r.shortCode}
                        </span>
                      )}
                    </Link>
                    <div className="text-xs text-ink-3 md:hidden">
                      Base {pair(r.baseAdults, r.baseChildren)} · Max{' '}
                      {pair(r.maxAdults, r.maxChildren)} · {r.units || r.quantity} rooms
                    </div>
                  </div>
                  <span className="hidden text-right font-mono text-sm tabular-nums text-ink-2 md:block">
                    {r.units > 0 ? r.units : r.quantity}
                  </span>
                  <span className="hidden text-right font-mono text-sm tabular-nums text-ink-2 md:block">
                    {pair(r.baseAdults, r.baseChildren)}
                  </span>
                  <span className="hidden text-right font-mono text-sm tabular-nums text-ink-2 md:block">
                    {pair(r.maxAdults, r.maxChildren)}
                  </span>
                  <div className="flex justify-end gap-1">
                    <Button variant="outline" size="icon" asChild>
                      <Link
                        href={`/app/configuration/room-types/${r.id}`}
                        aria-label={`Edit ${r.name}`}
                      >
                        <PencilSimple size={15} aria-hidden />
                      </Link>
                    </Button>
                    {canEdit && (
                      <Tooltip
                        label={
                          r.booked ? 'It has bookings — switch it off instead' : `Delete ${r.name}`
                        }
                      >
                        <span>
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label={`Delete ${r.name}`}
                            disabled={r.booked}
                            onClick={() => setDeleting(r)}
                          >
                            <Trash size={15} aria-hidden />
                          </Button>
                        </span>
                      </Tooltip>
                    )}
                    <RoomTypeInfo row={r} />
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
        description="New reservations can no longer choose it, at the desk or anywhere else. Stays already booked are not touched, and you can switch it on again at any time."
        confirmLabel="Stop selling"
        cancelLabel="Keep selling"
        onConfirm={() => switchingOff && toggle.mutate({ row: switchingOff, active: false })}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : ''}
        description="Its rate plans, prices, availability, numbered rooms and photos are deleted with it. It has never been booked, so no stay is affected. This cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}

/** Yanolja's ⓘ: what the type is made of, without opening it. */
function RoomTypeInfo({ row }: { row: RoomTypeRow }) {
  const beds = (row.bedTypes ?? [])
    .map((b) => BED_TYPES.find((t) => t.code === b)?.label)
    .filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" aria-label={`About ${row.name}`}>
          <Info size={15} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 text-sm">
        <div className="mb-2 font-semibold text-ink">{row.name}</div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink-3">Rooms</dt>
          <dd className="text-ink-2">
            {row.units} numbered · {row.quantity} to sell
          </dd>
          <dt className="text-ink-3">Rate plans</dt>
          <dd className="text-ink-2">{row.ratePlans}</dd>
          <dt className="text-ink-3">Beds</dt>
          <dd className="text-ink-2">{beds.length ? beds.join(', ') : 'Not set'}</dd>
          <dt className="text-ink-3">Amenities</dt>
          <dd className="text-ink-2">{row.amenities?.length ?? 0}</dd>
          <dt className="text-ink-3">Photos</dt>
          <dd className="text-ink-2">{row.photos}</dd>
          <dt className="text-ink-3">Booked</dt>
          <dd className="text-ink-2">{row.booked ? 'Yes' : 'Never'}</dd>
        </dl>
        {row.description && <p className="mt-2 text-xs text-ink-2">{row.description}</p>}
      </PopoverContent>
    </Popover>
  );
}
