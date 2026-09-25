'use client';

import * as React from 'react';
import {
  ArrowsLeftRight,
  CaretDown,
  ChatCircleText,
  Crown,
  CurrencyCircleDollar,
  Prohibit,
  SignIn,
  SignOut,
  UsersThree,
} from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';
import type { StayBar, StayUnit, StayView } from '@/lib/api';
import {
  addDays,
  dayOfMonth,
  isWeekend,
  monthShort,
  nightsLabel,
  stayRange,
  weekday,
} from './model/dates';
import {
  barSpan,
  barTier,
  stackBars,
  METRICS,
  type BarSpan,
  type Density,
  type RoomGroup,
} from './model/layout';
import { HK_META, STATE_META, barSummary, sourceLabel, stateOf } from './model/status';
import type { CalendarPreferences } from './model/prefs';
import type { DayStats } from './model/stats';
import { HK_ICON, STATE_ICON, sourceIcon } from './icons';
import { useInteraction, useInteractionStore } from './interaction/store';
import {
  useGridGestures,
  type GestureHandlers,
  type GridModel,
} from './interaction/use-grid-gestures';

/** Callbacks the rows need, behind one stable object so a row never re-renders for them. */
interface GridCallbacks {
  openBar: (bar: StayBar) => void;
  openUnit: (unit: StayUnit) => void;
  resizeBy: (bar: StayBar, nights: number) => void;
  unassignedOn: (date: string) => void;
  toggleGroup: (key: string) => void;
}
const CallbacksContext = React.createContext<React.MutableRefObject<GridCallbacks> | null>(null);
function useCallbacks() {
  return React.useContext(CallbacksContext)!;
}

interface BarDisplay {
  sources: boolean;
  details: boolean;
  colorBy: CalendarPreferences['colorBy'];
}

/* ------------------------------------------------------------------------------------------ */
/* Bars                                                                                        */
/* ------------------------------------------------------------------------------------------ */

const StayBarView = React.memo(function StayBarView({
  bar,
  span,
  colW,
  display,
  unassigned,
  canResize,
}: {
  bar: StayBar;
  span: BarSpan;
  colW: number;
  display: BarDisplay;
  unassigned?: boolean;
  canResize: boolean;
}) {
  const cb = useCallbacks();
  const state = stateOf(bar);
  const Icon = STATE_ICON[state];
  const width = span.span * colW - 4;
  const tier = barTier(width);
  const isBlock = bar.kind === 'block';
  const name = isBlock ? (bar.reason ?? STATE_META[state].label) : (bar.guestName ?? 'Guest');
  const pax = (bar.adults ?? 0) + (bar.children ?? 0);
  const Source = sourceIcon(bar);
  const split = (bar.segment?.of ?? 1) > 1;
  const ariaLabel = `${barSummary(bar)}, ${stayRange(bar.from, bar.to)}`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className="sv-bar"
      data-bar-id={bar.id}
      data-booking-id={bar.bookingId}
      data-state={state}
      data-arrival={!span.startsBefore}
      data-departure={!span.endsAfter}
      data-unassigned={unassigned || undefined}
      data-tone={display.colorBy === 'source' && bar.sourceColor ? bar.sourceColor : undefined}
      style={{
        left: `calc(var(--col-w) * ${span.start} + 2px)`,
        width: `calc(var(--col-w) * ${span.span} - 4px)`,
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cb.current.openBar(bar);
        }
      }}
    >
      {tier !== 'name' && <Icon size={13} weight="bold" aria-hidden className="shrink-0" />}
      {tier !== 'icon' && <span className="sv-bar-name">{name}</span>}
      {!isBlock && display.details && (tier === 'detail' || tier === 'full') && pax > 0 && (
        <span className="sv-bar-meta font-mono tabular-nums" aria-hidden>
          {pax}p
        </span>
      )}
      {!isBlock && display.sources && tier === 'full' && (
        <span className="sv-bar-meta inline-flex items-center gap-1" aria-hidden>
          <Source size={11} />
          {sourceLabel(bar)}
        </span>
      )}
      {!isBlock && display.details && (tier === 'detail' || tier === 'full') && (
        <span className="sv-bar-flags" aria-hidden>
          {bar.vip && <Crown size={12} weight="fill" />}
          {bar.hasNotes && <ChatCircleText size={12} weight="bold" />}
          {bar.groupId && <UsersThree size={12} weight="bold" />}
          {split && <ArrowsLeftRight size={12} weight="bold" />}
          {bar.balanceDue && <CurrencyCircleDollar size={12} weight="bold" />}
        </span>
      )}
      {canResize && !span.endsAfter && (
        <span
          role="button"
          tabIndex={0}
          data-resize
          className="sv-bar-resize"
          aria-label={`Resize ${bar.reference ?? 'reservation'} checkout`}
          title="Drag to change the departure. Left or Right arrow moves it a night."
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            e.stopPropagation();
            cb.current.resizeBy(bar, e.key === 'ArrowRight' ? 1 : -1);
          }}
        />
      )}
    </div>
  );
});

/* ------------------------------------------------------------------------------------------ */
/* Rows                                                                                        */
/* ------------------------------------------------------------------------------------------ */

interface RowGeometry {
  windowFrom: string;
  days: number;
  colW: number;
  rowH: number;
  labelW: number;
}

function UnitLabel({
  unit,
  showHk,
  density,
}: {
  unit: StayUnit;
  showHk: boolean;
  density: Density;
}) {
  const cb = useCallbacks();
  const Hk = HK_ICON[unit.housekeeping];
  const hk = HK_META[unit.housekeeping];
  // Guests leaving this room on the chips' day — their stay may be off screen (owner brief).
  const leaving = unit.departures ?? [];
  return (
    <button
      type="button"
      data-unit-label={unit.id}
      onClick={() => cb.current.openUnit(unit)}
      aria-label={`Room ${unit.code}${unit.displayName ? ` ${unit.displayName}` : ''}, ${hk.label}${leaving.length ? `, guest due out` : ''}. Open room details`}
      className="flex h-full w-full min-w-0 items-center gap-2 px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
    >
      <span className="font-mono text-[13px] font-semibold text-ink">{unit.code}</span>
      {unit.displayName && density === 'comfortable' && (
        <span className="min-w-0 truncate text-xs text-ink-2">{unit.displayName}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {unit.status !== 'active' && (
          <Tooltip label="Out of service">
            <Prohibit size={14} weight="bold" className="text-closed-ink" aria-hidden />
          </Tooltip>
        )}
        {leaving.length > 0 && (
          <Tooltip label={`Due out: ${leaving.map((d) => d.guestName).join(', ')}`}>
            <SignOut size={14} weight="bold" className="text-low-ink" data-due-out aria-hidden />
          </Tooltip>
        )}
        {showHk && (
          <Tooltip label={`${hk.label} — ${hk.hint}`}>
            <span
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-md',
                unit.housekeeping === 'dirty' && 'bg-low-soft text-low-ink',
                unit.housekeeping === 'clean' && 'text-avail-ink',
                unit.housekeeping === 'inspected' && 'bg-avail-soft text-avail-ink',
                unit.housekeeping === 'out_of_order' && 'bg-closed-soft text-closed-ink',
              )}
            >
              <Hk
                size={13}
                weight={unit.housekeeping === 'clean' ? 'regular' : 'bold'}
                aria-hidden
              />
            </span>
          </Tooltip>
        )}
      </span>
    </button>
  );
}

const UnitRow = React.memo(function UnitRow({
  unit,
  geo,
  display,
  showHk,
  density,
  resizable,
}: {
  unit: StayUnit;
  geo: RowGeometry;
  display: BarDisplay;
  showHk: boolean;
  density: Density;
  resizable: (bar: StayBar) => boolean;
}) {
  return (
    <div className="sv-row flex border-b border-line" style={{ height: geo.rowH }}>
      <div
        className="sv-label sticky left-0 z-10 shrink-0 border-r border-line bg-surface"
        style={{ width: geo.labelW }}
      >
        <UnitLabel unit={unit} showHk={showHk} density={density} />
      </div>
      <div
        className="sv-strip shrink-0"
        style={{ width: geo.days * geo.colW }}
        data-unit-id={unit.id}
        data-unit-code={unit.code}
      >
        {unit.bars.map((bar) => {
          const span = barSpan(geo.windowFrom, geo.days, bar);
          return span ? (
            <StayBarView
              key={`${bar.kind}-${bar.id}`}
              bar={bar}
              span={span}
              colW={geo.colW}
              display={display}
              canResize={resizable(bar)}
            />
          ) : null;
        })}
      </div>
    </div>
  );
});

function GroupBlock({
  group,
  collapsed,
  geo,
  display,
  showHk,
  showAvailability,
  density,
  groupH,
  resizable,
  showRates,
}: {
  group: RoomGroup;
  collapsed: boolean;
  geo: RowGeometry;
  display: BarDisplay;
  showHk: boolean;
  showAvailability: boolean;
  density: Density;
  groupH: number;
  resizable: (bar: StayBar) => boolean;
  showRates: boolean;
}) {
  const cb = useCallbacks();
  const perDate = group.roomType?.perDate ?? [];
  const large = group.units.length > 30;
  return (
    <div role="rowgroup" aria-label={group.name}>
      <div className="flex border-b border-line bg-surface-2" style={{ height: groupH }}>
        <div
          className="sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-surface-2"
          style={{ width: geo.labelW }}
        >
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={() => cb.current.toggleGroup(group.key)}
            className="flex h-full w-full min-w-0 items-center gap-1.5 px-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
          >
            <CaretDown
              size={13}
              weight="bold"
              aria-hidden
              className={cn(
                'shrink-0 text-ink-3 transition-transform duration-2 ease-smooth',
                collapsed && '-rotate-90',
              )}
            />
            <span className="truncate text-[13px] font-semibold text-ink">{group.name}</span>
            <span className="ml-auto rounded-md bg-surface px-1.5 font-mono text-[11px] tabular-nums text-ink-3">
              {group.units.length}
            </span>
          </button>
        </div>
        {showAvailability && group.roomType && (
          <div className="relative shrink-0" style={{ width: geo.days * geo.colW }} aria-hidden>
            {perDate.map((d, i) => (
              <div
                key={d.date}
                className="absolute inset-y-0 flex flex-col items-center justify-center border-r border-line"
                style={{ left: `calc(var(--col-w) * ${i})`, width: 'var(--col-w)' }}
              >
                <span
                  className={cn(
                    'font-mono text-xs font-semibold tabular-nums',
                    d.closed || d.available === 0 ? 'text-closed-ink' : 'text-ink-2',
                  )}
                >
                  {d.closed ? 'Closed' : (d.available ?? '—')}
                </span>
                {showRates && d.rate && geo.colW >= 64 && (
                  <span className="font-mono text-[10px] tabular-nums text-ink-3">
                    {Number(d.rate).toLocaleString('en', { maximumFractionDigits: 0 })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div
        className="sv-group-body"
        data-collapsed={collapsed}
        data-large={large || undefined}
        aria-hidden={collapsed || undefined}
        // A folded group's rooms must not be reachable by Tab (React 18 has no `inert` prop).
        ref={(el) => {
          el?.toggleAttribute('inert', collapsed);
        }}
      >
        <div>
          {/* Small groups stay mounted so folding can animate; large ones unmount when folded. */}
          {(!collapsed || !large) &&
            group.units.map((unit) => (
              <UnitRow
                key={unit.id}
                unit={unit}
                geo={geo}
                display={display}
                showHk={showHk}
                density={density}
                resizable={resizable}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function Lane({
  label,
  tone,
  bars,
  geo,
  display,
  resizable,
}: {
  label: string;
  tone: 'low' | 'info';
  bars: StayBar[];
  geo: RowGeometry;
  display: BarDisplay;
  resizable: (bar: StayBar) => boolean;
}) {
  const lines = stackBars(bars);
  return (
    <div
      className={cn('flex border-b border-line', tone === 'low' ? 'bg-low-soft' : 'bg-info-soft')}
      data-lane={label}
    >
      <div
        className={cn(
          'sticky left-0 z-10 flex shrink-0 items-start border-r border-line px-3 pt-3',
          tone === 'low' ? 'bg-low-soft' : 'bg-info-soft',
        )}
        style={{ width: geo.labelW, minHeight: geo.rowH }}
      >
        <span
          className={cn('text-xs font-semibold', tone === 'low' ? 'text-low-ink' : 'text-info-ink')}
        >
          {label} <span className="font-mono tabular-nums">({bars.length})</span>
        </span>
      </div>
      <div className="flex shrink-0 flex-col">
        {lines.map((line, i) => (
          <div
            key={i}
            className="sv-strip shrink-0"
            data-lane={label}
            style={{ width: geo.days * geo.colW, height: geo.rowH }}
          >
            {line.map((bar) => {
              const span = barSpan(geo.windowFrom, geo.days, bar);
              return span ? (
                <StayBarView
                  key={bar.id}
                  bar={bar}
                  span={span}
                  colW={geo.colW}
                  display={display}
                  unassigned={tone === 'low'}
                  canResize={resizable(bar)}
                />
              ) : null;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Header and footer                                                                          */
/* ------------------------------------------------------------------------------------------ */

const DateHeader = React.memo(function DateHeader({
  dates,
  stats,
  today,
  geo,
  showStats,
  headerRef,
  density,
}: {
  dates: string[];
  stats: DayStats[];
  today: string;
  geo: RowGeometry;
  showStats: boolean;
  headerRef: React.Ref<HTMLDivElement>;
  density: Density;
}) {
  const cb = useCallbacks();
  const roomy = geo.colW >= 64;
  const spacious = geo.colW >= 92;
  return (
    <div
      ref={headerRef}
      className="sticky top-0 z-30 flex border-b border-line-strong bg-surface"
      role="row"
    >
      <div
        className="sticky left-0 z-40 flex shrink-0 items-end border-r border-line bg-surface px-3 pb-2"
        style={{ width: geo.labelW }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Rooms</span>
      </div>
      {dates.map((d, i) => {
        const s = stats[i];
        const first = i === 0 || dayOfMonth(d) === 1;
        return (
          <div
            key={d}
            role="columnheader"
            aria-label={`${weekday(d)} ${dayOfMonth(d)} ${monthShort(d)}${d === today ? ', today' : ''}`}
            className={cn(
              'sv-date relative flex shrink-0 flex-col items-center justify-center border-r border-line text-center',
              density === 'compact' ? 'py-1' : 'py-1.5',
              isWeekend(d) && 'bg-surface-2',
            )}
            data-today={d === today}
            style={{ width: geo.colW }}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              {d === today ? 'Today' : weekday(d)}
            </span>
            <span className="text-sm font-semibold leading-tight text-ink">
              {dayOfMonth(d)}
              {(first || roomy) && (
                <span className="ml-0.5 text-[11px] font-medium text-ink-2">{monthShort(d)}</span>
              )}
            </span>
            {showStats && s && (
              <span
                className="mt-0.5 flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap px-1 font-mono text-[10px] tabular-nums text-ink-3"
                title={`${s.occupancyPct}% occupied · ${s.available} free · ${s.arrivals} arriving · ${s.departures} leaving`}
              >
                <span className={cn(s.occupancyPct >= 90 && 'font-semibold text-closed-ink')}>
                  {s.occupancyPct}%
                </span>
                {spacious && s.arrivals > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <SignIn size={10} weight="bold" aria-hidden />
                    {s.arrivals}
                  </span>
                )}
                {spacious && s.departures > 0 && (
                  <span className="inline-flex items-center gap-0.5">
                    <SignOut size={10} weight="bold" aria-hidden />
                    {s.departures}
                  </span>
                )}
              </span>
            )}
            {s && s.unassigned > 0 && (
              <button
                type="button"
                data-no-gesture
                onClick={() => cb.current.unassignedOn(d)}
                aria-label={`${s.unassigned} unassigned on ${dayOfMonth(d)} ${monthShort(d)}`}
                title={`${s.unassigned} stay${s.unassigned === 1 ? '' : 's'} without a room — open`}
                className="mt-0.5 min-w-[1rem] rounded-full bg-low px-1 font-mono text-[10px] font-semibold leading-[14px] tabular-nums text-white transition duration-1 hover:brightness-110"
              >
                {s.unassigned}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
});

function Footer({ data, geo }: { data: StayView; geo: RowGeometry }) {
  const rows: Array<[string, (f: StayView['footer'][number]) => React.ReactNode]> = [
    ['Available inventory', (f) => f.availableInventory],
    [
      'Occupancy',
      (f) => (
        <>
          <span className="h-1.5 w-6 overflow-hidden rounded-full bg-line-strong" aria-hidden>
            <span
              className={cn(
                'block h-full rounded-full',
                f.occupancyPct >= 90 ? 'bg-closed' : f.occupancyPct >= 60 ? 'bg-low' : 'bg-avail',
              )}
              style={{ width: `${f.occupancyPct}%` }}
            />
          </span>
          {f.occupancyPct}%
        </>
      ),
    ],
  ];
  return (
    <>
      {rows.map(([label, get]) => (
        <div key={label} className="flex border-b border-line bg-surface-2 last:border-b-0">
          <div
            className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-2"
            style={{ width: geo.labelW }}
          >
            {label}
          </div>
          {data.footer.map((f) => (
            <div
              key={f.date}
              className="flex shrink-0 items-center justify-center gap-1.5 border-r border-line py-2 font-mono text-xs tabular-nums text-ink"
              style={{ width: geo.colW }}
            >
              {get(f)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** Weekend and today columns, one element each for the whole body. */
function ColumnShading({
  dates,
  today,
  geo,
  flashToday,
}: {
  dates: string[];
  today: string;
  geo: RowGeometry;
  flashToday: number;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-0"
      style={{ left: geo.labelW }}
      aria-hidden
    >
      {dates.map((d, i) =>
        d === today ? (
          <div
            key={`${d}-${flashToday}`}
            className="sv-col-today absolute inset-y-0"
            data-flash={flashToday > 0 || undefined}
            style={{ left: `calc(var(--col-w) * ${i})`, width: 'var(--col-w)' }}
          />
        ) : isWeekend(d) ? (
          <div
            key={d}
            className="sv-col-weekend absolute inset-y-0"
            style={{ left: `calc(var(--col-w) * ${i})`, width: 'var(--col-w)' }}
          />
        ) : null,
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Interaction overlay: the range being selected and the drag ghost                            */
/* ------------------------------------------------------------------------------------------ */

function InteractionLayer({
  bodyRef,
  geo,
  unitCode,
}: {
  bodyRef: React.RefObject<HTMLDivElement>;
  geo: RowGeometry;
  unitCode: (id: string | null) => string | undefined;
}) {
  const range = useInteraction((s) => s.range);
  const drag = useInteraction((s) => s.drag);
  const body = bodyRef.current;
  if (!body) return null;
  const bodyTop = body.getBoundingClientRect().top;
  const topOf = (el: Element | null) => (el ? el.getBoundingClientRect().top - bodyTop : null);

  let rangeBox: React.ReactNode = null;
  if (range) {
    const strip = body.querySelector(`[data-unit-id="${CSS.escape(range.unitId)}"]`);
    const top = topOf(strip);
    if (top !== null) {
      const start = Math.min(range.start, range.end);
      const n = Math.abs(range.end - range.start) + 1;
      rangeBox = (
        <div
          className="sv-range"
          style={{
            top: top + 2,
            height: geo.rowH - 5,
            left: geo.labelW + start * geo.colW + 1,
            width: n * geo.colW - 2,
          }}
        />
      );
    }
  }

  let ghost: React.ReactNode = null;
  if (drag) {
    const source = body.querySelector(`[data-bar-id="${CSS.escape(drag.bar.id)}"]`);
    const target =
      drag.axis === 'y' && drag.unitId
        ? body.querySelector(`[data-unit-id="${CSS.escape(drag.unitId)}"]`)
        : (source?.parentElement ?? null);
    const top = topOf(target);
    const span = barSpan(geo.windowFrom, geo.days, drag);
    if (top !== null && span) {
      const state = stateOf(drag.bar);
      const Icon = STATE_ICON[state];
      const nights = Math.max(
        1,
        Math.round((Date.parse(drag.to) - Date.parse(drag.from)) / 86_400_000),
      );
      const readout =
        drag.axis === 'y'
          ? drag.unitId && drag.unitId !== drag.originUnitId
            ? `→ Room ${unitCode(drag.unitId) ?? ''}`
            : 'Drop on another room'
          : `${stayRange(drag.from, drag.to)} · ${nightsLabel(nights)}`;
      ghost = (
        <>
          <div
            className="sv-bar sv-ghost"
            data-state={state}
            data-arrival={!span.startsBefore}
            data-departure={!span.endsAfter}
            data-issue={!!drag.issue || undefined}
            style={{
              top: top + 4,
              height: geo.rowH - 8,
              left: geo.labelW + span.start * geo.colW + 2,
              width: span.span * geo.colW - 4,
            }}
          >
            <Icon size={13} weight="bold" aria-hidden className="shrink-0" />
            <span className="sv-bar-name">{drag.bar.guestName ?? drag.bar.reason}</span>
          </div>
          <div
            className={cn(
              'pointer-events-none absolute z-[7] max-w-xs rounded-lg px-2 py-1 text-xs font-semibold shadow-raised',
              drag.issue ? 'bg-closed text-white' : 'bg-brand text-white',
            )}
            role="status"
            aria-live="polite"
            style={{ top: Math.max(0, top - 26), left: geo.labelW + span.start * geo.colW + 2 }}
          >
            {drag.issue ?? readout}
          </div>
        </>
      );
    }
  }
  return (
    <>
      {rangeBox}
      {ghost}
    </>
  );
}

/** Hovering one segment of a split stay lights up the others (a subscriber of its own). */
function LinkedSegments({ viewport }: { viewport: React.RefObject<HTMLDivElement> }) {
  const hover = useInteraction((s) => s.hover);
  React.useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-linked]').forEach((el) => delete el.dataset.linked);
    const booking = hover?.bar.bookingId;
    if (booking && (hover.bar.segment?.of ?? 1) > 1)
      root
        .querySelectorAll<HTMLElement>(`[data-booking-id="${CSS.escape(booking)}"]`)
        .forEach((el) => (el.dataset.linked = 'true'));
  }, [hover, viewport]);
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* The grid                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface CalendarGridProps {
  data: StayView;
  groups: RoomGroup[];
  windowFrom: string;
  days: number;
  prefs: CalendarPreferences;
  stats: DayStats[];
  today: string;
  operatingDate: string;
  collapsed: ReadonlySet<string>;
  /** Stays that match the filters/search, or null when nothing is being filtered. */
  visibleIds: ReadonlySet<string> | null;
  selectedBookingId: string | null;
  /** Rooms that could take the stay picked in the Unassigned panel. */
  compatibleUnitIds: ReadonlySet<string> | null;
  /** Bumped to flash a bar (a new or located reservation) or the today column. */
  flash: { key: string; n: number } | null;
  flashToday: number;
  canAssign: boolean;
  canChangeDates: boolean;
  canCreate: boolean;
  handlers: GestureHandlers & {
    onOpenUnit: (unit: StayUnit) => void;
    onUnassignedOn: (date: string) => void;
    onToggleGroup: (key: string) => void;
  };
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onColumnWidth?: (colW: number) => void;
  scrollKey: string;
}

export function CalendarGrid(props: CalendarGridProps) {
  const {
    data,
    groups,
    windowFrom,
    days,
    prefs,
    stats,
    today,
    operatingDate,
    collapsed,
    visibleIds,
    selectedBookingId,
    compatibleUnitIds,
    flash,
    flashToday,
    handlers,
  } = props;
  const viewport = React.useRef<HTMLDivElement>(null);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);
  const store = useInteractionStore();
  const density = prefs.density;
  const metrics = METRICS[density];

  // Fit the window to the space available (Cloudbeds' responsive grid).
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = Math.floor((width - metrics.label - 2) / days);
  const colW = width ? Math.max(metrics.minCol, Math.min(196, fit)) : metrics.minCol;
  React.useEffect(() => props.onColumnWidth?.(colW), [colW, props.onColumnWidth]);

  const geo = React.useMemo<RowGeometry>(
    () => ({ windowFrom, days, colW, rowH: metrics.row, labelW: metrics.label }),
    [windowFrom, days, colW, metrics.row, metrics.label],
  );
  const display = React.useMemo<BarDisplay>(
    () => ({ sources: prefs.sources, details: prefs.barDetails, colorBy: prefs.colorBy }),
    [prefs.sources, prefs.barDetails, prefs.colorBy],
  );

  const units = React.useMemo(() => data.roomTypes.flatMap((rt) => rt.units), [data.roomTypes]);
  const barsById = React.useMemo(() => {
    const map = new Map<string, StayBar>();
    for (const u of units) for (const b of u.bars) map.set(b.id, b);
    for (const b of data.unassigned) map.set(b.id, b);
    for (const b of data.tentative ?? []) map.set(b.id, b);
    return map;
  }, [units, data.unassigned, data.tentative]);
  const unitsById = React.useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);

  const resizable = React.useCallback(
    (bar: StayBar) =>
      props.canChangeDates &&
      bar.kind === 'booking' &&
      bar.source !== 'OTA' &&
      (bar.status === 'CheckedIn' ||
        ((bar.status === 'Approved' || bar.status === 'Pending') &&
          (bar.segment?.of ?? 1) === 1)) &&
      !(bar.status === 'CheckedIn' && bar.to <= operatingDate),
    [props.canChangeDates, operatingDate],
  );

  const model: GridModel = {
    windowFrom,
    days,
    colW,
    today,
    operatingDate,
    barsById,
    unitsById,
    canAssign: props.canAssign,
    canChangeDates: props.canChangeDates,
    canCreate: props.canCreate,
  };
  const gestures = useGridGestures(viewport, store, model, handlers, {
    headerHeight: headerRef.current?.offsetHeight ?? 60,
    labelWidth: metrics.label,
  });

  const callbacks = React.useRef<GridCallbacks>(null!);
  callbacks.current = {
    openBar: handlers.onOpenBar,
    openUnit: handlers.onOpenUnit,
    resizeBy: (bar, nights) => {
      const to = addDays(bar.to, nights);
      if (to > bar.from) handlers.onProposeResize(bar, to);
    },
    unassignedOn: handlers.onUnassignedOn,
    toggleGroup: handlers.onToggleGroup,
  };

  // Highlights that change without re-rendering rows: dimming, selection and compatible rooms,
  // written to the DOM whenever they or the bars change.
  React.useLayoutEffect(() => {
    const root = viewport.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-bar-id]').forEach((el) => {
      const id = el.dataset.barId!;
      const booking = el.dataset.bookingId;
      if (visibleIds && !visibleIds.has(id)) el.dataset.dim = 'true';
      else delete el.dataset.dim;
      if (selectedBookingId && booking === selectedBookingId) el.dataset.selected = 'true';
      else delete el.dataset.selected;
    });
    root.querySelectorAll<HTMLElement>('[data-unit-id]').forEach((el) => {
      if (compatibleUnitIds?.has(el.dataset.unitId!)) el.dataset.compatible = 'true';
      else delete el.dataset.compatible;
    });
  }, [data, groups, collapsed, visibleIds, selectedBookingId, compatibleUnitIds, colW]);

  // Flash a located or newly created stay, scrolling it into view first.
  React.useEffect(() => {
    const root = viewport.current;
    if (!root || !flash) return;
    const el =
      root.querySelector<HTMLElement>(`[data-booking-id="${CSS.escape(flash.key)}"]`) ??
      root.querySelector<HTMLElement>(`[data-bar-id="${CSS.escape(flash.key)}"]`) ??
      root.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(flash.key)}"]`);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const header = headerRef.current?.offsetHeight ?? 60;
    const r = el.getBoundingClientRect();
    const v = root.getBoundingClientRect();
    const top = root.scrollTop + (r.top - v.top) - header - (v.height - header) / 2 + r.height / 2;
    const left = root.scrollLeft + (r.left - v.left) - metrics.label - 24;
    root.scrollTo({
      top: Math.max(0, top),
      left: Math.max(0, left),
      behavior: reduce ? 'auto' : 'smooth',
    });
    if (el.dataset.barId) {
      delete el.dataset.flash;
      void el.offsetWidth; // restart the animation
      el.dataset.flash = 'true';
      const t = window.setTimeout(() => delete el.dataset.flash, 1200);
      return () => window.clearTimeout(t);
    }
  }, [flash, metrics.label]);

  // Remember where the desk was scrolled, per property and window size.
  React.useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(`sv-scroll:${props.scrollKey}`) ?? 'null');
      if (saved) root.scrollTo(saved.left, saved.top);
    } catch {
      /* Scroll memory is a convenience; the calendar works without storage. */
    }
    let t: number | undefined;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          sessionStorage.setItem(
            `sv-scroll:${props.scrollKey}`,
            JSON.stringify({ top: root.scrollTop, left: root.scrollLeft }),
          );
        } catch {
          /* ignored: storage full or blocked */
        }
      }, 150);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => root.removeEventListener('scroll', onScroll);
  }, [props.scrollKey]);

  const unitCode = React.useCallback(
    (id: string | null) => (id ? unitsById.get(id)?.code : undefined),
    [unitsById],
  );
  const showRates = prefs.availability && (data.roomTypes[0]?.perDate.some((d) => d.rate) ?? false);

  return (
    <CallbacksContext.Provider value={callbacks}>
      <div
        ref={viewport}
        role="region"
        aria-label="Stay calendar"
        tabIndex={-1}
        className="sv-grid relative max-h-[calc(100dvh-236px)] min-h-[320px] overflow-auto overscroll-contain"
        style={{ ['--col-w' as string]: `${colW}px` }}
        data-col-width={colW}
        data-window-from={windowFrom}
        {...gestures}
        onContextMenu={props.onContextMenu}
      >
        <div style={{ width: metrics.label + days * colW }}>
          <DateHeader
            dates={data.dates}
            stats={stats}
            today={today}
            geo={geo}
            showStats={prefs.headerStats}
            headerRef={headerRef}
            density={density}
          />
          <div ref={bodyRef} className="relative">
            <ColumnShading dates={data.dates} today={today} geo={geo} flashToday={flashToday} />
            <div className="relative z-[1]">
              {groups.map((group) => (
                <GroupBlock
                  key={group.key}
                  group={group}
                  collapsed={collapsed.has(group.key)}
                  geo={geo}
                  display={display}
                  showHk={prefs.housekeeping}
                  showAvailability={prefs.availability}
                  density={density}
                  groupH={metrics.group}
                  resizable={resizable}
                  showRates={showRates}
                />
              ))}
              {data.unassigned.length > 0 && (
                <Lane
                  label="Unassigned"
                  tone="low"
                  bars={data.unassigned}
                  geo={geo}
                  display={display}
                  resizable={resizable}
                />
              )}
              {(data.tentative?.length ?? 0) > 0 && (
                <Lane
                  label="Tentative"
                  tone="info"
                  bars={data.tentative!}
                  geo={geo}
                  display={display}
                  resizable={() => false}
                />
              )}
              <Footer data={data} geo={geo} />
            </div>
            <InteractionLayer bodyRef={bodyRef} geo={geo} unitCode={unitCode} />
            <LinkedSegments viewport={viewport} />
          </div>
        </div>
      </div>
    </CallbacksContext.Provider>
  );
}
