'use client';

import * as React from 'react';
import { CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

/**
 * A month calendar — Yanolja's date picker, reproduced: « ‹ Sep 2026 › », a Sunday-first grid,
 * past days greyed out and unselectable, today marked, the chosen day a solid square.
 *
 * Dates are ISO strings ('YYYY-MM-DD') throughout and are handled as UTC calendar days, so a
 * desk in Colombo and a server in Frankfurt never disagree about which day was clicked. "Today"
 * and the earliest selectable day come from the caller — the hotel's own date, not the browser's.
 *
 * Keyboard: arrows move a day or a week, PageUp/PageDown a month (with Shift, a year), Home/End
 * the week's ends, Enter or Space chooses. Only the focused day is a tab stop.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKS = [0, 1, 2, 3, 4, 5];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string) {
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) };
}
function toIso(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
export function addDaysIso(iso: string, days: number) {
  const { y, m, d } = parts(iso);
  return toIso(y, m, d + days);
}
function addMonthsIso(iso: string, months: number) {
  const { y, m, d } = parts(iso);
  // Clamp to the target month's length: 31 Jan + 1 month is 28/29 Feb, not 3 Mar.
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return toIso(y, m + months, Math.min(d, last));
}
function monthOf(iso: string) {
  return iso.slice(0, 7);
}

export interface CalendarProps {
  /** The chosen day. */
  value?: string | null;
  onSelect: (iso: string) => void;
  /** The hotel's today — marked, and the default month shown. */
  today: string;
  /** The earliest selectable day (inclusive). Defaults to no limit. */
  min?: string;
  /** The latest selectable day (inclusive). */
  max?: string;
  /** A span to shade — the stay, when choosing a check-out. */
  rangeStart?: string | null;
  rangeEnd?: string | null;
  /** Accessible name for the grid, e.g. "Check-in date". */
  label?: string;
  className?: string;
  /** Focus the chosen day (or today) when the calendar mounts — for popovers. */
  autoFocus?: boolean;
}

export function Calendar({
  value,
  onSelect,
  today,
  min,
  max,
  rangeStart,
  rangeEnd,
  label = 'Choose a date',
  className,
  autoFocus,
}: CalendarProps) {
  const initial = value ?? (min && min > today ? min : today);
  const [focused, setFocused] = React.useState(initial);
  const [month, setMonth] = React.useState(monthOf(initial));
  const grid = React.useRef<HTMLDivElement>(null);
  const wantFocus = React.useRef(Boolean(autoFocus));

  // Follow an outside change of value (typing into the input beside it).
  React.useEffect(() => {
    if (value) {
      setFocused(value);
      setMonth(monthOf(value));
    }
  }, [value]);

  React.useEffect(() => {
    if (!wantFocus.current) return;
    wantFocus.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  });

  const disabled = (iso: string) => Boolean((min && iso < min) || (max && iso > max));

  const { y, m } = parts(`${month}-01`);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const start = toIso(y, m, 1 - firstDow);
  const days = Array.from({ length: 42 }, (_, i) => addDaysIso(start, i));

  function moveTo(iso: string) {
    setFocused(iso);
    setMonth(monthOf(iso));
    wantFocus.current = true;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const dow = new Date(`${focused}T00:00:00Z`).getUTCDay();
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDaysIso(focused, -1),
      ArrowRight: () => addDaysIso(focused, 1),
      ArrowUp: () => addDaysIso(focused, -7),
      ArrowDown: () => addDaysIso(focused, 7),
      Home: () => addDaysIso(focused, -dow),
      End: () => addDaysIso(focused, 6 - dow),
      PageUp: () => addMonthsIso(focused, e.shiftKey ? -12 : -1),
      PageDown: () => addMonthsIso(focused, e.shiftKey ? 12 : 1),
    };
    const next = step[e.key];
    if (next) {
      e.preventDefault();
      moveTo(next());
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !disabled(focused)) {
      e.preventDefault();
      onSelect(focused);
    }
  }

  const shift = (months: number) => {
    const target = addMonthsIso(`${month}-01`, months);
    setMonth(monthOf(target));
    setFocused(target);
  };

  const navButton =
    'flex h-7 w-7 items-center justify-center rounded-md text-ink-3 transition duration-1 hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass';

  return (
    <div className={cn('w-[17.5rem] select-none', className)}>
      <div className="mb-2 flex items-center gap-0.5">
        <button
          type="button"
          aria-label="Previous year"
          className={navButton}
          onClick={() => shift(-12)}
        >
          <CaretDoubleLeft size={13} />
        </button>
        <button
          type="button"
          aria-label="Previous month"
          className={navButton}
          onClick={() => shift(-1)}
        >
          <CaretLeft size={13} />
        </button>
        <div className="flex-1 text-center text-sm font-bold text-ink" aria-live="polite">
          {MONTHS[m - 1]} {y}
        </div>
        <button
          type="button"
          aria-label="Next month"
          className={navButton}
          onClick={() => shift(1)}
        >
          <CaretRight size={13} />
        </button>
        <button
          type="button"
          aria-label="Next year"
          className={navButton}
          onClick={() => shift(12)}
        >
          <CaretDoubleRight size={13} />
        </button>
      </div>

      <div
        ref={grid}
        role="grid"
        aria-label={`${label}, ${MONTHS[m - 1]} ${y}`}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-y-0.5"
      >
        <div role="row" className="contents">
          {WEEKDAYS.map((w) => (
            <div
              key={w}
              role="columnheader"
              className="py-1 text-center text-xs font-medium text-ink-3"
            >
              {w}
            </div>
          ))}
        </div>
        {WEEKS.map((week) => (
          <div key={week} role="row" className="contents">
            {days.slice(week * 7, week * 7 + 7).map((iso) => {
              const inMonth = monthOf(iso) === month;
              const off = disabled(iso);
              const selected = iso === value;
              const isToday = iso === today;
              const inRange =
                rangeStart && rangeEnd && iso > rangeStart && iso < rangeEnd && !selected;
              const isRangeEnd = (iso === rangeStart || iso === rangeEnd) && !selected;
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  data-date={iso}
                  aria-selected={selected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-disabled={off || undefined}
                  aria-label={new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                  tabIndex={iso === focused ? 0 : -1}
                  onClick={() => {
                    if (off) return;
                    setFocused(iso);
                    onSelect(iso);
                  }}
                  className={cn(
                    'mx-auto flex h-9 w-9 items-center justify-center rounded-md text-sm tabular-nums transition duration-1',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass',
                    off
                      ? 'cursor-not-allowed bg-surface-2 text-ink-3 opacity-60'
                      : selected
                        ? 'bg-brand font-bold text-white'
                        : isRangeEnd
                          ? 'bg-brand-soft font-semibold text-brand-ink'
                          : inRange
                            ? 'rounded-none bg-brand-soft text-ink'
                            : inMonth
                              ? 'text-ink hover:bg-surface-2'
                              : 'text-ink-3 hover:bg-surface-2',
                    isToday && !selected && 'ring-1 ring-inset ring-brass',
                  )}
                >
                  {Number(iso.slice(8, 10))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
