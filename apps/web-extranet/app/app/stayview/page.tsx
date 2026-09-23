'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CaretLeft,
  CaretRight,
  GearSix,
  Funnel,
  Plus,
  MagnifyingGlass,
  Users,
  List,
  CalendarBlank,
} from '@phosphor-icons/react';
import {
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
  getStayView,
  subscribeRoomUpdates,
  describeError,
  type StayBar,
  type StayUnit,
} from '@/lib/api';
import { useHasFeature } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';
import { TapeChart } from '@/components/stayview/tape-chart';
import { ReservationSheet } from '@/components/stayview/reservation-panel';
import { CalendarSettings } from '@/components/stayview/calendar-settings';
import { QuickActions, type SelectedRange } from '@/components/stayview/quick-actions';
import { UnitPanel } from '@/components/stayview/unit-panel';
import {
  useCalendarAccess,
  useCalendarPreferences,
} from '@/components/stayview/use-calendar-preferences';
import {
  addDays,
  calendarBars,
  DAY_WINDOWS,
  destinationIssue,
  EMPTY_FILTERS,
  HK_LABEL,
  matchesBar,
  propertyToday,
  SOURCE_LABEL,
  STATUS,
  type CalendarFilters,
} from '@/components/stayview/calendar-model';
import {
  useOnReservationCreated,
  useReservationComposer,
} from '@/components/reservations/composer/composer-context';

type Filter = 'all' | 'vacant' | 'occupied' | 'reserved' | 'blocked' | 'dueOut';
export default function StayViewPage() {
  const qc = useQueryClient();
  const { propertyId, property } = useActiveProperty();
  const { openComposer } = useReservationComposer();
  const { preferences, update, storageKey, storageError } = useCalendarPreferences(propertyId);
  const { can } = useCalendarAccess();
  const roomStreamEnabled = useHasFeature('room_view');
  const today = propertyToday(property?.timezone);
  const [from, setFrom] = React.useState('');
  const date = from || today;
  const [filter, setFilter] = React.useState<Filter>('all');
  const [filters, setFilters] = React.useState<CalendarFilters>(EMPTY_FILTERS);
  const [search, setSearch] = React.useState('');
  const deferredSearch = React.useDeferredValue(search.trim());
  const [selected, setSelected] = React.useState<StayBar | null>(null);
  const [room, setRoom] = React.useState<string | null>(null);
  const [droppedRoom, setDroppedRoom] = React.useState<string | null>(null);
  const [proposedDates, setProposedDates] = React.useState<{
    checkin: string;
    checkout: string;
  } | null>(null);
  const [range, setRange] = React.useState<SelectedRange | null>(null);
  const [selection, setSelection] = React.useState<SelectedRange | null>(null);
  const [settings, setSettings] = React.useState(false);
  const [filterPanel, setFilterPanel] = React.useState(false);
  const [unassigned, setUnassigned] = React.useState<string | null>(null);
  const [locateId, setLocateId] = React.useState<string>();
  const [collapseSignal, setCollapseSignal] = React.useState<{
    collapsed: boolean;
    nonce: number;
  }>();
  const [message, setMessage] = React.useState('');
  const [mobileList, setMobileList] = React.useState(true);
  const [offline, setOffline] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const pendingBooking = React.useRef<string | null>(null);
  const to = addDays(date, preferences.days);
  const chart = useQuery({
    queryKey: ['stayview', propertyId, date, to],
    queryFn: ({ signal }) => getStayView(propertyId!, date, to, signal),
    enabled: !!propertyId,
    placeholderData: (previous) => (previous?.property.id === propertyId ? previous : undefined),
    refetchInterval: 15000,
  });
  const ready =
    chart.data?.property.id === propertyId && chart.data?.from === date && chart.data?.to === to;
  const refresh = React.useCallback(
    (feedback?: string) => {
      if (feedback) setMessage(feedback);
      void qc.invalidateQueries({ queryKey: ['stayview'] });
      void qc.invalidateQueries({ queryKey: ['room-view'] });
      void qc.invalidateQueries({ queryKey: ['booking-legs'] });
    },
    [qc],
  );
  const bars = React.useMemo(() => (chart.data ? calendarBars(chart.data) : []), [chart.data]);
  React.useEffect(() => {
    if (!propertyId || !roomStreamEnabled) return;
    const connection = subscribeRoomUpdates(propertyId, date, () => refresh());
    return () => connection.abort();
  }, [propertyId, date, roomStreamEnabled, refresh]);
  const units = React.useMemo(
    () => chart.data?.roomTypes.flatMap((category) => category.units) ?? [],
    [chart.data],
  );
  const activeUnit = units.find((unit) => unit.id === room) ?? null;
  const writeUrl = React.useCallback((nextDate: string, bookingId?: string, push = false) => {
    const url = new URL(window.location.href);
    url.searchParams.set('from', nextDate);
    if (bookingId) url.searchParams.set('booking', bookingId);
    else url.searchParams.delete('booking');
    if (push) window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }, []);
  const select = React.useCallback(
    (bar: StayBar) => {
      setSelected(bar);
      setRoom(null);
      setDroppedRoom(null);
      setProposedDates(null);
      setLocateId(bar.id);
      writeUrl(date, bar.bookingId);
    },
    [date, writeUrl],
  );
  const closeReservation = () => {
    setSelected(null);
    setDroppedRoom(null);
    setProposedDates(null);
    writeUrl(date);
  };
  const navigate = React.useCallback(
    (next: string) => {
      setFrom(next);
      setRange(null);
      setSelection(null);
      writeUrl(next, undefined, true);
      setSelected(null);
    },
    [writeUrl],
  );
  React.useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const value = params.get('from');
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)))
        setFrom(value);
      else setFrom('');
      pendingBooking.current = params.get('booking');
      setSelected(null);
    };
    restore();
    window.addEventListener('popstate', restore);
    const connection = () => setOffline(!navigator.onLine);
    connection();
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => {
      window.removeEventListener('popstate', restore);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  React.useEffect(() => {
    if (pendingBooking.current && ready) {
      const match = bars.find((bar) => bar.bookingId === pendingBooking.current);
      if (match) {
        setSelected(match);
        setLocateId(match.id);
      } else
        setMessage('The linked reservation is not in this date window or is no longer available.');
      pendingBooking.current = null;
    }
    if (selected && ready) {
      const current =
        bars.find((bar) => bar.id === selected.id) ??
        bars.find((bar) => bar.bookingId && bar.bookingId === selected.bookingId);
      if (current && current !== selected) setSelected(current);
    }
  }, [bars, ready]);
  React.useEffect(() => {
    setSelected(null);
    setRoom(null);
    setRange(null);
    setSelection(null);
    setFilters(EMPTY_FILTERS);
    setFilter('all');
  }, [propertyId]);
  useOnReservationCreated((created) => {
    refresh('Reservation saved.');
    const booking = created.bookings[0];
    if (booking) pendingBooking.current = booking.id;
  });
  React.useEffect(() => {
    if (!preferences.shortcuts) return;
    const handler = (event: KeyboardEvent) => {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)
      )
        return;
      const actions: Record<string, () => void> = {
        f: () => searchRef.current?.focus(),
        t: () => navigate(today),
        s: () => setSettings(true),
        q: () => setRange({ from: date, to: addDays(date, 1) }),
        ArrowLeft: () => navigate(addDays(date, -preferences.days)),
        ArrowRight: () => navigate(addDays(date, preferences.days)),
      };
      if (actions[event.key]) {
        event.preventDefault();
        actions[event.key]!();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [preferences.shortcuts, preferences.days, date, today, navigate]);
  const chips: Chip<Filter>[] = [
    { value: 'all', label: 'All', count: chart.data?.counts.all, tone: 'muted' },
    { value: 'vacant', label: 'Vacant', count: chart.data?.counts.vacant, tone: 'avail' },
    { value: 'occupied', label: 'Occupied', count: chart.data?.counts.occupied, tone: 'brand' },
    { value: 'reserved', label: 'Reserved', count: chart.data?.counts.reserved, tone: 'info' },
    { value: 'blocked', label: 'Blocked', count: chart.data?.counts.blocked, tone: 'closed' },
    { value: 'dueOut', label: 'Due out', count: chart.data?.counts.dueOut, tone: 'low' },
  ];
  const filtered = React.useMemo(() => {
    if (!chart.data) return undefined;
    return {
      ...chart.data,
      roomTypes: chart.data.roomTypes
        .filter((category) => !filters.category || category.roomId === filters.category)
        .map((category) => ({
          ...category,
          units: category.units.filter((unit) => {
            if (
              (filters.floor && unit.floor !== filters.floor) ||
              (filters.housekeeping && unit.housekeeping !== filters.housekeeping)
            )
              return false;
            const on = unit.bars.filter((bar) => bar.from <= date && date < bar.to);
            switch (filter) {
              case 'vacant':
                return on.length === 0 && unit.status === 'active';
              case 'occupied':
                return on.some((bar) => bar.status === 'CheckedIn');
              case 'reserved':
                return on.some((bar) => ['Approved', 'Pending'].includes(bar.status ?? ''));
              case 'blocked':
                return on.some((bar) => bar.kind === 'block');
              case 'dueOut':
                return unit.bars.some((bar) => bar.to === date);
              default:
                return true;
            }
          }),
        }))
        .filter((category) => category.units.length),
    };
  }, [chart.data, filters, filter, date]);
  const results = React.useMemo(() => {
    if (!deferredSearch) return [];
    const term = deferredSearch.toLocaleLowerCase();
    return [
      ...bars
        .filter((bar) =>
          `${bar.guestName ?? ''} ${bar.reference ?? ''}`.toLocaleLowerCase().includes(term),
        )
        .map((bar) => ({
          id: bar.id,
          label: `${bar.guestName} · ${bar.reference}`,
          detail: `${bar.from} → ${bar.to}`,
          bar,
        })),
      ...units
        .filter((unit) =>
          `${unit.code} ${unit.displayName ?? ''}`.toLocaleLowerCase().includes(term),
        )
        .map((unit) => ({
          id: unit.id,
          label: `${unit.code} ${unit.displayName ?? ''}`,
          detail: 'Room details',
          unit,
        })),
    ].slice(0, 30);
  }, [bars, units, deferredSearch]);
  const activeFilters = Object.entries(filters).filter(([, value]) => Boolean(value));
  const openRange = React.useCallback((unitId: string, start: string, end: string) => {
    setSelected(null);
    setRange({ unitId, from: start, to: end });
  }, []);
  const onMove = React.useCallback(
    (bar: StayBar, unitId: string) => {
      select(bar);
      setDroppedRoom(unitId);
    },
    [select],
  );
  const onDates = React.useCallback(
    (bar: StayBar, checkin: string, checkout: string) => {
      select(bar);
      setProposedDates({ checkin, checkout });
    },
    [select],
  );
  const locate = (id: string) => {
    setFilters(EMPTY_FILTERS);
    setFilter('all');
    setMobileList(false);
    setLocateId(undefined);
    requestAnimationFrame(() => setLocateId(id));
  };
  const unassignedBars =
    chart.data?.unassigned.filter(
      (bar) =>
        !unassigned || unassigned === 'all' || (bar.from <= unassigned && unassigned < bar.to),
    ) ?? [];
  return (
    <div className="calendar-workspace min-w-0">
      <PageHeader
        eyebrow="Front desk"
        title="Stay view"
        actions={
          <Button size="sm" variant="secondary" onClick={() => refresh('Refreshing calendar…')}>
            Refresh
          </Button>
        }
      />
      <div
        className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2"
        aria-label="Calendar toolbar"
      >
        <Button
          size="icon"
          variant="ghost"
          aria-label="Previous week / range"
          onClick={() => navigate(addDays(date, -preferences.days))}
        >
          <CaretLeft size={16} />
        </Button>
        <Input
          type="date"
          className="w-36"
          aria-label="Window start date"
          value={date}
          onChange={(event) => event.target.value && navigate(event.target.value)}
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Next week / range"
          onClick={() => navigate(addDays(date, preferences.days))}
        >
          <CaretRight size={16} />
        </Button>
        <Button size="sm" variant="secondary" title="Today (Alt+T)" onClick={() => navigate(today)}>
          Today
        </Button>
        <select
          aria-label="Calendar days"
          className="rounded-lg border border-line bg-surface p-2 text-xs"
          value={preferences.days}
          onChange={(event) => update({ days: Number(event.target.value) })}
        >
          {DAY_WINDOWS.map((days) => (
            <option key={days} value={days}>
              {days} days
            </option>
          ))}
        </select>
        <div className="relative min-w-40 flex-1">
          <MagnifyingGlass
            className="pointer-events-none absolute left-2 top-2.5 text-ink-3"
            size={16}
          />
          <Input
            ref={searchRef}
            aria-label="Search this calendar"
            className="pl-8"
            placeholder="Guest, reference or room"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
            }}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFilterPanel(true)}>
          <Funnel size={15} /> Filters{activeFilters.length ? ` (${activeFilters.length})` : ''}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setUnassigned('all')}>
          <Users size={15} /> Unassigned ({chart.data?.unassigned.length ?? 0})
        </Button>
        <Button
          size="sm"
          disabled={!can('reservation_change') || !ready || offline}
          onClick={() => setRange(selection ?? { from: date, to: addDays(date, 1) })}
        >
          <Plus size={15} /> Quick actions
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Calendar settings (Alt+S)"
          aria-label="Calendar settings"
          onClick={() => setSettings(true)}
        >
          <GearSix size={18} />
        </Button>
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <CountedChips
          chips={chips}
          value={filter}
          onChange={setFilter}
          loading={chart.isLoading}
          aria-label="Room status"
        />
        <div className="flex gap-2 text-xs">
          <select
            aria-label="Group rooms"
            className="rounded border border-line bg-surface p-1"
            value={preferences.groupBy}
            onChange={(event) => update({ groupBy: event.target.value as 'category' | 'floor' })}
          >
            <option value="category">Category</option>
            <option value="floor">Floor</option>
          </select>
          <button
            className="rounded px-1 hover:bg-surface-2"
            onClick={() => setCollapseSignal({ collapsed: false, nonce: Date.now() })}
          >
            Expand all
          </button>
          <button
            className="rounded px-1 hover:bg-surface-2"
            onClick={() => setCollapseSignal({ collapsed: true, nonce: Date.now() })}
          >
            Collapse all
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="md:hidden"
            onClick={() => setMobileList(!mobileList)}
          >
            {mobileList ? <CalendarBlank size={14} /> : <List size={14} />}
            {mobileList ? 'Timeline' : 'Day list'}
          </Button>
        </div>
      </div>
      {activeFilters.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {activeFilters.map(([key, value]) => (
            <button
              key={key}
              className="rounded-full bg-brand-soft px-2 py-1 text-xs text-brand-ink"
              onClick={() => setFilters({ ...filters, [key]: key === 'balance' ? false : '' })}
            >
              {key}:{' '}
              {key === 'category'
                ? chart.data?.roomTypes.find((category) => category.roomId === value)?.name
                : String(value)}{' '}
              ×
            </button>
          ))}
          <button className="text-xs underline" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear all
          </button>
        </div>
      )}
      {deferredSearch && (
        <div
          className="mb-2 max-h-44 overflow-auto rounded-lg border border-line bg-surface p-2"
          aria-label="Calendar search results"
        >
          {results.length ? (
            results.map((result) => (
              <button
                key={result.id}
                className="flex w-full justify-between gap-2 rounded p-2 text-left text-xs hover:bg-brand-soft"
                onClick={() => {
                  locate(result.id);
                  if ('bar' in result) select(result.bar);
                  else {
                    setSelected(null);
                    setRoom(result.unit.id);
                  }
                }}
              >
                <strong>{result.label}</strong>
                <span className="text-ink-3">{result.detail}</span>
              </button>
            ))
          ) : (
            <p className="p-2 text-sm">
              No matches in this window. Change dates or clear your search.
            </p>
          )}
        </div>
      )}
      {preferences.legend && (
        <div aria-label="Calendar legend" className="mb-2 flex flex-wrap gap-3 text-xs text-ink-2">
          {Object.entries(STATUS).map(([key, value]) => (
            <span key={key}>
              <span className={`mr-1 inline-block h-2 w-2 rounded ${value.tone}`} />
              {value.label}
            </span>
          ))}
          <span>▧ Block / maintenance</span>
          <span>★ VIP</span>
          <span>↔ Group / split stay</span>
          <span>$ Balance due</span>
        </div>
      )}
      <div className="mb-2 flex min-h-5 items-center justify-between text-xs text-ink-3">
        <span role="status" aria-live="polite">
          {offline
            ? 'Offline — changes are unavailable until connected.'
            : chart.isFetching
              ? 'Refreshing calendar…'
              : message || `${chart.data?.counts.all ?? 0} rooms · Property time ${today}`}
        </span>
        <button className="underline" onClick={() => update({ legend: !preferences.legend })}>
          Legend / help
        </button>
      </div>
      {chart.isError && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-closed p-3 text-sm text-closed-ink"
        >
          {describeError(chart.error, 'Calendar could not refresh')}. Displayed information may be
          outdated.{' '}
          <button className="underline" onClick={() => void chart.refetch()}>
            Retry
          </button>
        </div>
      )}
      {selection && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-ink">
          <span>
            {units.find((unit) => unit.id === selection.unitId)?.code} · {selection.from} →{' '}
            {selection.to}
          </span>
          <button className="font-semibold underline" onClick={() => setRange(selection)}>
            Actions for selected nights
          </button>
          <button aria-label="Clear selected nights" onClick={() => setSelection(null)}>
            ×
          </button>
        </div>
      )}
      <Card className="overflow-hidden">
        {chart.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : !filtered ? (
          <p className="p-6 text-sm text-ink-3">
            Select an accessible property to load its calendar.
          </p>
        ) : !filtered.roomTypes.length ? (
          <p className="p-6 text-sm text-ink-3">
            {chart.data?.roomTypes.length
              ? 'No rooms match these filters.'
              : 'No rooms configured. Add physical rooms in Property setup.'}{' '}
            <button
              className="underline"
              onClick={() => {
                setFilter('all');
                setFilters(EMPTY_FILTERS);
              }}
            >
              Clear filters
            </button>
          </p>
        ) : (
          <>
            {mobileList && (
              <div className="divide-y divide-line md:hidden" aria-label="Daily stay list">
                <p className="p-3 text-xs font-semibold">
                  {date} · Arrivals, departures and in-house
                </p>
                {bars
                  .filter(
                    (bar) => bar.from <= date && date <= bar.to && matchesBar(bar, filters, date),
                  )
                  .map((bar) => (
                    <button
                      key={bar.id}
                      className="block w-full p-3 text-left"
                      onClick={() => select(bar)}
                    >
                      <strong className="text-sm">{bar.guestName ?? bar.reason}</strong>
                      <span className="block text-xs text-ink-3">
                        {bar.from} → {bar.to} · {STATUS[bar.status ?? '']?.label ?? 'Blocked'}
                      </span>
                    </button>
                  ))}
                {!bars.some((bar) => bar.from <= date && date <= bar.to) && (
                  <p className="p-4 text-sm text-ink-3">No stays for this day.</p>
                )}
                <Button
                  className="m-3"
                  size="sm"
                  disabled={!can('reservation_change')}
                  onClick={() => setRange({ from: date, to: addDays(date, 1) })}
                >
                  New reservation / block
                </Button>
              </div>
            )}
            <div
              className={mobileList ? 'hidden md:block' : ''}
              style={!ready ? { opacity: 0.6, pointerEvents: 'none' } : undefined}
              aria-busy={!ready}
            >
              <TapeChart
                onRangeSelection={setSelection}
                assignmentBar={chart.data?.unassigned.find((bar) => bar.id === selected?.id)}
                data={filtered}
                preferences={preferences}
                filters={filters}
                search={deferredSearch}
                selectedId={selected?.bookingId}
                groupBy={preferences.groupBy}
                density={preferences.density}
                today={today}
                storageKey={storageKey}
                locateId={locateId}
                collapseSignal={collapseSignal}
                onFeedback={setMessage}
                onUnassigned={(value) => setUnassigned(value ?? 'all')}
                onSelectBar={select}
                onSelectUnit={(unit) => {
                  setRoom(unit.id);
                  setSelected(null);
                }}
                canMove={can('room_assignment') && !offline && !chart.isError}
                canChangeDates={
                  can('reservation_change', 'financial_read') && !offline && !chart.isError
                }
                onProposeMove={onMove}
                onProposeDates={onDates}
                onProposeResize={(bar, checkout) => onDates(bar, bar.from, checkout)}
                onSelectEmptyRange={can('reservation_change') && !offline ? openRange : undefined}
                onSelectEmpty={
                  can('reservation_change', 'financial_read') && !offline
                    ? (unitId, start) => {
                        const unit = units.find((item) => item.id === unitId);
                        openComposer({ checkin: start, roomId: unit?.roomId, roomUnitId: unitId });
                      }
                    : undefined
                }
              />
            </div>
          </>
        )}
      </Card>
      <ReservationSheet
        bar={selected}
        droppedRoom={droppedRoom}
        proposedDates={proposedDates}
        calendar={chart.data}
        propertyId={propertyId}
        currency={chart.data?.property.currency ?? ''}
        onClose={closeReservation}
        onChanged={() => refresh('Reservation updated.')}
        onUpdatedBar={setSelected}
        wide={preferences.widePanel}
      />
      <UnitPanel
        key={room}
        unit={activeUnit}
        category={
          chart.data?.roomTypes.find((category) => category.roomId === activeUnit?.roomId)?.name
        }
        today={today}
        propertyId={propertyId}
        onClose={() => setRoom(null)}
        onChanged={refresh}
        onSelect={select}
        onBlock={(unitId) => {
          setRoom(null);
          setRange({ unitId, from: date, to: addDays(date, 1) });
        }}
      />
      <QuickActions
        range={range}
        data={chart.data}
        propertyId={propertyId}
        onClose={() => setRange(null)}
        onSaved={refresh}
      />
      <CalendarSettings
        open={settings}
        onClose={() => setSettings(false)}
        value={preferences}
        onChange={update}
        storageError={storageError}
      />
      <Sheet open={filterPanel} onOpenChange={setFilterPanel}>
        <SheetContent
          title="Calendar filters"
          description="Status and source filters dim other reservations so you keep context."
        >
          <div className="space-y-4">
            {(
              [
                [
                  'status',
                  'Reservation status',
                  Object.entries(STATUS).map(([value, item]) => [value, item.label]),
                ],
                [
                  'source',
                  'Booking source',
                  [...new Set(bars.map((bar) => bar.channel ?? bar.source).filter(Boolean))].map(
                    (source) => [source!, SOURCE_LABEL[source!] ?? source!],
                  ),
                ],
                [
                  'category',
                  'Room category',
                  chart.data?.roomTypes.map((category) => [category.roomId, category.name]) ?? [],
                ],
                [
                  'floor',
                  'Floor',
                  [...new Set(units.map((unit) => unit.floor).filter(Boolean))].map((floor) => [
                    floor!,
                    floor!,
                  ]),
                ],
                ['housekeeping', 'Housekeeping', Object.entries(HK_LABEL)],
                [
                  'activity',
                  'Daily activity',
                  [
                    ['arrivals', 'Arrivals'],
                    ['departures', 'Departures'],
                    ['inhouse', 'In house'],
                  ],
                ],
              ] as [keyof CalendarFilters, string, string[][]][]
            ).map(([key, label, options]) => (
              <label key={key} className="block text-sm">
                {label}
                <select
                  aria-label={label}
                  className="mt-1 block w-full rounded-lg border border-line bg-surface p-2"
                  value={String(filters[key])}
                  onChange={(event) => setFilters({ ...filters, [key]: event.target.value })}
                >
                  <option value="">All</option>
                  {options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            {can('financial_read') && (
              <label className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.balance}
                  onChange={(event) => setFilters({ ...filters, balance: event.target.checked })}
                />
                Balance due
              </label>
            )}
            <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear all filters
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet
        modal={false}
        open={unassigned !== null}
        onOpenChange={(open) => !open && setUnassigned(null)}
      >
        <SheetContent
          showOverlay={false}
          onInteractOutside={(event) => event.preventDefault()}
          title="Unassigned reservations"
          description="Select a stay to locate matching rooms and review its assignment."
        >
          {unassignedBars.length === 0 ? (
            <p className="text-sm text-ink-3">
              All reservations in this selection have rooms assigned.
            </p>
          ) : (
            chart.data?.roomTypes.map((category) => {
              const pending = unassignedBars.filter((bar) => bar.roomId === category.roomId);
              if (!pending.length) return null;
              return (
                <section key={category.roomId} className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold">{category.name}</h3>
                  {pending.map((bar) => (
                    <button
                      className="mb-2 block w-full rounded-lg border border-line p-3 text-left hover:bg-brand-soft"
                      key={bar.id}
                      onClick={() => {
                        setUnassigned(null);
                        setFilters({ ...EMPTY_FILTERS, category: category.roomId });
                        select(bar);
                        const free = category.units.find((unit) => !destinationIssue(bar, unit));
                        if (free) setLocateId(free.id);
                      }}
                    >
                      <strong className="text-sm">{bar.guestName}</strong>
                      <span className="block text-xs text-ink-3">
                        {bar.from} → {bar.to} · {(bar.adults ?? 0) + (bar.children ?? 0)} guests ·{' '}
                        {STATUS[bar.status ?? '']?.label} ·{' '}
                        {SOURCE_LABEL[bar.source ?? ''] ?? bar.source}
                      </span>
                    </button>
                  ))}
                </section>
              );
            })
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
