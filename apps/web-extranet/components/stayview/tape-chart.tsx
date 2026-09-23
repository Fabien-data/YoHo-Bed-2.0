'use client';

import * as React from 'react';
import { Prohibit, Wrench } from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';
import type { StayBar, StayRoomType, StayView } from '@/lib/api';

export const COL_W = 92;
export const ROW_H = 40;
export const LABEL_W = 200;

/** Colour a bar by what the front desk needs to see at a glance, the way Yanolja does. */
function barTone(bar: StayBar): string {
  if (bar.kind === 'block') return 'bg-ink-3 text-white';
  switch (bar.status) {
    case 'CheckedIn':
      return 'bg-avail text-white';
    case 'CheckedOut':
      return 'bg-ink-3 text-white';
    case 'Pending':
      return 'bg-low text-white';
    case 'NoShow':
    case 'Cancelled':
      return 'bg-closed text-white';
    default:
      return 'bg-brand text-white';
  }
}

const SOURCE_LABEL: Record<string, string> = {
  Extranet: 'Direct',
  OTA: 'OTA',
  Backend: 'YoHo',
};

/** Index of a date within the window; -1 when outside it. */
function dayIndex(dates: string[], date: string): number {
  return dates.indexOf(date);
}

/**
 * Geometry for one bar, clipped to the window.
 *
 * A stay that starts before the window or ends after it still has to draw — clipped, with the cut
 * edge squared off so it reads as "continues beyond here" rather than as a short stay.
 */
function barGeometry(dates: string[], bar: StayBar) {
  const first = dates[0]!;
  const lastExclusive = dates[dates.length - 1]!;
  const startsBefore = bar.from < first;
  // `to` is exclusive; the last drawn night is the day before it.
  const endsAfter = bar.to > lastExclusive;

  const startIdx = startsBefore ? 0 : dayIndex(dates, bar.from);
  const endIdx = endsAfter ? dates.length : dayIndex(dates, bar.to);
  const span = (endIdx < 0 ? dates.length : endIdx) - (startIdx < 0 ? 0 : startIdx);

  return {
    left: Math.max(startIdx, 0) * COL_W,
    width: Math.max(span, 1) * COL_W - 4,
    startsBefore,
    endsAfter,
  };
}

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

function Bar({
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
  const resizeStart = React.useRef<{ x: number; checkout: string } | null>(null);
  const canResize =
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
        <div className="space-y-0.5">
          <div className="font-semibold text-ink">{bar.guestName}</div>
          <div className="text-ink-2">
            {bar.reference} · {bar.status}
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
          {bar.balanceDue && <div className="font-semibold text-closed-ink">Payment pending</div>}
        </div>
      }
    >
      <div
        draggable={bar.status !== 'CheckedOut' && bar.status !== 'Cancelled'}
        onDragStart={(event) => event.dataTransfer.setData('application/x-yohobed-leg', bar.id)}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-1 h-[calc(100%-8px)] text-xs font-semibold shadow-sm',
          bar.holdUntil && 'ring-2 ring-inset ring-brass',
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
          <span className="shrink-0 rounded bg-black/25 px-1 text-[10px] uppercase leading-4">
            {SOURCE_LABEL[bar.source ?? ''] ?? bar.source}
          </span>
          <span className="truncate">{bar.guestName}</span>
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
}

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
}: {
  data: StayView;
  onSelectBar: (bar: StayBar) => void;
  onSelectEmpty?: (unitId: string, date: string) => void;
  onSelectEmptyRange?: (unitId: string, from: string, to: string) => void;
  onProposeMove?: (bar: StayBar, toRoomUnitId: string) => void;
  onProposeResize?: (bar: StayBar, checkout: string) => void;
  groupBy?: 'category' | 'floor';
  density?: 'comfortable' | 'compact';
}) {
  const { dates } = data;
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

  return (
    <div
      className="max-h-[72vh] overflow-auto"
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
          />
          {dates.map((d) => {
            const day = new Date(`${d}T00:00:00Z`);
            const weekend = [0, 6].includes(day.getUTCDay());
            return (
              <div
                key={d}
                className={cn(
                  'shrink-0 border-r border-line py-1.5 text-center',
                  weekend && 'bg-surface-2',
                )}
                style={{ width: COL_W }}
              >
                <div className="text-[11px] uppercase tracking-wide text-ink-3">
                  {day.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })}
                </div>
                <div className="text-sm font-bold text-ink">
                  {day.toLocaleDateString('en', {
                    day: '2-digit',
                    month: 'short',
                    timeZone: 'UTC',
                  })}
                </div>
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
              showRates={groupBy === 'category'}
              collapsed={collapsed.has(rt.roomId)}
              onToggle={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (next.has(rt.roomId)) next.delete(rt.roomId);
                  else next.add(rt.roomId);
                  return next;
                })
              }
            />
            {!collapsed.has(rt.roomId) &&
              rt.units.map((u) => (
                <div
                  key={u.id}
                  className="flex border-b border-line"
                  style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${rowHeight}px` }}
                >
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3"
                    style={{ width: LABEL_W, height: rowHeight }}
                  >
                    <span className="font-mono text-sm font-semibold text-ink">{u.code}</span>
                    {u.displayName && (
                      <span className="min-w-0 truncate text-xs text-ink-2" title={u.displayName}>
                        {u.displayName}
                      </span>
                    )}
                    {u.floor && <span className="text-[11px] text-ink-3">fl {u.floor}</span>}
                    {u.housekeeping === 'dirty' && (
                      <span
                        className="ml-auto h-2 w-2 shrink-0 rounded-full bg-closed"
                        title="Dirty — clean before check-in"
                        aria-label="Dirty room"
                      />
                    )}
                    {u.housekeeping === 'clean' && (
                      <span
                        className="ml-auto h-2 w-2 shrink-0 rounded-full bg-avail"
                        title="Clean"
                        aria-label="Clean room"
                      />
                    )}
                    {u.housekeeping === 'inspected' && (
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
                    title="Double-click an empty night to reserve this room"
                    onDoubleClick={(e) => {
                      if (!onSelectEmpty) return;
                      const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                      const idx = Math.floor(x / COL_W);
                      const date = dates[idx];
                      if (date) onSelectEmpty(u.id, date);
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
                      setRange(null);
                      if (!start || start.unitId !== u.id || !onSelectEmptyRange) return;
                      const end = indexAt(event);
                      if (end === start.index) return;
                      const first = Math.min(start.index, end);
                      const last = Math.max(start.index, end);
                      const from = dates[first]!;
                      const to = dates[last + 1] ?? data.to;
                      if (u.bars.some((bar) => bar.from < to && from < bar.to)) return;
                      onSelectEmptyRange(u.id, from, to);
                    }}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes('application/x-yohobed-leg'))
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const legId = event.dataTransfer.getData('application/x-yohobed-leg');
                      const bar =
                        data.roomTypes
                          .flatMap((group) => group.units.flatMap((unit) => unit.bars))
                          .find((item) => item.kind === 'booking' && item.id === legId) ??
                        data.unassigned.find((item) => item.id === legId);
                      if (bar && onProposeMove) onProposeMove(bar, u.id);
                    }}
                  >
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
        {(
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
  );
}
