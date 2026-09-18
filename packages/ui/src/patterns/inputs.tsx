'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import {
  CaretDown,
  CaretUp,
  Check,
  CheckCircle,
  Info,
  MagnifyingGlass,
  Warning,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { countryList, normalizePhone, type NormalizedPhone } from '@yohobed/locale';
import { cn } from '../lib/cn';

/**
 * The reservation form's input kit (Development Phase 02): a stepper, a searchable select, a phone
 * number with its country, and the small surfaces around a form — an inline alert and a
 * label/value summary.
 */

const CONTROL =
  'rounded-lg border border-line-strong bg-surface text-sm text-ink transition duration-1 ' +
  'hover:border-ink-3 focus-within:border-brass focus-within:ring-2 focus-within:ring-brass-soft';

const PANEL =
  'z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-raised outline-none ' +
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-2 ease-smooth';

// --- NumberStepper -------------------------------------------------------------

export interface NumberStepperProps {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}

/** A number with up/down arrows — Yanolja's "Room(s)". Arrow keys step; typing is clamped. */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  id,
  'aria-label': ariaLabel,
  disabled,
  className,
}: NumberStepperProps) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => onChange(clamp(n));

  const arrow =
    'flex h-1/2 w-6 items-center justify-center text-ink-3 transition duration-1 hover:bg-surface-2 hover:text-ink disabled:opacity-40';
  return (
    <div className={cn(CONTROL, 'flex h-9 overflow-hidden', disabled && 'opacity-50', className)}>
      <input
        id={id}
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
        aria-valuenow={value}
        inputMode="numeric"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={() => (draft === '' ? setDraft(String(value)) : set(Number(draft)))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            set(value + step);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            set(value - step);
          } else if (e.key === 'Enter' && draft !== '') {
            set(Number(draft));
          }
        }}
        className="h-full w-full min-w-0 bg-transparent pl-3 tabular-nums outline-none"
      />
      <div className="flex flex-col border-l border-line">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increase"
          disabled={disabled || value >= max}
          onClick={() => set(value + step)}
          className={arrow}
        >
          <CaretUp size={10} weight="bold" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrease"
          disabled={disabled || value <= min}
          onClick={() => set(value - step)}
          className={cn(arrow, 'border-t border-line')}
        >
          <CaretDown size={10} weight="bold" />
        </button>
      </div>
    </div>
  );
}

// --- Combobox ------------------------------------------------------------------

export interface ComboboxOption {
  value: string;
  label: string;
  /** Muted text on the right: a code, a count. */
  hint?: string;
  /** Extra words the search matches (a short code, an alias). */
  keywords?: string[];
  /** Drawn before the label: a colour dot, a flag of a status. */
  prefix?: React.ReactNode;
  disabled?: boolean;
  group?: string;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Offer "clear" in the list. */
  clearable?: boolean;
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
  /** The list's width when it should be wider than the trigger. */
  contentClassName?: string;
}

/**
 * A select you can type into — Yanolja's Business Source dropdown. Typing filters by label,
 * hint and keywords; arrows and Enter pick. Groups are headed when options carry `group`.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = '-Select-',
  searchPlaceholder = 'Search…',
  emptyText = 'Nothing matches that.',
  clearable,
  id,
  'aria-label': ariaLabel,
  disabled,
  className,
  contentClassName,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  const groups = React.useMemo(() => {
    const out = new Map<string, ComboboxOption[]>();
    for (const o of options) {
      const g = o.group ?? '';
      out.set(g, [...(out.get(g) ?? []), o]);
    }
    return [...out.entries()];
  }, [options]);

  function pick(v: string | null) {
    onChange(v);
    setOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            CONTROL,
            'flex h-9 w-full items-center justify-between gap-2 px-3 text-left outline-none',
            'focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass-soft',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('flex min-w-0 items-center gap-2', !selected && 'text-ink-3')}>
            {selected?.prefix}
            <span className="truncate">{selected ? selected.label : placeholder}</span>
          </span>
          <CaretDown size={13} className="shrink-0 text-ink-3" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          className={cn(
            PANEL,
            'w-[var(--radix-popover-trigger-width)] min-w-[14rem]',
            contentClassName,
          )}
        >
          <Command
            loop
            filter={(itemValue, search, keywords) => {
              const hay = [itemValue, ...(keywords ?? [])].join(' ').toLowerCase();
              return hay.includes(search.toLowerCase().trim()) ? 1 : 0;
            }}
          >
            <div className="flex items-center gap-2 border-b border-line px-3">
              <MagnifyingGlass size={14} className="shrink-0 text-ink-3" />
              <Command.Input
                autoFocus
                placeholder={searchPlaceholder}
                className="h-9 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              <Command.Empty className="px-2 py-6 text-center text-sm text-ink-3">
                {emptyText}
              </Command.Empty>
              {clearable && value && (
                <Command.Item
                  value="__clear"
                  keywords={['clear', 'none']}
                  onSelect={() => pick(null)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-3 data-[selected=true]:bg-surface-2"
                >
                  <X size={13} /> Clear
                </Command.Item>
              )}
              {groups.map(([group, items]) => (
                <Command.Group
                  key={group || '_'}
                  heading={group || undefined}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-3"
                >
                  {items.map((o) => (
                    <Command.Item
                      key={o.value}
                      value={`${o.label} ${o.value}`}
                      keywords={[o.hint ?? '', ...(o.keywords ?? [])]}
                      disabled={o.disabled}
                      onSelect={() => pick(o.value)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink',
                        'data-[selected=true]:bg-surface-2 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-50',
                      )}
                    >
                      {o.prefix}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.hint && <span className="shrink-0 text-xs text-ink-3">{o.hint}</span>}
                      {o.value === value && <Check size={13} className="shrink-0 text-brand-ink" />}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// --- Country and phone -----------------------------------------------------------

/** Every country as a Combobox option, the home markets first. */
export function countryOptions(): ComboboxOption[] {
  return countryList().map((c) => ({
    value: c.code,
    label: c.name,
    hint: c.code,
    keywords: [c.code, `+${c.dialCode}`],
  }));
}

export interface CountrySelectProps extends Omit<ComboboxProps, 'options'> {}

export function CountrySelect(props: CountrySelectProps) {
  const options = React.useMemo(countryOptions, []);
  return <Combobox searchPlaceholder="Search countries…" {...props} options={options} />;
}

export interface PhoneValue {
  /** What was typed. */
  number: string;
  /** The country a number without a prefix is read in. */
  country: string;
}

export interface PhoneInputProps {
  value: PhoneValue;
  onChange: (next: PhoneValue, parsed: NormalizedPhone | null) => void;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A mobile number with its country code. A number typed with a "+" prefix speaks for itself; one
 * without is read in the chosen country, which starts as the hotel's — so "077 123 4567" at a
 * Colombo desk is +94 77 123 4567. The parsed E.164 is handed back with every change.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  'aria-label': ariaLabel = 'Mobile',
  placeholder = 'Mobile',
  disabled,
  className,
}: PhoneInputProps) {
  const [open, setOpen] = React.useState(false);
  const countries = React.useMemo(countryList, []);
  const parsed = value.number.trim() ? normalizePhone(value.number, value.country) : null;
  // A number typed with its own "+" prefix speaks for itself; show the country it belongs to.
  const typed = value.number.trim().startsWith('+') ? (parsed?.country ?? null) : null;
  const badge = typed ?? value.country;
  const dial = countries.find((c) => c.code === badge)?.dialCode ?? '';

  return (
    <div className={cn(CONTROL, 'flex h-9 overflow-hidden', disabled && 'opacity-50', className)}>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Country code: ${badge} +${dial}`}
            className="flex shrink-0 items-center gap-1 border-r border-line px-2.5 text-xs font-semibold tabular-nums text-ink-2 transition duration-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            {badge} +{dial}
            <CaretDown size={10} className="text-ink-3" />
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content align="start" sideOffset={6} className={cn(PANEL, 'w-72')}>
            <Command loop>
              <div className="flex items-center gap-2 border-b border-line px-3">
                <MagnifyingGlass size={14} className="shrink-0 text-ink-3" />
                <Command.Input
                  autoFocus
                  placeholder="Search countries…"
                  className="h-9 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
                />
              </div>
              <Command.List className="max-h-64 overflow-y-auto p-1">
                <Command.Empty className="px-2 py-6 text-center text-sm text-ink-3">
                  No country matches that.
                </Command.Empty>
                {countries.map((c) => (
                  <Command.Item
                    key={c.code}
                    value={`${c.name} ${c.code} +${c.dialCode}`}
                    onSelect={() => {
                      setOpen(false);
                      const next = { ...value, country: c.code };
                      onChange(
                        next,
                        next.number.trim() ? normalizePhone(next.number, c.code) : null,
                      );
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink data-[selected=true]:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="text-xs tabular-nums text-ink-3">+{c.dialCode}</span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <input
        id={id}
        type="tel"
        aria-label={ariaLabel}
        aria-invalid={parsed === null && value.number.trim() !== '' ? true : undefined}
        autoComplete="tel"
        disabled={disabled}
        placeholder={placeholder}
        value={value.number}
        onChange={(e) => {
          const next = { ...value, number: e.target.value };
          onChange(next, next.number.trim() ? normalizePhone(next.number, next.country) : null);
        }}
        className="h-full w-full min-w-0 bg-transparent px-3 tabular-nums outline-none placeholder:text-ink-3"
      />
    </div>
  );
}

// --- InlineAlert and SummaryList -------------------------------------------------

export type AlertTone = 'info' | 'warn' | 'error' | 'success';

const ALERT: Record<AlertTone, { box: string; icon: React.ElementType }> = {
  info: { box: 'bg-info-soft text-info-ink', icon: Info },
  warn: { box: 'bg-low-soft text-low-ink', icon: Warning },
  error: { box: 'bg-closed-soft text-closed-ink', icon: WarningCircle },
  success: { box: 'bg-avail-soft text-avail-ink', icon: CheckCircle },
};

/** A message inside a form or panel — never a toast for something the user must act on here. */
export function InlineAlert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const { box, icon: Icon } = ALERT[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-sm', box, className)}
    >
      <Icon size={16} weight="fill" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'text-[13px]')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export interface SummaryRow {
  label: React.ReactNode;
  value: React.ReactNode;
  /** The bold total line. */
  emphasis?: boolean;
  /** Smaller and muted — a breakdown under the line above. */
  sub?: boolean;
}

/** Label on the left, money on the right — the Billing Summary's rows. */
export function SummaryList({ rows, className }: { rows: SummaryRow[]; className?: string }) {
  return (
    <dl className={cn('flex flex-col gap-1.5', className)}>
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            'flex items-baseline justify-between gap-4',
            r.emphasis && 'mt-1 border-t border-line pt-2',
            r.sub && 'pl-3',
          )}
        >
          <dt
            className={cn(
              'text-sm',
              r.emphasis ? 'font-semibold text-ink' : r.sub ? 'text-xs text-ink-3' : 'text-ink-2',
            )}
          >
            {r.label}
          </dt>
          <dd
            className={cn(
              'font-mono tabular-nums',
              r.emphasis
                ? 'text-base font-bold text-ink'
                : r.sub
                  ? 'text-xs text-ink-3'
                  : 'text-sm text-ink',
            )}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
