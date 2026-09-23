'use client';

import * as React from 'react';
import {
  ArrowsInLineVertical,
  ArrowsOutLineVertical,
  ChatCircleText,
  Crown,
  CurrencyCircleDollar,
  Funnel,
  GearSix,
  Info,
  Lock,
  ArrowsLeftRight,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import {
  Button,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
} from '@yohobed/ui';
import type { StayView } from '@/lib/api';
import { HK_ICON, STATE_ICON } from './icons';
import {
  ACTIVITY_OPTIONS,
  EMPTY_FILTERS,
  filterChips,
  clearFilter,
  type CalendarFilters,
} from './model/filters';
import {
  HK_META,
  LEGEND_STATES,
  STATE_META,
  sourceLabel,
  type Housekeeping,
  type StayState,
} from './model/status';
import { DAY_WINDOWS, type CalendarPreferences } from './model/prefs';

const ALL = '__all';

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
      {label}
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
        <SelectTrigger aria-label={label} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map(([v, text]) => (
            <SelectItem key={v} value={v}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

/** Filters in a popover, so the grid stays in view while they change it. */
export function FiltersPopover({
  data,
  value,
  onChange,
  showMoney,
}: {
  data?: StayView;
  value: CalendarFilters;
  onChange: (next: CalendarFilters) => void;
  showMoney: boolean;
}) {
  const bars = React.useMemo(
    () =>
      data
        ? [...data.roomTypes.flatMap((rt) => rt.units.flatMap((u) => u.bars)), ...data.unassigned]
        : [],
    [data],
  );
  const sources = [
    ...new Set(
      bars
        .filter((b) => b.kind === 'booking')
        .map((b) => sourceLabel(b))
        .filter(Boolean),
    ),
  ].sort();
  const floors = [
    ...new Set(
      data?.roomTypes.flatMap((rt) => rt.units.map((u) => u.floor ?? '')).filter(Boolean) ?? [],
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const count = filterChips(value, { category: () => '' }).length;
  const set = (patch: Partial<CalendarFilters>) => onChange({ ...value, ...patch });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={`Filters${count ? `, ${count} active` : ''}`}
          title="Filters (F)"
        >
          <Funnel size={15} aria-hidden /> Filters
          {count > 0 && (
            <span className="rounded-full bg-brand px-1.5 font-mono text-[11px] tabular-nums text-white">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="grid grid-cols-2 gap-3">
          <p className="col-span-2 text-xs text-ink-3">
            Reservation filters dim the rest of the house so you keep your bearings; room filters
            shorten the list.
          </p>
          <FilterSelect
            label="Status"
            value={value.state}
            onChange={(v) => set({ state: v as StayState | '' })}
            options={LEGEND_STATES.map((s) => [s, STATE_META[s].label])}
          />
          <FilterSelect
            label="Source"
            value={value.source}
            onChange={(v) => set({ source: v })}
            options={sources.map((s) => [s, s])}
          />
          <FilterSelect
            label="Today’s activity"
            value={value.activity}
            onChange={(v) => set({ activity: v as CalendarFilters['activity'] })}
            options={ACTIVITY_OPTIONS}
          />
          <FilterSelect
            label="Room type"
            value={value.category}
            onChange={(v) => set({ category: v })}
            options={data?.roomTypes.map((rt) => [rt.roomId, rt.name]) ?? []}
          />
          <FilterSelect
            label="Floor"
            value={value.floor}
            onChange={(v) => set({ floor: v })}
            options={floors.map((f) => [f, `Floor ${f}`])}
          />
          <FilterSelect
            label="Housekeeping"
            value={value.housekeeping}
            onChange={(v) => set({ housekeeping: v as Housekeeping | '' })}
            options={(Object.keys(HK_META) as Housekeeping[]).map((k) => [k, HK_META[k].label])}
          />
          {showMoney && (
            <label className="col-span-2 flex items-center justify-between gap-3 text-sm text-ink">
              Balance due only
              <Switch
                checked={value.balance}
                onCheckedChange={(v) => set({ balance: v })}
                aria-label="Balance due only"
              />
            </label>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="col-span-2"
            onClick={() => onChange(EMPTY_FILTERS)}
            disabled={!count}
          >
            Clear all filters
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** "Confirmed ×  Booking.com ×  Deluxe ×   Clear all" */
export function FilterChips({
  value,
  onChange,
  categoryName,
}: {
  value: CalendarFilters;
  onChange: (next: CalendarFilters) => void;
  categoryName: (id: string) => string | undefined;
}) {
  const chips = filterChips(value, { category: categoryName });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange(clearFilter(value, chip.key))}
          className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink transition duration-1 hover:border-ink-3 hover:bg-surface-2"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <X size={11} weight="bold" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="px-1.5 text-xs font-medium text-ink-2 underline-offset-2 hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

/** What every colour, pattern and icon on the grid means. */
export function LegendPopover() {
  const flags: Array<[React.ElementType, string]> = [
    [Crown, 'VIP guest'],
    [ChatCircleText, 'Has notes'],
    [UsersThree, 'Group reservation'],
    [ArrowsLeftRight, 'Stay split across rooms'],
    [CurrencyCircleDollar, 'Payment due'],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Legend" title="Legend">
          <Info size={18} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[22rem]" align="end">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
          Stays and blocks
        </h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
          {LEGEND_STATES.map((state) => {
            const Icon = STATE_ICON[state];
            return (
              <li
                key={state}
                className="flex items-center gap-2 text-xs text-ink"
                title={STATE_META[state].hint}
              >
                <span
                  className="sv-bar !static h-5 w-9 shrink-0 justify-center !p-0"
                  data-state={state}
                  data-arrival="true"
                  data-departure="true"
                >
                  <Icon size={11} weight="bold" aria-hidden />
                </span>
                {STATE_META[state].label}
              </li>
            );
          })}
        </ul>
        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-ink-3">
          On a stay
        </h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {flags.map(([Icon, label]) => (
            <li key={label} className="flex items-center gap-2 text-xs text-ink">
              <Icon size={13} weight="bold" className="text-ink-2" aria-hidden /> {label}
            </li>
          ))}
          <li className="col-span-2 text-xs text-ink-2">
            A solid left edge is the arrival night; a faded, square edge means the stay began before
            the dates shown.
          </li>
        </ul>
        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-ink-3">
          Housekeeping
        </h3>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {(Object.keys(HK_META) as Housekeeping[]).map((k) => {
            const Icon = HK_ICON[k];
            return (
              <li key={k} className="flex items-center gap-2 text-xs text-ink">
                <Icon size={13} weight="bold" className="text-ink-2" aria-hidden />{' '}
                {HK_META[k].label}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <label htmlFor={id} className="text-sm text-ink">
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export const SHORTCUTS: Array<[string, string]> = [
  ['/', 'Find a guest, reference or room'],
  ['N', 'New reservation'],
  ['+', 'Quick actions'],
  ['T', 'Go to today'],
  ['[  ]', 'Previous / next dates'],
  ['F', 'Filters'],
  ['U', 'Unassigned stays'],
  [',', 'Calendar settings'],
  ['Esc', 'Close the panel or clear a selection'],
];

/** Each person's calendar: Display, Appearance and Behaviour, saved on this browser. */
export function SettingsPopover({
  value,
  onChange,
  onReset,
  storageError,
  open,
  onOpenChange,
}: {
  value: CalendarPreferences;
  onChange: (patch: Partial<CalendarPreferences>) => void;
  onReset: () => void;
  storageError: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Calendar settings"
          title="Calendar settings (,)"
        >
          <GearSix size={18} aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[23rem] overflow-y-auto"
        align="end"
        style={{ maxHeight: 'min(80vh, var(--radix-popover-content-available-height))' }}
      >
        <p className="mb-3 text-xs text-ink-3">
          Saved for you, for this property, on this browser.
        </p>
        {storageError && (
          <p role="status" className="mb-3 rounded-lg bg-low-soft px-3 py-2 text-xs text-low-ink">
            This browser is not saving settings; they apply until you leave the page.
          </p>
        )}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Display</h3>
        <Toggle
          label="Daily numbers in the header"
          hint="Occupancy, rooms free, arrivals, departures"
          checked={value.headerStats}
          onChange={(v) => onChange({ headerStats: v })}
        />
        <Toggle
          label="Rooms free per type"
          checked={value.availability}
          onChange={(v) => onChange({ availability: v })}
        />
        <Toggle
          label="Housekeeping on rooms"
          checked={value.housekeeping}
          onChange={(v) => onChange({ housekeeping: v })}
        />
        <Toggle
          label="Guests and indicators on stays"
          checked={value.barDetails}
          onChange={(v) => onChange({ barDetails: v })}
        />
        <Toggle
          label="Booking source on stays"
          checked={value.sources}
          onChange={(v) => onChange({ sources: v })}
        />

        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-3">
          Appearance
        </h3>
        <div className="flex flex-col gap-2.5 py-2">
          <div className="flex items-center justify-between gap-3 text-sm text-ink">
            Density
            <SegmentedControl
              aria-label="Calendar density"
              value={value.density}
              onChange={(v) => onChange({ density: v })}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-ink">
            Group rooms by
            <SegmentedControl
              aria-label="Group rooms by"
              value={value.groupBy}
              onChange={(v) => onChange({ groupBy: v })}
              options={[
                { value: 'category', label: 'Type' },
                { value: 'floor', label: 'Floor' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-ink">
            Colour stays by
            <SegmentedControl
              aria-label="Colour stays by"
              value={value.colorBy}
              onChange={(v) => onChange({ colorBy: v })}
              options={[
                { value: 'status', label: 'Status' },
                { value: 'source', label: 'Source' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-sm text-ink">
            Side panel
            <SegmentedControl
              aria-label="Side panel width"
              value={value.panelWidth}
              onChange={(v) => onChange({ panelWidth: v })}
              options={[
                { value: 'normal', label: 'Narrow' },
                { value: 'wide', label: 'Wide' },
              ]}
            />
          </div>
        </div>

        <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-ink-3">
          Behaviour
        </h3>
        <Toggle
          label="Offer actions after selecting nights"
          checked={value.selectionActions}
          onChange={(v) => onChange({ selectionActions: v })}
        />
        <Toggle
          label="Review simple room moves"
          hint="Off: a same-type move of a stay not yet arrived saves at once, with Undo. Price changes and in-house moves are always reviewed."
          checked={value.dragWarnings}
          onChange={(v) => onChange({ dragWarnings: v })}
        />
        <Toggle
          label="Keyboard shortcuts"
          checked={value.shortcuts}
          onChange={(v) => onChange({ shortcuts: v })}
        />
        {value.shortcuts && (
          <ul className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-surface-2 p-2.5 text-xs text-ink-2">
            {SHORTCUTS.map(([k, what]) => (
              <React.Fragment key={k}>
                <Kbd className="justify-self-start">{k}</Kbd>
                <span>{what}</span>
              </React.Fragment>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={onReset}>
          Restore defaults
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/** The window's length. */
export function RangeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: CalendarPreferences['days']) => void;
}) {
  return (
    <SegmentedControl
      aria-label="Calendar days"
      value={String(value) as `${CalendarPreferences['days']}`}
      onChange={(v) => onChange(Number(v) as CalendarPreferences['days'])}
      options={DAY_WINDOWS.map((d) => ({
        value: String(d) as `${CalendarPreferences['days']}`,
        label: `${d}d`,
        ariaLabel: `${d} days`,
      }))}
    />
  );
}

export function GroupToggles({
  onExpand,
  onCollapse,
}: {
  onExpand: () => void;
  onCollapse: () => void;
}) {
  return (
    <span className="inline-flex">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Expand all room groups"
        title="Expand all"
        onClick={onExpand}
      >
        <ArrowsOutLineVertical size={16} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Collapse all room groups"
        title="Collapse all"
        onClick={onCollapse}
      >
        <ArrowsInLineVertical size={16} aria-hidden />
      </Button>
    </span>
  );
}

export function BlockKindIcon({
  kind,
  className,
}: {
  kind: 'out_of_service' | 'blocked';
  className?: string;
}) {
  const Icon = kind === 'blocked' ? Lock : STATE_ICON.out_of_service;
  return <Icon size={14} className={cn(className)} aria-hidden />;
}
