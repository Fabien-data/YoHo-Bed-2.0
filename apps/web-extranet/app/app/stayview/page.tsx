'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Wand2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CountedChips,
  Input,
  Sheet,
  SheetContent,
  Skeleton,
  type Chip,
} from '@yohobed/ui';
import {
  assignRooms,
  autoAssignRooms,
  getBookingLegs,
  getStayView,
  listRoomUnits,
  releaseBlock,
  type StayBar,
  type StayView,
} from '@/lib/api';
import { useProperties } from '@/lib/queries';
import { TapeChart } from '@/components/stayview/tape-chart';

/** Yanolja shows a fortnight at a time; wide enough to plan, narrow enough to read. */
const WINDOW_NIGHTS = 15;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Filter = 'all' | 'vacant' | 'occupied' | 'reserved' | 'blocked' | 'dueOut';

export default function StayViewPage() {
  const qc = useQueryClient();
  const { data: properties } = useProperties();
  const propertyId = properties?.[0]?.id;

  const [from, setFrom] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [filter, setFilter] = React.useState<Filter>('all');
  const [selected, setSelected] = React.useState<StayBar | null>(null);

  const to = addDays(from, WINDOW_NIGHTS);

  const chart = useQuery({
    queryKey: ['stayview', propertyId, from, to],
    queryFn: () => getStayView(propertyId!, from, to),
    enabled: !!propertyId,
    placeholderData: (prev) => prev, // keep the chart on screen while paging dates
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['stayview'] });

  const chips: Chip<Filter>[] = [
    { value: 'all', label: 'All', count: chart.data?.counts.all, tone: 'muted' },
    { value: 'vacant', label: 'Vacant', count: chart.data?.counts.vacant, tone: 'avail' },
    { value: 'occupied', label: 'Occupied', count: chart.data?.counts.occupied, tone: 'brand' },
    { value: 'reserved', label: 'Reserved', count: chart.data?.counts.reserved, tone: 'info' },
    { value: 'blocked', label: 'Blocked', count: chart.data?.counts.blocked, tone: 'closed' },
    { value: 'dueOut', label: 'Due out', count: chart.data?.counts.dueOut, tone: 'low' },
  ];

  const filtered = React.useMemo(
    () => (chart.data ? applyFilter(chart.data, filter, from) : undefined),
    [chart.data, filter, from],
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
            Front desk
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Stay view</h1>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous week"
            onClick={() => setFrom(addDays(from, -7))}
          >
            <ChevronLeft size={16} />
          </Button>
          <Input
            type="date"
            value={from}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
            className="w-40"
            aria-label="Window start date"
          />
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next week"
            onClick={() => setFrom(addDays(from, 7))}
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFrom(new Date().toISOString().slice(0, 10))}
          >
            Today
          </Button>
        </div>
      </div>

      <CountedChips
        chips={chips}
        value={filter}
        onChange={setFilter}
        loading={chart.isLoading}
        aria-label="Room status"
        className="mb-4"
      />

      <Card className="overflow-hidden">
        {chart.isLoading || !filtered ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.roomTypes.length === 0 ? (
          <p className="p-10 text-center text-sm text-ink-3">
            No rooms set up yet. Add them under Configuration &rarr; Property setup.
          </p>
        ) : (
          <TapeChart data={filtered} onSelectBar={setSelected} />
        )}
      </Card>

      <ReservationSheet
        bar={selected}
        propertyId={propertyId}
        currency={chart.data?.property.currency ?? ''}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  );
}

/**
 * Filter the chart client-side.
 *
 * The window is already loaded, so filtering in the browser is instant and avoids a round trip
 * per chip. A filter hides *rooms*, never bars — a half-empty chart with the bars still in place
 * is what makes "show me only what is vacant" legible.
 */
function applyFilter(data: StayView, filter: Filter, date: string): StayView {
  if (filter === 'all') return data;

  const matches = (unit: StayView['roomTypes'][number]['units'][number]) => {
    const onDate = unit.bars.filter((b) => b.from <= date && date < b.to);
    const booking = onDate.find((b) => b.kind === 'booking');
    const blocked = onDate.some((b) => b.kind === 'block');
    switch (filter) {
      case 'vacant':
        return !booking && !blocked;
      case 'occupied':
        return booking?.status === 'CheckedIn';
      case 'reserved':
        return booking?.status === 'Approved' || booking?.status === 'Pending';
      case 'blocked':
        return blocked;
      case 'dueOut':
        return unit.bars.some((b) => b.kind === 'booking' && b.to === date);
      default:
        return true;
    }
  };

  return {
    ...data,
    roomTypes: data.roomTypes
      .map((rt) => ({ ...rt, units: rt.units.filter(matches) }))
      .filter((rt) => rt.units.length > 0),
  };
}

/** The right slide-over Yanolja opens on every bar. */
function ReservationSheet({
  bar,
  propertyId,
  currency,
  onClose,
  onChanged,
}: {
  bar: StayBar | null;
  propertyId?: string;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const open = bar !== null;
  const isBlock = bar?.kind === 'block';

  const legs = useQuery({
    queryKey: ['booking-legs', bar?.bookingId],
    queryFn: () => getBookingLegs(bar!.bookingId!),
    enabled: open && !!bar?.bookingId,
  });

  const units = useQuery({
    queryKey: ['room-units', propertyId],
    queryFn: () => listRoomUnits(propertyId!),
    enabled: open && !!propertyId,
  });

  const assign = useMutation({
    mutationFn: (v: { legId: string; roomUnitId: string | null }) =>
      assignRooms(bar!.bookingId!, [v]),
    onSuccess: () => {
      legs.refetch();
      onChanged();
    },
  });

  const auto = useMutation({
    mutationFn: () => autoAssignRooms(bar!.bookingId!),
    onSuccess: () => {
      legs.refetch();
      onChanged();
    },
  });

  const unblock = useMutation({
    mutationFn: () => releaseBlock(bar!.id),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={isBlock ? 'Room blocked' : (bar?.guestName ?? 'Reservation')}
        description={isBlock ? bar?.reason : bar?.reference}
      >
        {!bar ? null : isBlock ? (
          <div className="space-y-4">
            <Field label="Reason" value={bar.reason ?? '—'} />
            <Field label="From" value={bar.from} />
            <Field label="To" value={bar.to} />
            <Button
              variant="secondary"
              onClick={() => unblock.mutate()}
              disabled={unblock.isPending}
            >
              {unblock.isPending ? 'Unblocking…' : 'Unblock room'}
            </Button>
            {unblock.isError && (
              <p className="text-sm text-[var(--closed-ink)]">{String(unblock.error)}</p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={bar.status === 'CheckedIn' ? 'avail' : 'brand'}>{bar.status}</Badge>
              {bar.balanceDue && <Badge tone="closed">Payment pending</Badge>}
              <Badge tone="muted" dot={false}>
                {bar.channel ?? bar.source}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Reservation" value={bar.reference ?? '—'} />
              <Field label="Guest" value={bar.guestName ?? '—'} />
              <Field label="Arrival" value={bar.from} />
              <Field label="Departure" value={bar.to} />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Rooms</h3>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => auto.mutate()}
                  disabled={auto.isPending}
                >
                  <Wand2 size={13} />
                  Auto-assign
                </Button>
              </div>

              <div className="flex flex-col gap-2">
                {(legs.data ?? []).map((leg) => (
                  <div
                    key={leg.id}
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <span className="text-xs text-ink-3">Room {leg.legIndex + 1}</span>
                    <select
                      value={leg.roomUnitId ?? ''}
                      onChange={(e) =>
                        assign.mutate({ legId: leg.id, roomUnitId: e.target.value || null })
                      }
                      className="ml-auto rounded-lg border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink"
                    >
                      <option value="">Unassigned</option>
                      {(units.data ?? []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} · {u.roomName}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {assign.isError && (
                <p className="mt-2 text-sm text-[var(--closed-ink)]">
                  {(assign.error as { data?: { message?: string } })?.data?.message ??
                    'That room is not available for those dates.'}
                </p>
              )}
              {auto.data && auto.data.unassigned > 0 && (
                <p className="mt-2 text-sm text-[var(--low-ink)]">
                  Placed {auto.data.assigned}; {auto.data.unassigned} still need a room.
                </p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
