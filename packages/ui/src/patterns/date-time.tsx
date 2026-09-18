'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { CalendarBlank, Clock } from '@phosphor-icons/react';
import {
  addDaysIso,
  formatDate,
  formatTime,
  nightsBetween,
  parseDateInput,
  parseTimeInput,
  type TimeFormat,
} from '@yohobed/locale';
import { cn } from '../lib/cn';
import { Calendar } from './calendar';

/**
 * Yanolja's date and time pickers, and the stay row built from them (Development Phase 02).
 *
 * Every field is a real text input first: a front desk types "17/09/2026" and "2pm" faster than
 * it clicks, so typing is always accepted — day-first dates, ISO dates, "14:00", "2 pm" — and the
 * calendar or the time wheel is there for the mouse. Values stay canonical ('YYYY-MM-DD',
 * 'HH:mm'); only the display is local.
 */

const BOX =
  'flex h-9 items-center rounded-lg border border-line-strong bg-surface text-sm text-ink ' +
  'transition duration-1 hover:border-ink-3 focus-within:border-brass focus-within:ring-2 focus-within:ring-brass-soft';

const PANEL =
  'z-50 rounded-xl border border-line bg-surface p-3 shadow-raised outline-none ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-2 ease-smooth';

const ICON_BUTTON =
  'flex h-full shrink-0 items-center px-2 text-ink-3 transition duration-1 hover:text-ink ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass';

// --- DatePicker ----------------------------------------------------------------

export interface DatePickerProps {
  value: string | null;
  onChange: (iso: string) => void;
  /** The hotel's today (for the calendar's marker and default month). */
  today: string;
  min?: string;
  max?: string;
  /** Shade a span in the calendar — the stay, when choosing a check-out. */
  rangeStart?: string | null;
  rangeEnd?: string | null;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
  /** Joins the control to a neighbour: square this side's corners. */
  attach?: 'left' | 'right';
}

export function DatePicker({
  value,
  onChange,
  today,
  min,
  max,
  rangeStart,
  rangeEnd,
  id,
  'aria-label': ariaLabel,
  disabled,
  className,
  attach,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [focusCalendar, setFocusCalendar] = React.useState(false);
  const [draft, setDraft] = React.useState(formatDate(value));
  const [invalid, setInvalid] = React.useState(false);
  const wrap = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft(formatDate(value));
    setInvalid(false);
  }, [value]);

  function commit() {
    if (draft.trim() === formatDate(value)) return;
    const iso = parseDateInput(draft);
    if (!iso || (min && iso < min) || (max && iso > max)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(iso);
  }

  function choose(iso: string) {
    setOpen(false);
    setInvalid(false);
    onChange(iso);
    input.current?.focus();
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={wrap}
          className={cn(
            BOX,
            attach === 'left' && 'rounded-l-none',
            attach === 'right' && 'rounded-r-none',
            invalid && 'border-closed',
            disabled && 'pointer-events-none opacity-50',
            className,
          )}
        >
          <input
            ref={input}
            id={id}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            placeholder="dd/mm/yyyy"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={() => {
              setFocusCalendar(false);
              setOpen(true);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Enter confirms the date; it must not also submit the form around it.
                e.preventDefault();
                commit();
                setOpen(false);
              } else if (e.key === 'ArrowDown' && e.altKey) {
                e.preventDefault();
                setFocusCalendar(true);
                setOpen(true);
              } else if (e.key === 'Escape' && open) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            className="h-full w-full min-w-0 bg-transparent pl-3 tabular-nums outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Open calendar"
            disabled={disabled}
            onClick={() => {
              setFocusCalendar(true);
              setOpen((o) => !o);
            }}
            className={ICON_BUTTON}
          >
            <CalendarBlank size={15} />
          </button>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={PANEL}
          // Typing continues in the input unless the calendar was asked for.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (wrap.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <Calendar
            value={value}
            onSelect={choose}
            today={today}
            min={min}
            max={max}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            label={ariaLabel}
            autoFocus={focusCalendar}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// --- TimePicker ----------------------------------------------------------------

export interface TimePickerProps {
  /** 'HH:mm' */
  value: string | null;
  onChange: (hhmm: string) => void;
  format?: TimeFormat;
  /** Minutes between choices on the wheel. Typing accepts any minute. */
  minuteStep?: number;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
  attach?: 'left' | 'right';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Split 'HH:mm' into what the wheel shows. */
function wheelParts(hhmm: string, format: TimeFormat) {
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3, 5));
  if (format === '24h') return { h, m, pm: false };
  return { h: h % 12 === 0 ? 12 : h % 12, m, pm: h >= 12 };
}
function fromWheel(h: number, m: number, pm: boolean, format: TimeFormat) {
  if (format === '24h') return `${pad(h)}:${pad(m)}`;
  const h24 = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h;
  return `${pad(h24)}:${pad(m)}`;
}

function WheelColumn({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: Array<{ value: number | boolean; text: string }>;
  selected: number | boolean;
  onSelect: (v: number | boolean) => void;
}) {
  const list = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'center' });
  }, []);
  const index = items.findIndex((i) => i.value === selected);
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const next = items[(index + d + items.length) % items.length]!;
        onSelect(next.value);
        list.current
          ?.querySelectorAll<HTMLElement>('[role="option"]')
          [(index + d + items.length) % items.length]?.scrollIntoView({ block: 'nearest' });
      }}
      className="h-56 w-14 overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brass-soft"
    >
      {items.map((i) => (
        <div
          key={String(i.value)}
          role="option"
          aria-selected={i.value === selected}
          onClick={() => onSelect(i.value)}
          className={cn(
            'cursor-pointer px-3 py-1.5 text-sm tabular-nums transition duration-1',
            i.value === selected
              ? 'bg-surface-2 font-semibold text-ink'
              : 'text-ink-2 hover:bg-surface-2',
          )}
        >
          {i.text}
        </div>
      ))}
    </div>
  );
}

export function TimePicker({
  value,
  onChange,
  format = '12h',
  minuteStep = 1,
  id,
  'aria-label': ariaLabel,
  disabled,
  className,
  attach,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(formatTime(value, format));
  const [invalid, setInvalid] = React.useState(false);
  const [wheel, setWheel] = React.useState(() => wheelParts(value ?? '12:00', format));
  const wrap = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft(formatTime(value, format));
    setInvalid(false);
  }, [value, format]);

  function commit() {
    if (draft.trim() === formatTime(value, format)) return;
    const hhmm = parseTimeInput(draft);
    if (!hhmm) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(hhmm);
  }

  function openWheel() {
    setWheel(wheelParts(value ?? '12:00', format));
    setOpen(true);
  }

  const hours =
    format === '24h'
      ? Array.from({ length: 24 }, (_, h) => ({ value: h, text: pad(h) }))
      : Array.from({ length: 12 }, (_, i) => ({ value: i + 1, text: pad(i + 1) }));
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => ({
    value: i * minuteStep,
    text: pad(i * minuteStep),
  }));
  // A typed minute off the step still shows as selected.
  if (!minutes.some((m) => m.value === wheel.m)) {
    minutes.push({ value: wheel.m, text: pad(wheel.m) });
    minutes.sort((a, b) => a.value - b.value);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={wrap}
          className={cn(
            BOX,
            attach === 'left' && 'rounded-l-none',
            attach === 'right' && 'rounded-r-none',
            invalid && 'border-closed',
            disabled && 'pointer-events-none opacity-50',
            className,
          )}
        >
          <input
            ref={input}
            id={id}
            aria-label={ariaLabel}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            autoComplete="off"
            placeholder={format === '12h' ? 'hh:mm AM' : 'hh:mm'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'ArrowDown' && e.altKey) {
                e.preventDefault();
                openWheel();
              }
            }}
            className="h-full w-full min-w-0 bg-transparent pl-3 tabular-nums outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="Choose a time"
            disabled={disabled}
            onClick={() => (open ? setOpen(false) : openWheel())}
            className={ICON_BUTTON}
          >
            <Clock size={15} />
          </button>
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(PANEL, 'p-2')}
          onInteractOutside={(e) => {
            if (wrap.current?.contains(e.target as Node)) e.preventDefault();
          }}
        >
          <div className="flex gap-1">
            <WheelColumn
              label="Hour"
              items={hours}
              selected={wheel.h}
              onSelect={(h) => setWheel((w) => ({ ...w, h: h as number }))}
            />
            <WheelColumn
              label="Minute"
              items={minutes}
              selected={wheel.m}
              onSelect={(m) => setWheel((w) => ({ ...w, m: m as number }))}
            />
            {format === '12h' && (
              <WheelColumn
                label="AM or PM"
                items={[
                  { value: false, text: 'AM' },
                  { value: true, text: 'PM' },
                ]}
                selected={wheel.pm}
                onSelect={(pm) => setWheel((w) => ({ ...w, pm: pm as boolean }))}
              />
            )}
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={() => {
                onChange(fromWheel(wheel.h, wheel.m, wheel.pm, format));
                setOpen(false);
                input.current?.focus();
              }}
              className="h-7 rounded-md bg-brand px-3 text-xs font-semibold text-white transition duration-1 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
            >
              Ok
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// --- StayRangeField --------------------------------------------------------------

export interface StayRange {
  checkin: string;
  checkout: string;
  /** 'HH:mm' */
  checkinTime: string;
  checkoutTime: string;
}

export interface StayRangeFieldProps {
  value: StayRange;
  onChange: (next: StayRange) => void;
  /** The hotel's today: the earliest check-in. */
  today: string;
  timeFormat?: TimeFormat;
  maxNights?: number;
  disabled?: boolean;
  /** A prefix for the field ids and labels, when a form has more than one stay row. */
  idPrefix?: string;
  className?: string;
}

/**
 * Check-in date and time · the number of nights · check-out date and time — Yanolja's stay row.
 *
 * The nights chip is editable: type 3 and the check-out moves. Moving the check-in keeps the
 * nights, as a desk expects when a guest says "same stay, a day later". Check-out can never be
 * on or before check-in.
 */
export function StayRangeField({
  value,
  onChange,
  today,
  timeFormat = '12h',
  maxNights = 90,
  disabled,
  idPrefix = 'stay',
  className,
}: StayRangeFieldProps) {
  const nights = Math.max(1, nightsBetween(value.checkin, value.checkout));
  const [editingNights, setEditingNights] = React.useState(false);
  const [nightsDraft, setNightsDraft] = React.useState(String(nights));

  React.useEffect(() => setNightsDraft(String(nights)), [nights]);

  function setNights(n: number) {
    const clamped = Math.min(maxNights, Math.max(1, Math.round(n)));
    onChange({ ...value, checkout: addDaysIso(value.checkin, clamped) });
  }

  const label = 'mb-1.5 block text-sm font-medium text-ink-2';

  return (
    <div className={cn('flex flex-wrap items-end gap-y-3', className)}>
      <div className="min-w-0">
        <label htmlFor={`${idPrefix}-checkin`} className={label}>
          Check-in
        </label>
        <div className="flex">
          <DatePicker
            id={`${idPrefix}-checkin`}
            aria-label="Check-in date"
            value={value.checkin}
            today={today}
            min={today}
            disabled={disabled}
            attach="right"
            className="w-36"
            onChange={(checkin) =>
              onChange({ ...value, checkin, checkout: addDaysIso(checkin, nights) })
            }
          />
          <TimePicker
            aria-label="Check-in time"
            value={value.checkinTime}
            format={timeFormat}
            minuteStep={5}
            disabled={disabled}
            attach="left"
            className="-ml-px w-32"
            onChange={(checkinTime) => onChange({ ...value, checkinTime })}
          />
        </div>
      </div>

      {editingNights ? (
        <input
          autoFocus
          aria-label="Nights"
          inputMode="numeric"
          value={nightsDraft}
          onChange={(e) => setNightsDraft(e.target.value.replace(/\D/g, ''))}
          onBlur={() => {
            setEditingNights(false);
            if (nightsDraft) setNights(Number(nightsDraft));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setNightsDraft(String(nights));
              setEditingNights(false);
            }
          }}
          className="mx-1 h-9 w-14 rounded-md border border-brass bg-surface text-center text-sm font-bold tabular-nums text-ink outline-none ring-2 ring-brass-soft"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={`${nights} ${nights === 1 ? 'night' : 'nights'} — change`}
          onClick={() => setEditingNights(true)}
          className="mx-1 flex h-9 w-14 flex-col items-center justify-center rounded-md bg-brand leading-none text-white transition duration-1 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass disabled:opacity-50"
        >
          <span className="text-sm font-bold tabular-nums">{nights}</span>
          <span className="mt-0.5 text-[10px] font-medium">
            {nights === 1 ? 'Night' : 'Nights'}
          </span>
        </button>
      )}

      <div className="min-w-0">
        <label htmlFor={`${idPrefix}-checkout`} className={label}>
          Check-out
        </label>
        <div className="flex">
          <DatePicker
            id={`${idPrefix}-checkout`}
            aria-label="Check-out date"
            value={value.checkout}
            today={today}
            min={addDaysIso(value.checkin, 1)}
            max={addDaysIso(value.checkin, maxNights)}
            rangeStart={value.checkin}
            rangeEnd={value.checkout}
            disabled={disabled}
            attach="right"
            className="w-36"
            onChange={(checkout) => onChange({ ...value, checkout })}
          />
          <TimePicker
            aria-label="Check-out time"
            value={value.checkoutTime}
            format={timeFormat}
            minuteStep={5}
            disabled={disabled}
            attach="left"
            className="-ml-px w-32"
            onChange={(checkoutTime) => onChange({ ...value, checkoutTime })}
          />
        </div>
      </div>
    </div>
  );
}
