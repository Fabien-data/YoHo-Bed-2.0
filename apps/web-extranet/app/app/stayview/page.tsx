'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  CountedChips,
  Input,
  PageHeader,
  Sheet,
  SheetContent,
  Skeleton,
  type Chip,
} from '@yohobed/ui';
import {
  assignRooms,
  autoAssignRooms,
  getBookingLegs,
  getBookingStay,
  getStayView,
  listRoomUnits,
  moveRoom,
  previewStayChange,
  commitStayChange,
  releaseBlock,
  type StayBar,
  type StayView,
} from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { todayISO } from '@/lib/format';
import { TapeChart } from '@/components/stayview/tape-chart';
import { FolioPanel } from '@/components/folio/folio-panel';
import { DeskActionBar } from '@/components/booking/desk-action-bar';
import { useReservationComposer } from '@/components/reservations/composer/composer-context';

/** Yanolja shows a fortnight at a time; wide enough to plan, narrow enough to read. */
const DEFAULT_WINDOW_NIGHTS = 14;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type Filter = 'all' | 'vacant' | 'occupied' | 'reserved' | 'blocked' | 'dueOut';

export default function StayViewPage() {
  const qc = useQueryClient();
  const { propertyId } = useActiveProperty();
  const { openComposer } = useReservationComposer();

  const [from, setFrom] = React.useState(() => todayISO());
  const [filter, setFilter] = React.useState<Filter>('all');
  const [nights, setNights] = React.useState<7 | 14 | 30>(DEFAULT_WINDOW_NIGHTS);
  const [search, setSearch] = React.useState('');
  const [groupBy, setGroupBy] = React.useState<'category' | 'floor'>('category');
  const [density, setDensity] = React.useState<'comfortable' | 'compact'>('comfortable');
  const [selected, setSelected] = React.useState<StayBar | null>(null);
  const [droppedRoom, setDroppedRoom] = React.useState<string | null>(null);
  const [resizedStay, setResizedStay] = React.useState<{
    checkin: string;
    checkout: string;
  } | null>(null);

  const to = addDays(from, nights);

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
    () => (chart.data ? applyFilter(chart.data, filter, from, search) : undefined),
    [chart.data, filter, from, search],
  );

  return (
    <div>
      <PageHeader
        eyebrow="Front desk"
        title="Stay view"
        actions={
          <>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Previous week"
              onClick={() => setFrom(addDays(from, -7))}
            >
              <CaretLeft size={16} />
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
              <CaretRight size={16} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFrom(todayISO())}>
              Today
            </Button>
          </>
        }
      />

      <CountedChips
        chips={chips}
        value={filter}
        onChange={setFilter}
        loading={chart.isLoading}
        aria-label="Room status"
        className="mb-4"
      />

      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
        <label className="min-w-48 flex-1 text-xs font-semibold text-ink-2">
          Find guest, reference, room code or name
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this calendar"
            className="mt-1 w-full"
          />
        </label>
        <label className="text-xs font-semibold text-ink-2">
          Days
          <select
            aria-label="Calendar days"
            value={nights}
            onChange={(event) => setNights(Number(event.target.value) as 7 | 14 | 30)}
            className="mt-1 block rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="7">7</option>
            <option value="14">14</option>
            <option value="30">30</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-2">
          Group rooms
          <select
            aria-label="Group rooms"
            value={groupBy}
            onChange={(event) => setGroupBy(event.target.value as 'category' | 'floor')}
            className="mt-1 block rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="category">Category</option>
            <option value="floor">Floor</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-2">
          Density
          <select
            aria-label="Calendar density"
            value={density}
            onChange={(event) => setDensity(event.target.value as 'comfortable' | 'compact')}
            className="mt-1 block rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      </div>
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-ink-2" aria-label="Calendar legend">
        <span>● Green: checked in</span>
        <span>● Blue: reserved</span>
        <span>● Gold: pending</span>
        <span>● Red dot: room needs cleaning</span>
        <span>▧: blocked</span>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span>
          Drag across empty nights to reserve a date range. Double-click one empty night for a
          one-night stay.
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openComposer({ checkin: from, nights: 1 })}
        >
          New reservation by form
        </Button>
      </div>

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
          <TapeChart
            data={filtered}
            groupBy={groupBy}
            density={density}
            onSelectBar={(bar) => {
              setDroppedRoom(null);
              setResizedStay(null);
              setSelected(bar);
            }}
            onProposeMove={(bar, roomUnitId) => {
              setDroppedRoom(roomUnitId);
              setResizedStay(null);
              setSelected(bar);
            }}
            onProposeResize={(bar, checkout) => {
              setDroppedRoom(null);
              setResizedStay({ checkin: bar.from, checkout });
              setSelected(bar);
            }}
            onSelectEmptyRange={(unitId, start, end) => {
              const group = chart.data?.roomTypes.find((rt) =>
                rt.units.some((unit) => unit.id === unitId),
              );
              const nights = Math.round((Date.parse(end) - Date.parse(start)) / 86400000);
              openComposer({ checkin: start, nights, roomId: group?.roomId, roomUnitId: unitId });
            }}
            // Double-click an empty night: a new reservation for that room from that date.
            onSelectEmpty={(unitId, date) => {
              const rt = chart.data?.roomTypes.find((r) => r.units.some((u) => u.id === unitId));
              openComposer({ checkin: date, roomId: rt?.roomId, roomUnitId: unitId });
            }}
          />
        )}
      </Card>

      <ReservationSheet
        bar={selected}
        droppedRoom={droppedRoom}
        proposedDates={resizedStay}
        calendar={chart.data}
        propertyId={propertyId}
        currency={chart.data?.property.currency ?? ''}
        onClose={() => {
          setSelected(null);
          setDroppedRoom(null);
          setResizedStay(null);
        }}
        onChanged={refresh}
        onUpdatedBar={setSelected}
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
function applyFilter(data: StayView, filter: Filter, date: string, search: string): StayView {
  const term = search.trim().toLocaleLowerCase();
  if (filter === 'all' && !term) return data;

  const matches = (unit: StayView['roomTypes'][number]['units'][number]) => {
    if (
      term &&
      ![
        unit.code,
        unit.displayName ?? '',
        ...unit.bars.flatMap((bar) => [bar.guestName ?? '', bar.reference ?? '']),
      ].some((value) => value.toLocaleLowerCase().includes(term))
    )
      return false;
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
      .map((rt) => ({
        ...rt,
        units: rt.units.filter(
          (unit) =>
            (rt.name.toLocaleLowerCase().includes(term) && filter === 'all') || matches(unit),
        ),
      }))
      .filter((rt) => rt.units.length > 0),
    unassigned: term
      ? data.unassigned.filter((bar) =>
          [bar.guestName ?? '', bar.reference ?? ''].some((value) =>
            value.toLocaleLowerCase().includes(term),
          ),
        )
      : data.unassigned,
    tentative: term
      ? data.tentative?.filter((bar) =>
          [bar.guestName ?? '', bar.reference ?? ''].some((value) =>
            value.toLocaleLowerCase().includes(term),
          ),
        )
      : data.tentative,
  };
}

/** The right slide-over Yanolja opens on every bar. */
function ReservationSheet({
  bar,
  droppedRoom,
  proposedDates,
  calendar,
  propertyId,
  currency,
  onClose,
  onChanged,
  onUpdatedBar,
}: {
  bar: StayBar | null;
  droppedRoom: string | null;
  proposedDates: { checkin: string; checkout: string } | null;
  calendar?: StayView;
  propertyId?: string;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
  onUpdatedBar: (bar: StayBar) => void;
}) {
  const open = bar !== null;
  const isBlock = bar?.kind === 'block';
  const [review, setReview] = React.useState<{ legId: string; toRoomUnitId: string | null } | null>(
    null,
  );
  const [dates, setDates] = React.useState({ checkin: '', checkout: '' });
  React.useEffect(
    () =>
      setReview(
        droppedRoom && bar?.kind === 'booking'
          ? { legId: bar.id, toRoomUnitId: droppedRoom }
          : null,
      ),
    [bar?.id, bar?.kind, droppedRoom],
  );
  React.useEffect(
    () => setDates(proposedDates ?? { checkin: bar?.from ?? '', checkout: bar?.to ?? '' }),
    [bar?.id, bar?.from, bar?.to, proposedDates],
  );

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
    mutationFn: (v: { legId: string; roomUnitId: string | null; expectedUpdatedAt?: string }) =>
      assignRooms(bar!.bookingId!, [v]),
    onSuccess: () => {
      legs.refetch();
      onChanged();
      setReview(null);
    },
  });
  const autoAssign = useMutation({
    mutationFn: () => autoAssignRooms(bar!.bookingId!),
    onSuccess: () => {
      void legs.refetch();
      onChanged();
      setReview(null);
    },
  });
  const move = useMutation({
    mutationFn: (v: { legId: string; toRoomUnitId: string; expectedUpdatedAt: string }) =>
      moveRoom(bar!.bookingId!, v),
    onSuccess: () => {
      void legs.refetch();
      onChanged();
      setReview(null);
    },
  });
  const stayPreview = useMutation({
    mutationFn: (proposal?: { checkin: string; checkout: string }) => {
      const next = proposal ?? dates;
      return previewStayChange(bar!.bookingId!, next.checkin, next.checkout);
    },
  });
  const bookingStay = useQuery({
    queryKey: ['booking-stay', bar?.bookingId],
    queryFn: () => getBookingStay(bar!.bookingId!),
    enabled: open && bar?.status === 'CheckedIn' && !!bar.bookingId,
  });
  React.useEffect(() => {
    if (bookingStay.data && bar?.status === 'CheckedIn')
      setDates({ checkin: bookingStay.data.checkin, checkout: bookingStay.data.checkout });
  }, [bookingStay.data, bar?.status]);
  React.useEffect(() => {
    stayPreview.reset();
    stayCommit.reset();
  }, [bar?.id]);
  React.useEffect(() => {
    if (proposedDates && bar?.kind === 'booking' && bar.source !== 'OTA') {
      stayPreview.mutate(proposedDates);
    }
    // The proposal object is created only by a completed resize gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bar?.id, proposedDates]);
  const stayCommit = useMutation({
    mutationFn: () => commitStayChange(stayPreview.data!),
    onSuccess: (booking) => {
      onUpdatedBar({ ...bar!, from: booking.checkin, to: booking.checkout });
      onChanged();
      stayPreview.reset();
      void legs.refetch();
    },
  });

  const unblock = useMutation({
    mutationFn: () => releaseBlock(bar!.id),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });
  const bookedCategory =
    calendar?.roomTypes.find((group) =>
      group.units.some((unit) => unit.bars.some((item) => item.id === bar?.id)),
    )?.roomId ?? calendar?.unassigned.find((item) => item.id === bar?.id)?.roomId;
  const chosenLeg = legs.data?.find((leg) => leg.id === review?.legId);
  const destination = units.data?.find((unit) => unit.id === review?.toRoomUnitId);
  const destinationCalendar = calendar?.roomTypes
    .flatMap((group) => group.units)
    .find((unit) => unit.id === review?.toRoomUnitId);
  const conflicts =
    (chosenLeg &&
      destinationCalendar?.bars.filter(
        (item) =>
          item.id !== chosenLeg.id && item.from < chosenLeg.checkout && chosenLeg.checkin < item.to,
      )) ||
    [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={isBlock ? 'Room blocked' : (bar?.guestName ?? 'Reservation')}
        description={isBlock ? bar?.reason : bar?.reference}
      >
        {!bar ? null : isBlock ? (
          <div className="space-y-4">
            <InfoRow label="Reason" value={bar.reason ?? '—'} />
            <InfoRow label="From" value={bar.from} />
            <InfoRow label="To" value={bar.to} />
            <Button
              variant="secondary"
              onClick={() => unblock.mutate()}
              disabled={unblock.isPending}
            >
              {unblock.isPending ? 'Unblocking…' : 'Unblock room'}
            </Button>
            {unblock.isError && <p className="text-sm text-closed-ink">{String(unblock.error)}</p>}
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

            {bar.bookingId && (
              <DeskActionBar
                status={bar.status ?? ''}
                booking={{
                  id: bar.bookingId,
                  reference: bar.reference ?? '',
                  guestName: bar.guestName ?? 'the guest',
                  checkin: bar.from,
                  checkout: bar.to,
                }}
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <InfoRow label="Reservation" value={bar.reference ?? '—'} />
              <InfoRow label="Guest" value={bar.guestName ?? '—'} />
              <InfoRow label="Arrival" value={bar.from} />
              <InfoRow label="Departure" value={bar.to} />
            </div>

            {(bar.status === 'Pending' ||
              bar.status === 'Approved' ||
              bar.status === 'CheckedIn') &&
              bar.source !== 'OTA' && (
                <div className="rounded-xl border border-line p-3">
                  <h3 className="mb-2 text-sm font-bold text-ink">
                    {bar.status === 'CheckedIn' ? 'Extend stay' : 'Change stay dates'}
                  </h3>
                  {proposedDates && (
                    <p className="mb-2 rounded-lg bg-brand-soft px-3 py-2 text-xs font-semibold text-brand-ink">
                      Departure moved on the calendar. Review availability and the price difference
                      before saving.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-semibold text-ink-2">
                      Arrival
                      <Input
                        type="date"
                        disabled={bar.status === 'CheckedIn'}
                        value={dates.checkin}
                        onChange={(event) => {
                          setDates({ ...dates, checkin: event.target.value });
                          stayPreview.reset();
                        }}
                      />
                    </label>
                    <label className="text-xs font-semibold text-ink-2">
                      Departure
                      <Input
                        type="date"
                        min={bar.status === 'CheckedIn' ? addDays(bar.to, 1) : undefined}
                        value={dates.checkout}
                        onChange={(event) => {
                          setDates({ ...dates, checkout: event.target.value });
                          stayPreview.reset();
                        }}
                      />
                    </label>
                  </div>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    disabled={
                      stayPreview.isPending ||
                      !dates.checkin ||
                      !dates.checkout ||
                      dates.checkout <= dates.checkin ||
                      (dates.checkin === bar.from && dates.checkout === bar.to)
                    }
                    onClick={() => stayPreview.mutate(dates)}
                  >
                    Review date and price change
                  </Button>
                  {stayPreview.isError && (
                    <p className="mt-2 text-sm text-closed-ink">{String(stayPreview.error)}</p>
                  )}
                  {stayPreview.data && (
                    <div
                      className="mt-3 space-y-2 rounded-lg bg-surface-2 p-3 text-sm"
                      aria-label="Review stay change"
                    >
                      <p>
                        <strong>Current:</strong> {stayPreview.data.old.checkin} →{' '}
                        {stayPreview.data.old.checkout} · {currency} {stayPreview.data.old.amount}
                      </p>
                      <p>
                        <strong>Proposed:</strong> {stayPreview.data.proposed.checkin} →{' '}
                        {stayPreview.data.proposed.checkout} · {currency}{' '}
                        {stayPreview.data.proposed.amount}
                      </p>
                      <p>
                        <strong>Difference:</strong> {currency}{' '}
                        {stayPreview.data.proposed.difference}
                      </p>
                      <div className="max-h-28 overflow-auto border-t border-line pt-2">
                        {stayPreview.data.nights.map((night) => (
                          <p key={night.date} className="flex justify-between">
                            <span>
                              {night.date}{' '}
                              {night.retained ? '· agreed rate kept' : '· current rate'}
                            </span>
                            <span>{night.amount}</span>
                          </p>
                        ))}
                      </div>
                      {stayPreview.data.conflicts.length > 0 && (
                        <p className="text-closed-ink">
                          Assigned room conflict on the proposed dates. Move the booking to an
                          available room first.
                        </p>
                      )}
                      <Button
                        size="sm"
                        disabled={stayCommit.isPending || stayPreview.data.conflicts.length > 0}
                        onClick={() => stayCommit.mutate()}
                      >
                        {stayCommit.isPending ? 'Saving…' : 'Save reviewed change'}
                      </Button>
                      {stayCommit.isError && (
                        <p className="text-closed-ink">{String(stayCommit.error)}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            {bar.source === 'OTA' && (
              <p className="text-xs text-ink-3">
                OTA date amendments require provider support. Internal room allocation is available
                below.
              </p>
            )}

            <div>
              <h3 className="mb-2 text-sm font-bold text-ink">Bill</h3>
              {bar.bookingId && <FolioPanel bookingId={bar.bookingId} />}
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold text-ink">Rooms</h3>
                {bar.bookingId && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => autoAssign.mutate()}
                    disabled={
                      autoAssign.isPending ||
                      legs.isPending ||
                      bar.status === 'CheckedIn' ||
                      !(legs.data ?? []).some((leg) => !leg.roomUnitId)
                    }
                  >
                    {autoAssign.isPending ? 'Assigning…' : 'Auto-assign rooms'}
                  </Button>
                )}
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
                        setReview({ legId: leg.id, toRoomUnitId: e.target.value || null })
                      }
                      className="ml-auto rounded-lg border border-line-strong bg-surface-2 px-2 py-1 text-sm text-ink"
                    >
                      <option value="">Unassigned</option>
                      {(units.data ?? [])
                        .filter(
                          (u) =>
                            u.status === 'active' &&
                            (!bookedCategory || u.roomId === bookedCategory),
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.code}
                            {u.displayName ? ` · ${u.displayName}` : ''} · {u.roomName}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>

              {review && chosenLeg && (
                <div
                  className="mt-4 rounded-xl border border-brand bg-surface-2 p-4"
                  aria-label="Review room change"
                >
                  <h4 className="text-sm font-bold text-ink">Review room change</h4>
                  <p className="mt-2 text-sm text-ink-2">
                    {chosenLeg.code ?? 'Unassigned'}
                    {chosenLeg.displayName ? ` · ${chosenLeg.displayName}` : ''} →{' '}
                    {destination
                      ? `${destination.code}${destination.displayName ? ` · ${destination.displayName}` : ''}`
                      : 'Unassigned'}
                  </p>
                  <p className="text-sm text-ink-2">
                    {chosenLeg.checkin} → {chosenLeg.checkout} · Same category · Agreed rate
                    unchanged
                  </p>
                  {destinationCalendar?.housekeeping === 'dirty' && (
                    <p className="mt-2 text-sm text-closed-ink">
                      The room is dirty today. Clean it before check-in.
                    </p>
                  )}
                  {conflicts.length > 0 && (
                    <p className="mt-2 text-sm text-closed-ink">
                      This room overlaps {conflicts.length} booking or block. Choose another room.
                    </p>
                  )}
                  {bar.status === 'CheckedIn' && !review.toRoomUnitId && (
                    <p className="mt-2 text-sm text-closed-ink">
                      An in-house room cannot be unassigned.
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (
                          bar.status === 'CheckedIn' &&
                          review.toRoomUnitId &&
                          chosenLeg.roomUnitId
                        )
                          move.mutate({
                            legId: chosenLeg.id,
                            toRoomUnitId: review.toRoomUnitId,
                            expectedUpdatedAt: chosenLeg.updatedAt,
                          });
                        else
                          assign.mutate({
                            legId: chosenLeg.id,
                            roomUnitId: review.toRoomUnitId,
                            expectedUpdatedAt: chosenLeg.updatedAt,
                          });
                      }}
                      disabled={
                        assign.isPending ||
                        move.isPending ||
                        conflicts.length > 0 ||
                        (bar.status === 'CheckedIn' && !review.toRoomUnitId)
                      }
                    >
                      {assign.isPending || move.isPending ? 'Saving…' : 'Save change'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setReview(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {assign.isError && (
                <p className="mt-2 text-sm text-closed-ink">
                  {(assign.error as { data?: { message?: string } })?.data?.message ??
                    'That room is not available for those dates.'}
                </p>
              )}
              {autoAssign.isError && (
                <p className="mt-2 text-sm text-closed-ink">
                  {(autoAssign.error as { data?: { message?: string } })?.data?.message ??
                    'No suitable room is available for every unassigned stay.'}
                </p>
              )}
              {move.isError && <p className="mt-2 text-sm text-closed-ink">{String(move.error)}</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** A label/value display row (renamed from `Field` so it cannot shadow the kit's form Field). */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
