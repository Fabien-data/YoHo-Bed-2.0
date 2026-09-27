'use client';

import * as React from 'react';
import {
  ArrowsLeftRight,
  Bed,
  CaretDown,
  Confetti,
  Crown,
  Prohibit,
  SignIn,
  SignOut,
  User,
  UserCircleDashed,
  UsersThree,
} from '@phosphor-icons/react';
import { TagDot, Tooltip, cn } from '@yohobed/ui';
import type { StayBar, StayUnit, StayView } from '@/lib/api';
import { useMoney } from '@/components/currency';
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
  barPlacement,
  barRect,
  barStyle,
  columnWidth,
  barTier,
  stackBars,
  METRICS,
  type BarPlacement,
  type Density,
  type RoomGroup,
} from './model/layout';
import { HK_META, STATE_META, barSummary, sourceLabel, stateOf } from './model/status';
import type { CalendarPreferences } from './model/prefs';
import { occupancyPercent, type DayStats } from './model/stats';
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

/**
 * One stay or block. The bar itself is an unpainted box; its parallelogram is `.sv-bar-shape`,
 * which alone takes the pointer, so a click on the empty corner beside a slant falls through to
 * the neighbouring stay or night instead of opening this one. The payment and notes markers sit
 * outside the shape, on its top edge, so the clipping never hides them.
 */
const StayBarView = React.memo(function StayBarView({
  bar,
  place,
  colW,
  slant,
  display,
  unassigned,
  canResize,
}: {
  bar: StayBar;
  place: BarPlacement;
  colW: number;
  slant: number;
  display: BarDisplay;
  unassigned?: boolean;
  canResize: boolean;
}) {
  const cb = useCallbacks();
  const state = stateOf(bar);
  const Icon = STATE_ICON[state];
  // What fits between the slants decides how much the bar says (the text keeps clear of each).
  const ends = Number(place.slantStart) + Number(place.slantEnd);
  const tier = barTier(barRect(place, colW).width - ends * slant * 0.75 - 12);
  const isBlock = bar.kind === 'block';
  const name = isBlock ? (bar.reason ?? STATE_META[state].label) : (bar.guestName ?? 'Guest');
  const pax = (bar.adults ?? 0) + (bar.children ?? 0);
  const Source = sourceIcon(bar);
  const split = (bar.segment?.of ?? 1) > 1;
  const roomy = tier === 'detail' || tier === 'full';
  const details = !isBlock && display.details;
  const ariaLabel = [
    barSummary(bar),
    stayRange(bar.from, bar.to),
    bar.balanceDue && 'payment due',
    bar.hasNotes && 'has notes',
    bar.vip && 'VIP',
    bar.groupId && 'group reservation',
    split && 'split stay',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className="sv-bar"
      data-bar-id={bar.id}
      data-booking-id={bar.bookingId}
      data-state={state}
      data-kind={bar.kind}
      data-arrival={!place.startsBefore}
      data-departure={!place.endsAfter}
      data-slant-start={place.slantStart}
      data-slant-end={place.slantEnd}
      data-unassigned={unassigned || undefined}
      data-tone={display.colorBy === 'source' && bar.sourceColor ? bar.sourceColor : undefined}
      style={barStyle(place)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cb.current.openBar(bar);
        }
      }}
    >
      <span className="sv-bar-shape" aria-hidden />
      <span className="sv-bar-content" aria-hidden>
        {tier !== 'name' && <Icon size={13} weight="bold" className="shrink-0" />}
        {!isBlock && display.sources && roomy && <Source size={12} weight="bold" />}
        {tier !== 'icon' && <span className="sv-bar-name">{name}</span>}
        {details && roomy && pax > 0 && (
          <span className="sv-bar-meta font-mono tabular-nums">
            <User size={11} weight="bold" />
            {pax}
          </span>
        )}
        {!isBlock && display.sources && tier === 'full' && sourceLabel(bar) && (
          <span className="sv-bar-meta">{sourceLabel(bar)}</span>
        )}
        {details && roomy && (bar.vip || bar.groupId || split) && (
          <span className="sv-bar-flags">
            {bar.vip && <Crown size={12} weight="fill" />}
            {bar.groupId && <UsersThree size={12} weight="bold" />}
            {split && <ArrowsLeftRight size={12} weight="bold" />}
          </span>
        )}
      </span>
      {details && (bar.balanceDue || bar.hasNotes) && (
        <span className="sv-bar-markers" data-no-hover>
          {bar.balanceDue && (
            <Tooltip label="Payment due: this stay has a balance to collect">
              <span className="sv-marker" data-marker="payment" />
            </Tooltip>
          )}
          {bar.hasNotes && (
            <Tooltip label="Notes on this reservation: open it to read them">
              <span className="sv-marker" data-marker="notes" />
            </Tooltip>
          )}
        </span>
      )}
      {canResize && !place.endsAfter && (
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
  /** A bar's distance from its row's edges, and how far its slanted ends lean. */
  inset: number;
  slant: number;
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
        className="sv-label sv-pin sticky left-0 z-10 shrink-0 border-r border-line bg-surface"
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
          const place = barPlacement(geo.windowFrom, geo.days, bar, geo.slant);
          return place ? (
            <StayBarView
              key={`${bar.kind}-${bar.id}`}
              bar={bar}
              place={place}
              colW={geo.colW}
              slant={geo.slant}
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
  currency,
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
  currency: string;
}) {
  const cb = useCallbacks();
  const { money, moneyShort } = useMoney();
  const perDate = group.roomType?.perDate ?? [];
  const large = group.units.length > 30;
  return (
    <div role="rowgroup" aria-label={group.name}>
      <div className="flex border-b border-line bg-surface-2" style={{ height: groupH }}>
        <div
          className="sv-pin sticky left-0 z-20 flex shrink-0 items-center border-r border-line bg-surface-2"
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
            {group.roomType?.color && <TagDot color={group.roomType.color} />}
            <span className="truncate text-[13px] font-semibold text-ink">{group.name}</span>
            <span className="ml-auto rounded-md bg-surface px-1.5 font-mono text-[11px] tabular-nums text-ink-3">
              {group.units.length}
            </span>
          </button>
        </div>
        {showAvailability && group.roomType && (
          <div className="relative shrink-0" style={{ width: geo.days * geo.colW }}>
            {perDate.map((d, i) => {
              const day = `${dayOfMonth(d.date)} ${monthShort(d.date)}`;
              // No availability row for the date is unknown, not zero: it shows a dash.
              const left = d.closed
                ? `${group.name} is closed to sale on ${day}`
                : d.available == null
                  ? `No availability set for ${group.name} on ${day}`
                  : `${d.available} ${group.name} ${d.available === 1 ? 'room' : 'rooms'} left to sell on ${day}`;
              return (
                <div
                  key={d.date}
                  className="sv-type-cell"
                  style={{ left: `calc(var(--col-w) * ${i})`, width: 'var(--col-w)' }}
                >
                  <Tooltip label={left}>
                    <span
                      role="img"
                      aria-label={left}
                      className="sv-type-avail font-mono tabular-nums"
                      data-none={d.closed || d.available === 0 || undefined}
                    >
                      <Bed size={12} weight="bold" aria-hidden />
                      {d.closed ? 'Closed' : (d.available ?? '—')}
                    </span>
                  </Tooltip>
                  {/* A rate of zero is a price; a missing rate is not. Closed dates sell nothing. */}
                  {showRates && !d.closed && (
                    <Tooltip
                      label={
                        d.rate == null
                          ? `No rate is set for ${group.name} on ${day}`
                          : `The lowest selling rate for ${group.name} on ${day}: ${money(d.rate, currency)} a night`
                      }
                    >
                      <span
                        className={cn(
                          'sv-type-rate tabular-nums',
                          d.rate == null ? 'font-sans' : 'font-mono',
                        )}
                        data-missing={d.rate == null || undefined}
                      >
                        {d.rate == null ? (
                          'No rate'
                        ) : (
                          <>
                            <span className="sv-type-from font-sans">From</span>
                            {moneyShort(d.rate, currency)}
                          </>
                        )}
                      </span>
                    </Tooltip>
                  )}
                </div>
              );
            })}
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
          'sv-pin sticky left-0 z-10 flex shrink-0 items-start border-r border-line px-3 pt-3',
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
              const place = barPlacement(geo.windowFrom, geo.days, bar, geo.slant);
              return place ? (
                <StayBarView
                  key={bar.id}
                  bar={bar}
                  place={place}
                  colW={geo.colW}
                  slant={geo.slant}
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
  holidays,
  roomCount,
  typeCount,
}: {
  dates: string[];
  stats: DayStats[];
  today: string;
  geo: RowGeometry;
  showStats: boolean;
  headerRef: React.Ref<HTMLDivElement>;
  density: Density;
  /** Configuration → Holidays: the names on each date. */
  holidays?: ReadonlyMap<string, string[]>;
  roomCount: number;
  typeCount: number;
}) {
  const cb = useCallbacks();
  // Wide columns spell the badge out; narrow ones keep its icon and number.
  const wide = geo.colW >= 100;
  const unassigned = stats.some((s) => s.unassigned > 0);
  return (
    <div
      ref={headerRef}
      className="sv-head sticky top-0 z-30 flex border-b border-line-strong bg-surface"
      role="row"
      data-header-stats={showStats}
      data-density={density}
    >
      {/* The corner is the key to the rows beside it: each label sits level with, and against,
          the numbers it names, so the dates need no legend of their own. */}
      <div className="sv-head-key sv-pin sticky left-0 z-40 shrink-0" style={{ width: geo.labelW }}>
        <span className="sv-head-title">
          Rooms
          {density === 'comfortable' && dates.length > 0 && (
            <span className="sv-head-window">{stayRange(dates[0]!, dates[dates.length - 1]!)}</span>
          )}
        </span>
        <span className="sv-head-count">
          <span className="font-mono tabular-nums">{roomCount}</span>
          <span className="sv-head-count-unit">
            {roomCount === 1 ? 'room' : 'rooms'}
            {typeCount > 1 && ` · ${typeCount} types`}
          </span>
        </span>
        {showStats && (
          <>
            <span className="sv-head-hint">
              Occupancy
              <span className="sv-head-meter" aria-hidden />
            </span>
            <span className="sv-head-hint">
              <Bed size={12} weight="bold" aria-hidden />
              Free
              <SignIn size={12} weight="bold" aria-hidden />
              In
              <SignOut size={12} weight="bold" aria-hidden />
              Out
            </span>
          </>
        )}
        {unassigned && (
          <span className="sv-head-hint">
            <span className="sv-head-dot" aria-hidden />
            Unassigned
          </span>
        )}
      </div>
      {dates.map((d, i) => {
        const s = stats[i];
        const isToday = d === today;
        const holiday = holidays?.get(d);
        const date = `${dayOfMonth(d)} ${monthShort(d)}`;
        const occupancy = s ? `${s.occupancyPct.toFixed(2)}%` : '';
        const free = s && `${s.available} ${s.available === 1 ? 'room' : 'rooms'} free to sell`;
        const arriving = s && `${s.arrivals} ${s.arrivals === 1 ? 'arrival' : 'arrivals'}`;
        const leaving = s && `${s.departures} ${s.departures === 1 ? 'departure' : 'departures'}`;
        return (
          <div
            key={d}
            role="columnheader"
            aria-label={[
              `${weekday(d)} ${date}`,
              isToday && 'today',
              holiday?.join(', '),
              showStats && s && `${occupancy} occupied, ${free}, ${arriving}, ${leaving}`,
            ]
              .filter(Boolean)
              .join(', ')}
            className="sv-date relative shrink-0 border-r border-line"
            data-today={isToday}
            data-weekend={isWeekend(d) || undefined}
            style={{ width: geo.colW }}
          >
            {holiday && <span aria-hidden className="sv-date-holiday" />}
            <span className="sv-date-weekday">
              {holiday && (
                <Tooltip label={holiday.join(' · ')}>
                  <span role="img" aria-label={`Holiday: ${holiday.join(', ')}`}>
                    <Confetti size={11} weight="fill" aria-hidden />
                  </span>
                </Tooltip>
              )}
              {isToday ? 'Today' : weekday(d)}
            </span>
            <span className="sv-date-number">
              {dayOfMonth(d)}
              <span className="sv-date-month">{monthShort(d)}</span>
            </span>
            {showStats && s && (
              <>
                <Tooltip label={`${occupancy} of the rooms that can be sold are taken`}>
                  <span
                    role="img"
                    aria-label={`${occupancy} occupancy`}
                    className="sv-date-occ font-mono tabular-nums"
                    data-full={s.occupancyPct >= 90 || undefined}
                  >
                    {occupancy}
                    <span className="sv-date-meter" aria-hidden>
                      <span style={{ width: `${Math.min(100, s.occupancyPct)}%` }} />
                    </span>
                  </span>
                </Tooltip>
                <span className="sv-date-moves font-mono tabular-nums">
                  <Tooltip label={free}>
                    <span role="img" aria-label={free!}>
                      <Bed size={12} weight="bold" aria-hidden />
                      {s.available}
                    </span>
                  </Tooltip>
                  <Tooltip label={arriving}>
                    <span role="img" aria-label={arriving!}>
                      <SignIn size={12} weight="bold" aria-hidden />
                      {s.arrivals}
                    </span>
                  </Tooltip>
                  <Tooltip label={leaving}>
                    <span role="img" aria-label={leaving!}>
                      <SignOut size={12} weight="bold" aria-hidden />
                      {s.departures}
                    </span>
                  </Tooltip>
                </span>
              </>
            )}
            {s && s.unassigned > 0 && (
              <Tooltip
                label={`${s.unassigned} ${s.unassigned === 1 ? 'stay has' : 'stays have'} no room on ${date}. Open the list to assign them.`}
              >
                <button
                  type="button"
                  data-no-gesture
                  onClick={() => cb.current.unassignedOn(d)}
                  aria-label={`${s.unassigned} unassigned on ${date}`}
                  className="sv-unassigned-badge"
                >
                  <UserCircleDashed size={12} weight="bold" aria-hidden />
                  {s.unassigned}
                  {wide && <span>unassigned</span>}
                </button>
              </Tooltip>
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
      (f) => {
        const pct = occupancyPercent(f);
        return (
          <>
            <span className="h-1.5 w-6 overflow-hidden rounded-full bg-line-strong" aria-hidden>
              <span
                className={cn(
                  'block h-full rounded-full',
                  pct >= 90 ? 'bg-closed' : pct >= 60 ? 'bg-low' : 'bg-avail',
                )}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </span>
            {pct.toFixed(2)}%
          </>
        );
      },
    ],
  ];
  return (
    <>
      {rows.map(([label, get]) => (
        <div key={label} className="flex border-b border-line bg-surface-2 last:border-b-0">
          <div
            className="sv-pin sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-2"
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
    const place = barPlacement(
      geo.windowFrom,
      geo.days,
      { from: drag.from, to: drag.to, kind: drag.bar.kind },
      geo.slant,
    );
    if (top !== null && place) {
      const rect = barRect(place, geo.colW);
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
            data-kind={drag.bar.kind}
            data-arrival={!place.startsBefore}
            data-departure={!place.endsAfter}
            data-slant-start={place.slantStart}
            data-slant-end={place.slantEnd}
            data-issue={!!drag.issue || undefined}
            style={{
              top: top + geo.inset,
              height: geo.rowH - geo.inset * 2,
              left: geo.labelW + rect.left,
              width: rect.width,
            }}
          >
            <span className="sv-bar-shape" aria-hidden />
            <span className="sv-bar-content">
              <Icon size={13} weight="bold" aria-hidden className="shrink-0" />
              <span className="sv-bar-name">{drag.bar.guestName ?? drag.bar.reason}</span>
            </span>
          </div>
          <div
            className={cn(
              'pointer-events-none absolute z-[7] max-w-xs rounded-lg px-2 py-1 text-xs font-semibold shadow-raised',
              drag.issue ? 'bg-closed text-white' : 'bg-brand text-white',
            )}
            role="status"
            aria-live="polite"
            style={{ top: Math.max(0, top - 26), left: geo.labelW + Math.max(0, rect.left) }}
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
  canReadFinancial: boolean;
  handlers: GestureHandlers & {
    onOpenUnit: (unit: StayUnit) => void;
    onUnassignedOn: (date: string) => void;
    onToggleGroup: (key: string) => void;
  };
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onColumnWidth?: (colW: number) => void;
  scrollKey: string;
  /** Configuration → Holidays in the window, by date. */
  holidays?: ReadonlyMap<string, string[]>;
}

/** However short the window, the grid keeps room for a few rooms. */
const MIN_GRID_HEIGHT = 320;

/**
 * Size the calendar to the rest of the window below it, so the page stays still and the grid
 * scrolls. Anything above it — the toolbar wrapping, a status line or an alert appearing, an
 * approval banner — moves that line, and all of it lives in the page's `<main>`, so watching
 * `<main>` (plus the window) catches every change. The bottom margin is read from the page.
 */
function useFillViewport(ref: React.RefObject<HTMLElement>) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const main = el.closest('main');
    const measure = () => {
      // Hidden (a phone showing the day list): nothing to size.
      if (!el.getClientRects().length) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const below = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      // Less the card's bottom border, which sits under the grid.
      const height = `${Math.max(MIN_GRID_HEIGHT, Math.floor(window.innerHeight - top - below - 1))}px`;
      if (el.style.height !== height) el.style.height = height;
    };
    measure();
    // Setting the height resizes <main> in turn; re-measuring a frame later settles it without
    // a ResizeObserver loop.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(later);
    if (main) observer.observe(main);
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', later);
    };
  }, [ref]);
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
  const colW = columnWidth(width, days, density);
  useFillViewport(viewport);
  React.useEffect(() => props.onColumnWidth?.(colW), [colW, props.onColumnWidth]);

  const geo = React.useMemo<RowGeometry>(
    () => ({
      windowFrom,
      days,
      colW,
      rowH: metrics.row,
      labelW: metrics.label,
      inset: metrics.inset,
      slant: metrics.slant,
    }),
    [windowFrom, days, colW, metrics],
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
    // The pinned room column casts an edge once dates slide under it (an attribute, no render).
    const markScrolled = () => {
      const scrolled = root.scrollLeft > 0;
      if ((root.dataset.scrolledX === 'true') !== scrolled)
        root.dataset.scrolledX = String(scrolled);
    };
    markScrolled();
    const onScroll = () => {
      markScrolled();
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
  const showRates = prefs.availability && props.canReadFinancial;

  return (
    <CallbacksContext.Provider value={callbacks}>
      <div
        ref={viewport}
        role="region"
        aria-label="Stay calendar"
        tabIndex={-1}
        className="sv-grid relative overflow-auto overscroll-contain"
        style={{
          ['--col-w' as string]: `${colW}px`,
          // The bar shape's CSS reads these; the drag preview reads the same METRICS.
          ['--bar-inset' as string]: `${metrics.inset}px`,
          ['--bar-slant' as string]: `${metrics.slant}px`,
        }}
        data-col-width={colW}
        data-density={density}
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
            roomCount={units.length}
            typeCount={data.roomTypes.length}
            density={density}
            holidays={props.holidays}
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
                  currency={data.property.currency}
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
