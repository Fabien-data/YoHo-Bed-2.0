'use client';

import * as React from 'react';
import { Prohibit, Wrench } from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';
import type { StayBar, StayRoomType, StayView } from '@/lib/api';

import {
  geometry,
  addDays,
  daysBetween,
  destinationIssue,
  matchesBar,
  STATUS,
  SOURCE_LABEL,
  HK_LABEL,
  DEFAULT_PREFERENCES,
  EMPTY_FILTERS,
  type CalendarPreferences,
  type CalendarFilters,
} from './calendar-model';
import type { StayUnit } from '@/lib/api';
export const COL_W = 92;
export const ROW_H = 44;
export const LABEL_W = 200;
const barTone = (bar: StayBar) => STATUS[bar.status ?? '']?.tone ?? 'bg-brand text-white';
const barGeometry = geometry;
interface Presentation {
  preferences: CalendarPreferences;
  filters: CalendarFilters;
  selectedId?: string;
  search: string;
  canMove: boolean;
  canChangeDates: boolean;
  drag: StayBar | null;
  setDrag: (bar: StayBar | null, x?: number) => void;
}
const PresentationContext = React.createContext<Presentation>({
  preferences: DEFAULT_PREFERENCES,
  filters: EMPTY_FILTERS,
  search: '',
  canMove: false,
  canChangeDates: false,
  drag: null,
  setDrag: () => undefined,
});

/**
 * Pack bars into rows so none overlaps another: first row with room, else a new row. The
 * Unassigned and Tentative lanes hold many bookings over the same nights (a five-room group with
 * no room numbers yet is five bars on the same dates); drawn in one row, all but one were hidden.
 */
export function stackBars(bars: StayBar[]): StayBar[][] {
  const rows: Array<{ end: string; bars: StayBar[] }> = [];
  for (const b of [...bars].sort(
    (x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to),
  )) {
    const row = rows.find((r) => r.end <= b.from);
    if (row) {
      row.bars.push(b);
      row.end = b.to;
    } else {
      rows.push({ end: b.to, bars: [b] });
    }
  }
  return rows.map((r) => r.bars);
}

function StackedLane({
  label,
  bars,
  dates,
  onSelect,
  onResize,
  tone,
}: {
  label: string;
  bars: StayBar[];
  dates: string[];
  onSelect: (bar: StayBar) => void;
  onResize?: (bar: StayBar, checkout: string) => void;
  tone: 'low' | 'info';
}) {
  const rows = stackBars(bars);
  const bg = tone === 'low' ? 'bg-low-soft' : 'bg-info-soft';
  return (
    <div className={cn('flex border-b border-line', bg)} data-lane={label}>
      <div
        className={cn(
          'sticky left-0 z-10 flex shrink-0 items-start border-r border-line px-3 pt-3',
          bg,
        )}
        style={{ width: LABEL_W, minHeight: ROW_H }}
      >
        <span
          className={cn('text-xs font-bold', tone === 'low' ? 'text-low-ink' : 'text-info-ink')}
        >
          {label} ({bars.length})
        </span>
      </div>
      <div className="flex shrink-0 flex-col">
        {rows.map((row, i) => (
          <div
            key={i}
            className="relative shrink-0"
            style={{ ...gridBackground(dates), height: ROW_H }}
          >
            {row.map((b) => (
              <Bar key={b.id} bar={b} dates={dates} onSelect={onSelect} onResize={onResize} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const Bar = React.memo(function Bar({
  bar,
  dates,
  onSelect,
  onResize,
}: {
  bar: StayBar;
  dates: string[];
  onSelect: (bar: StayBar) => void;
  onResize?: (bar: StayBar, checkout: string) => void;
}) {
  const g = barGeometry(dates, bar);
  const presentation = React.useContext(PresentationContext);
  const { preferences, filters, selectedId, search, canMove, canChangeDates, drag, setDrag } =
    presentation;
  const matches =
    matchesBar(bar, filters, dates[0]!) &&
    (!search ||
      `${bar.guestName} ${bar.reference}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const resizeStart = React.useRef<{ x: number; checkout: string } | null>(null);
  const canResize =
    canChangeDates &&
    bar.kind === 'booking' &&
    bar.source !== 'OTA' &&
    bar.status !== 'CheckedOut' &&
    bar.status !== 'Cancelled';
  const resizeBy = (days: number) => {
    if (!onResize || !days) return;
    const checkout = new Date(`${bar.to}T00:00:00Z`);
    checkout.setUTCDate(checkout.getUTCDate() + days);
    const proposed = checkout.toISOString().slice(0, 10);
    if (proposed > bar.from) onResize(bar, proposed);
  };

  if (!g) return null;
  if (bar.kind === 'block') {
    return (
      <button
        type="button"
        onClick={() => onSelect(bar)}
        // A double-click on the row opens a new reservation; on a bar it must not.
        onDoubleClick={(e) => e.stopPropagation()}
        title={bar.reason}
        className={cn(
          'absolute top-1 flex h-[calc(100%-8px)] items-center gap-1.5 overflow-hidden rounded px-2',
          'text-left text-xs font-semibold text-white',
          !g.startsBefore && 'rounded-l',
          !g.endsAfter && 'rounded-r',
        )}
        style={{
          left: g.left + 2,
          width: g.width,
          // The hatched navy bar Yanolja uses for out-of-service rooms.
          backgroundColor: 'var(--brand)',
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,.16) 0 6px, transparent 6px 12px)',
        }}
      >
        <Wrench size={12} className="shrink-0" />
        <span className="truncate">{bar.reason}</span>
      </button>
    );
  }

  return (
    <Tooltip
      variant="panel"
      label={
        drag ? null : (
          <div className="space-y-0.5">
            <div className="font-semibold text-ink">{bar.guestName}</div>
            <div className="text-ink-2">
              {bar.reference} · {STATUS[bar.status ?? '']?.label ?? bar.status}
            </div>
            <div className="text-ink-3">
              {bar.from} → {bar.to}
            </div>
            {bar.holdUntil && (
              <div className="font-semibold text-brass-ink">
                Hold releases{' '}
                {new Date(bar.holdUntil).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            )}
            <div>
              {daysBetween(bar.from, bar.to)} nights · {bar.adults ?? '—'} adults ·{' '}
              {bar.children ?? 0} children
            </div>
            {bar.groupId && <div>Group reservation · linked room segments</div>}
            {bar.vip && <div>VIP guest</div>}
            {bar.hasNotes && <div>Operational notes available</div>}
            {bar.amount !== undefined && (
              <div>
                Stay total: {bar.amount} · Balance: {bar.balance}
              </div>
            )}
            {bar.balanceDue && <div className="font-semibold text-closed-ink">Payment pending</div>}
          </div>
        )
      }
    >
      <div
        draggable={
          (canMove || canChangeDates) &&
          ['Approved', 'Pending', 'CheckedIn'].includes(bar.status ?? '')
        }
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-yohobed-leg', bar.id);
          event.dataTransfer.effectAllowed = 'move';
          setDrag(bar, event.clientX);
        }}
        onDragEnd={() => setDrag(null)}
        data-booking-id={bar.bookingId}
        data-leg-id={bar.id}
        data-match={matches}
        data-selected={bar.bookingId === selectedId}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-1 h-[calc(100%-8px)] text-xs font-semibold shadow-sm',
          bar.holdUntil && 'ring-2 ring-inset ring-brass',
          !matches && 'opacity-25',
          bar.bookingId === selectedId && 'ring-2 ring-offset-2 ring-brass z-10',
          drag?.id === bar.id && 'opacity-50',
          g.startsBefore ? 'rounded-l-none' : 'rounded-l',
          g.endsAfter ? 'rounded-r-none' : 'rounded-r',
        )}
        style={{ left: g.left + 2, width: g.width }}
      >
        <button
          type="button"
          onClick={() => onSelect(bar)}
          className={cn(
            'absolute inset-0 flex items-center gap-1.5 overflow-hidden px-2 text-left transition hover:brightness-110',
            barTone(bar),
            g.startsBefore ? 'rounded-l-none' : 'rounded-l',
            g.endsAfter ? 'rounded-r-none' : 'rounded-r',
          )}
        >
          {preferences.sources && (
            <span className="shrink-0 rounded bg-black/25 px-1 text-[10px] uppercase leading-4">
              {SOURCE_LABEL[bar.source ?? ''] ?? bar.source}
            </span>
          )}
          <span className="min-w-0 truncate">
            {bar.guestName}
            {preferences.metadata && g.width > 190 && (
              <span className="ml-2 text-[10px] font-normal opacity-90">
                {STATUS[bar.status ?? '']?.label ?? bar.status}
              </span>
            )}
          </span>
          {preferences.metadata && bar.vip && <span title="VIP">★</span>}
          {preferences.metadata && bar.hasNotes && (
            <span title="Notes available" aria-label="Notes available">
              ≡
            </span>
          )}
          {preferences.metadata && bar.groupId && <span title="Group / linked stay">↔</span>}
          <span className="sr-only">
            {STATUS[bar.status ?? '']?.label} {bar.reference}
          </span>
          {bar.balanceDue && <span className="ml-auto shrink-0 text-[11px] opacity-90">$</span>}
        </button>
        {canResize && onResize && !g.endsAfter && (
          <button
            type="button"
            aria-label={`Resize ${bar.reference ?? 'reservation'} checkout`}
            title="Drag to change departure. Use Left or Right arrow for one day."
            className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize rounded-r border-l border-white/40 bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resizeStart.current = { x: event.clientX, checkout: bar.to };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const start = resizeStart.current;
              resizeStart.current = null;
              if (!start) return;
              resizeBy(Math.round((event.clientX - start.x) / COL_W));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              event.stopPropagation();
              resizeBy(event.key === 'ArrowRight' ? 1 : -1);
            }}
          />
        )}
      </div>
    </Tooltip>
  );
});

/** The repeating column rule, drawn as a background so there is no per-cell DOM node. */
function gridBackground(dates: string[]): React.CSSProperties {
  return {
    width: dates.length * COL_W,
    backgroundImage: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${COL_W}px)`,
  };
}

function RoomTypeRow({
  rt,
  dates,
  onToggle,
  collapsed,
  showRates,
}: {
  rt: StayRoomType;
  dates: string[];
  onToggle: () => void;
  collapsed: boolean;
  showRates: boolean;
}) {
  return (
    <div className="flex border-b border-line bg-surface-2">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface-2 px-3 py-2"
        style={{ width: LABEL_W }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="truncate rounded text-left text-sm font-bold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          title={collapsed ? 'Expand group' : 'Collapse group'}
        >
          {collapsed ? '▸' : '▾'} {rt.name}
        </button>
        <span className="rounded bg-surface px-1.5 text-[11px] font-semibold text-ink-3">
          {rt.quantity}
        </span>
      </div>
      <div className="flex shrink-0" style={{ width: dates.length * COL_W }}>
        {showRates &&
          rt.perDate.map((d) => (
            <div
              key={d.date}
              className="flex shrink-0 flex-col items-center justify-center border-r border-line py-1"
              style={{ width: COL_W }}
            >
              <span
                className={cn(
                  'text-xs font-bold tabular-nums',
                  d.closed || d.available === 0 ? 'text-closed-ink' : 'text-ink-2',
                )}
              >
                {d.closed ? 'Closed' : (d.available ?? '—')}
              </span>
              <span className="font-mono text-[11px] tabular-nums text-ink-3">
                {d.rate ? Number(d.rate).toFixed(2) : '—'}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

export function TapeChart({
  data,
  onSelectBar,
  onSelectEmpty,
  onSelectEmptyRange,
  onProposeMove,
  onProposeResize,
  groupBy = 'category',
  density = 'comfortable',
  preferences = DEFAULT_PREFERENCES,
  filters = EMPTY_FILTERS,
  selectedId,
  search = '',
  today,
  onSelectUnit,
  onProposeDates,
  onFeedback,
  onUnassigned,
  canMove = false,
  canChangeDates = false,
  storageKey = '',
  locateId,
  collapseSignal,
  onRangeSelection,
  assignmentBar,
}: {
  data: StayView;
  onSelectBar: (bar: StayBar) => void;
  onSelectEmpty?: (unitId: string, date: string) => void;
  onSelectEmptyRange?: (unitId: string, from: string, to: string) => void;
  onProposeMove?: (bar: StayBar, toRoomUnitId: string) => void;
  onProposeResize?: (bar: StayBar, checkout: string) => void;
  groupBy?: 'category' | 'floor';
  density?: 'comfortable' | 'compact';
  preferences?: CalendarPreferences;
  filters?: CalendarFilters;
  selectedId?: string;
  search?: string;
  today?: string;
  onSelectUnit?: (unit: StayUnit) => void;
  onProposeDates?: (bar: StayBar, from: string, to: string) => void;
  onFeedback?: (message: string) => void;
  onUnassigned?: (date?: string) => void;
  canMove?: boolean;
  canChangeDates?: boolean;
  storageKey?: string;
  locateId?: string;
  collapseSignal?: { collapsed: boolean; nonce: number };
  onRangeSelection?: (range: { unitId: string; from: string; to: string } | null) => void;
  assignmentBar?: StayBar;
}) {
  const { dates } = data;
  const viewport = React.useRef<HTMLDivElement>(null);
  const [drag, setDragBar] = React.useState<StayBar | null>(null);
  const dragOrigin = React.useRef(0);
  const dragScroll = React.useRef(0);
  const [dropTarget, setDropTarget] = React.useState<{
    unitId: string;
    from: string;
    to: string;
    issue: string | null;
  } | null>(null);
  const setDrag = React.useCallback((bar: StayBar | null, x = 0) => {
    setDragBar(bar);
    dragOrigin.current = x;
    dragScroll.current = viewport.current?.scrollLeft ?? 0;
    if (!bar) setDropTarget(null);
  }, []);
  const presentation = React.useMemo(
    () => ({ preferences, filters, selectedId, search, canMove, canChangeDates, drag, setDrag }),
    [preferences, filters, selectedId, search, canMove, canChangeDates, drag, setDrag],
  );
  const scrollMemory = React.useRef({ top: 0, left: 0 });

  const rowHeight = density === 'compact' ? 32 : ROW_H;
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [range, setRange] = React.useState<{ unitId: string; start: number; end: number } | null>(
    null,
  );
  const rangeStart = React.useRef<{ unitId: string; index: number } | null>(null);
  const indexAt = (event: React.PointerEvent<HTMLDivElement>) =>
    Math.max(
      0,
      Math.min(
        dates.length - 1,
        Math.floor((event.clientX - event.currentTarget.getBoundingClientRect().left) / COL_W),
      ),
    );
  const groups = React.useMemo(() => {
    if (groupBy === 'category') return data.roomTypes;
    const byFloor = new Map<string, StayRoomType>();
    for (const category of data.roomTypes)
      for (const unit of category.units) {
        const floor = unit.floor?.trim() || 'Unassigned floor';
        let group = byFloor.get(floor);
        if (!group) {
          group = {
            roomId: `floor:${floor}`,
            name: floor === 'Unassigned floor' ? floor : `Floor ${floor}`,
            quantity: 0,
            perDate: [],
            units: [],
          };
          byFloor.set(floor, group);
        }
        group.units.push(unit);
        group.quantity++;
      }
    return [...byFloor.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }, [data.roomTypes, groupBy]);

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      setCollapsed(new Set(JSON.parse(sessionStorage.getItem(`${storageKey}:groups`) ?? '[]')));
      const scroll = JSON.parse(sessionStorage.getItem(`${storageKey}:scroll`) ?? 'null');
      if (scroll && viewport.current) viewport.current.scrollTo(scroll.left, scroll.top);
    } catch {
      onFeedback?.('Calendar view state could not be restored.');
    }
    return () => {
      try {
        sessionStorage.setItem(`${storageKey}:scroll`, JSON.stringify(scrollMemory.current));
      } catch {
        /* The active calendar remains usable without browser storage. */
      }
    };
  }, [storageKey]);
  React.useEffect(() => {
    if (collapseSignal)
      setCollapsed(
        collapseSignal.collapsed ? new Set(groups.map((group) => group.roomId)) : new Set(),
      );
  }, [collapseSignal]);
  React.useEffect(() => {
    if (!locateId) return;
    setCollapsed(new Set());
    const frame = requestAnimationFrame(() => {
      const target = Array.from(
        viewport.current?.querySelectorAll<HTMLElement>('[data-leg-id], [data-unit-id]') ?? [],
      ).find(
        (element) => element.dataset.legId === locateId || element.dataset.unitId === locateId,
      );
      target?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      target?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [locateId]);
  const saveCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    try {
      if (storageKey) sessionStorage.setItem(`${storageKey}:groups`, JSON.stringify([...next]));
    } catch {
      onFeedback?.('Group preferences could not be saved.');
    }
  };
  const propose = (unit: StayUnit, event: React.DragEvent<HTMLDivElement>) => {
    if (!drag) return null;
    const originUnit = data.roomTypes
      .flatMap((group) => group.units)
      .find((item) => item.bars.some((bar) => bar.id === drag.id));
    const sameRow = originUnit?.id === unit.id;
    const offset = sameRow
      ? Math.round(
          (event.clientX -
            dragOrigin.current +
            (viewport.current?.scrollLeft ?? 0) -
            dragScroll.current) /
            COL_W,
        )
      : 0;
    const from = addDays(drag.from, offset),
      to = addDays(drag.to, offset);
    const issue =
      offset && (!canChangeDates || drag.source === 'OTA' || drag.status === 'CheckedIn')
        ? 'This stay cannot be shifted. Use the reservation panel for permitted changes.'
        : !sameRow && !canMove
          ? 'Room assignment permission is required.'
          : destinationIssue(drag, unit, from, to);
    return { unitId: unit.id, from, to, issue };
  };

  return (
    <PresentationContext.Provider value={presentation}>
      <div
        ref={viewport}
        onScroll={(event) => {
          scrollMemory.current = {
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft,
          };
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setRange(null);
            onRangeSelection?.(null);
            rangeStart.current = null;
            setDrag(null);
          }
        }}
        className="calendar-viewport max-h-[72vh] overflow-auto"
        role="region"
        aria-label="Stay calendar"
        tabIndex={0}
      >
        <div style={{ width: LABEL_W + dates.length * COL_W }}>
          {/* Date header */}
          <div className="sticky top-0 z-20 flex border-b border-line bg-surface shadow-sm">
            <div
              className="sticky left-0 z-20 shrink-0 border-r border-line bg-surface"
              style={{ width: LABEL_W }}
            >
              <span className="block px-3 py-4 text-xs font-semibold text-ink-3">
                Rooms / {density}
              </span>
            </div>
            {dates.map((d) => {
              const day = new Date(`${d}T00:00:00Z`);
              const weekend = [0, 6].includes(day.getUTCDay());
              return (
                <div
                  key={d}
                  className={cn(
                    'shrink-0 border-r border-line py-1.5 text-center',
                    weekend && 'bg-surface-2',
                    d === today && 'calendar-today',
                  )}
                  style={{ width: COL_W }}
                >
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">
                    {day.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })}
                  </div>
                  <div
                    className="text-sm font-bold text-ink"
                    aria-current={d === today ? 'date' : undefined}
                  >
                    {day.toLocaleDateString('en', {
                      day: '2-digit',
                      month: 'short',
                      timeZone: 'UTC',
                    })}
                  </div>
                  {preferences.statistics && (
                    <div className="text-[10px] tabular-nums text-ink-3">
                      {data.footer.find((item) => item.date === d)?.occupancyPct ?? 0}% occ ·{' '}
                      {data.footer.find((item) => item.date === d)?.availableInventory ?? 0} free
                    </div>
                  )}
                  {data.unassigned.some((bar) => bar.from <= d && d < bar.to) && (
                    <button
                      className="rounded bg-low-soft px-1 text-[10px] text-low-ink"
                      onClick={() => onUnassigned?.(d)}
                      aria-label={`Unassigned on ${d}`}
                    >
                      {data.unassigned.filter((bar) => bar.from <= d && d < bar.to).length}{' '}
                      unassigned
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Room types and their rooms */}
          {groups.map((rt) => (
            <div key={rt.roomId}>
              <RoomTypeRow
                rt={rt}
                dates={dates}
                showRates={groupBy === 'category' && preferences.statistics}
                collapsed={collapsed.has(rt.roomId)}
                onToggle={() =>
                  (() => {
                    const next = new Set(collapsed);
                    if (next.has(rt.roomId)) next.delete(rt.roomId);
                    else next.add(rt.roomId);
                    saveCollapsed(next);
                  })()
                }
              />
              {!collapsed.has(rt.roomId) &&
                rt.units.map((u) => (
                  <div
                    key={u.id}
                    className="flex border-b border-line"
                    style={{
                      contentVisibility: 'auto',
                      containIntrinsicSize: `auto ${rowHeight}px`,
                    }}
                  >
                    <div
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3"
                      style={{ width: LABEL_W, height: rowHeight }}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectUnit?.(u)}
                        aria-label={`Room ${u.code} details`}
                        className="rounded font-mono text-sm font-semibold text-ink hover:underline"
                      >
                        {u.code}
                      </button>
                      {u.displayName && (
                        <span className="min-w-0 truncate text-xs text-ink-2" title={u.displayName}>
                          {u.displayName}
                        </span>
                      )}
                      {u.floor && <span className="text-[11px] text-ink-3">fl {u.floor}</span>}
                      {preferences.housekeeping && u.housekeeping === 'dirty' && (
                        <span
                          className="ml-auto h-2 w-2 shrink-0 rounded-full bg-closed"
                          title="Dirty — clean before check-in"
                          aria-label="Dirty room"
                        />
                      )}
                      {preferences.housekeeping && u.housekeeping === 'clean' && (
                        <span
                          className="ml-auto h-2 w-2 shrink-0 rounded-full bg-avail"
                          title="Clean"
                          aria-label="Clean room"
                        />
                      )}
                      {preferences.housekeeping && u.housekeeping === 'inspected' && (
                        <span
                          className="ml-auto text-xs text-avail-ink"
                          title="Inspected"
                          aria-label="Inspected room"
                        >
                          ✓
                        </span>
                      )}
                      {u.status === 'inactive' && (
                        <Tooltip label="Out of service">
                          <Prohibit size={13} className="ml-auto text-closed-ink" />
                        </Tooltip>
                      )}
                    </div>
                    {/* One relatively-positioned strip per room, with the grid drawn as a background
                    and bars placed absolutely. 40 rooms x 90 days would be 3,600 cell elements
                    if each day were a node; this way it is 40. */}
                    <div
                      className="relative shrink-0"
                      style={{ ...gridBackground(dates), height: rowHeight }}
                      data-unit-id={u.id}
                      data-unit-code={u.code}
                      tabIndex={0}
                      role="group"
                      aria-label={`Select nights for room ${u.code}`}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                          event.preventDefault();
                          const current = range?.unitId === u.id ? range.end : 0;
                          const end = Math.max(
                            0,
                            Math.min(
                              dates.length - 1,
                              current + (event.key === 'ArrowRight' ? 1 : -1),
                            ),
                          );
                          setRange({
                            unitId: u.id,
                            start: event.shiftKey && range?.unitId === u.id ? range.start : end,
                            end,
                          });
                        }
                        if (event.key === 'Enter' && onSelectEmptyRange) {
                          event.preventDefault();
                          const start =
                            range?.unitId === u.id ? Math.min(range.start, range.end) : 0;
                          const end = range?.unitId === u.id ? Math.max(range.start, range.end) : 0;
                          const from = dates[start]!,
                            to = dates[end + 1] ?? data.to;
                          if (u.bars.some((bar) => bar.from < to && from < bar.to))
                            onFeedback?.('Choose empty nights for a new reservation or block.');
                          else onSelectEmptyRange(u.id, from, to);
                        }
                        if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                          event.preventDefault();
                          const rows = Array.from(
                            viewport.current?.querySelectorAll<HTMLElement>('[data-unit-id]') ?? [],
                          );
                          rows[
                            rows.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)
                          ]?.focus();
                        }
                      }}
                      title="Double-click an empty night to reserve this room"
                      onDoubleClick={(e) => {
                        if (!onSelectEmpty) return;
                        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                        const idx = Math.floor(x / COL_W);
                        const date = dates[idx];
                        if (date && !u.bars.some((bar) => bar.from <= date && date < bar.to))
                          onSelectEmpty(u.id, date);
                      }}
                      onPointerDown={(event) => {
                        if (
                          !onSelectEmptyRange ||
                          event.button !== 0 ||
                          event.target !== event.currentTarget
                        )
                          return;
                        const index = indexAt(event);
                        rangeStart.current = { unitId: u.id, index };
                        setRange({ unitId: u.id, start: index, end: index });
                        onRangeSelection?.({
                          unitId: u.id,
                          from: dates[index]!,
                          to: dates[index + 1] ?? data.to,
                        });
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        if (rangeStart.current?.unitId === u.id)
                          setRange({
                            unitId: u.id,
                            start: rangeStart.current.index,
                            end: indexAt(event),
                          });
                      }}
                      onPointerUp={(event) => {
                        const start = rangeStart.current;
                        rangeStart.current = null;
                        if (!start || start.unitId !== u.id || !onSelectEmptyRange) return;
                        const end = indexAt(event);
                        if (end === start.index) return; // Single click selects; Enter or toolbar Quick actions continues.
                        const first = Math.min(start.index, end);
                        const last = Math.max(start.index, end);
                        const from = dates[first]!;
                        const to = dates[last + 1] ?? data.to;
                        if (u.bars.some((bar) => bar.from < to && from < bar.to)) return;
                        onSelectEmptyRange(u.id, from, to);
                      }}
                      onDragOver={(event) => {
                        if (!drag) return;
                        event.preventDefault();
                        const next = propose(u, event);
                        setDropTarget(next);
                        event.dataTransfer.dropEffect = next?.issue ? 'none' : 'move';
                        const box = viewport.current?.getBoundingClientRect();
                        if (box && viewport.current) {
                          if (event.clientY > box.bottom - 40) viewport.current.scrollTop += 12;
                          if (event.clientY < box.top + 70) viewport.current.scrollTop -= 12;
                          if (event.clientX > box.right - 40) viewport.current.scrollLeft += 12;
                          if (event.clientX < box.left + LABEL_W + 20)
                            viewport.current.scrollLeft -= 12;
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const next = propose(u, event);
                        if (!drag || !next) return;
                        if (next.issue) onFeedback?.(next.issue);
                        else if (next.from !== drag.from)
                          onProposeDates?.(drag, next.from, next.to);
                        else onProposeMove?.(drag, u.id);
                        setDrag(null);
                      }}
                    >
                      {assignmentBar && !destinationIssue(assignmentBar, u) && (
                        <div className="pointer-events-none absolute inset-0 border-2 border-avail bg-avail/5">
                          <span className="absolute right-2 top-1 text-[10px] text-avail-ink">
                            Available for assignment
                          </span>
                        </div>
                      )}
                      {dropTarget?.unitId === u.id && (
                        <div
                          className={cn(
                            'pointer-events-none absolute inset-0 z-20 border-2',
                            dropTarget.issue
                              ? 'border-closed bg-closed/10'
                              : 'border-avail bg-avail/10',
                          )}
                        >
                          <span className="absolute left-2 top-0 rounded bg-surface px-2 text-xs text-ink">
                            {dropTarget.issue ??
                              (preferences.snap
                                ? `${dropTarget.from} → ${dropTarget.to} · ${daysBetween(dropTarget.from, dropTarget.to)} nights`
                                : 'Release to review move')}
                          </span>
                        </div>
                      )}
                      {range?.unitId === u.id && (
                        <div
                          className="pointer-events-none absolute inset-y-0 bg-brand/20"
                          style={{
                            left: Math.min(range.start, range.end) * COL_W,
                            width: (Math.abs(range.end - range.start) + 1) * COL_W,
                          }}
                        />
                      )}
                      {u.bars.map((b) => (
                        <Bar
                          key={`${b.kind}-${b.id}`}
                          bar={b}
                          dates={dates}
                          onSelect={onSelectBar}
                          onResize={onProposeResize}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ))}

          {/* Unassigned — Yanolja's "Default Unmapped Room" row, one line per overlapping stay */}
          {data.unassigned.length > 0 && (
            <StackedLane
              label="Unassigned"
              bars={data.unassigned}
              dates={dates}
              onSelect={onSelectBar}
              onResize={onProposeResize}
              tone="low"
            />
          )}

          {/* Tentative — inquiries hold no room; they are shown, never counted */}
          {(data.tentative?.length ?? 0) > 0 && (
            <StackedLane
              label="Tentative"
              bars={data.tentative!}
              dates={dates}
              onSelect={onSelectBar}
              onResize={onProposeResize}
              tone="info"
            />
          )}

          {/* Sticky metric footer */}
          {preferences.statistics &&
            (
              [
                ['Available inventory', (f: StayView['footer'][number]) => f.availableInventory],
                ['Occupancy', (f: StayView['footer'][number]) => `${f.occupancyPct}%`],
              ] as const
            ).map(([label, get]) => (
              <div key={label} className="flex border-b border-line bg-surface-2 last:border-b-0">
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-2"
                  style={{ width: LABEL_W }}
                >
                  {label}
                </div>
                {data.footer.map((f) => (
                  <div
                    key={f.date}
                    className="flex shrink-0 items-center justify-center gap-1.5 border-r border-line py-2"
                    style={{ width: COL_W }}
                  >
                    {label === 'Occupancy' && (
                      <span
                        className="h-1.5 w-6 overflow-hidden rounded-full"
                        style={{ background: 'var(--line-strong)' }}
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${f.occupancyPct}%`,
                            background:
                              f.occupancyPct >= 90
                                ? 'var(--closed-ink)'
                                : f.occupancyPct >= 60
                                  ? 'var(--low-ink)'
                                  : 'var(--avail-ink)',
                          }}
                        />
                      </span>
                    )}
                    <span className="font-mono text-xs tabular-nums text-ink">{get(f)}</span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </PresentationContext.Provider>
  );
}
