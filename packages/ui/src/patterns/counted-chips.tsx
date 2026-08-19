'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import type { Tone } from '../primitives/surfaces';

export interface Chip<T extends string = string> {
  value: T;
  label: string;
  count?: number;
  tone?: Tone;
}

const ACTIVE_TONES: Record<Tone, string> = {
  avail: 'border-[var(--avail-ink)] text-[var(--avail-ink)] bg-[var(--avail-soft)]',
  low: 'border-[var(--low-ink)] text-[var(--low-ink)] bg-[var(--low-soft)]',
  closed: 'border-[var(--closed-ink)] text-[var(--closed-ink)] bg-[var(--closed-soft)]',
  brand: 'border-[var(--brand-ink)] text-[var(--brand-ink)] bg-[var(--brand-soft)]',
  info: 'border-[var(--info)] text-[var(--info)] bg-surface-2',
  muted: 'border-ink text-white bg-ink',
};

/**
 * The counted filter chips that head Stay View, Room View and Reservations
 * (`All 8 · Vacant 2 · Occupied 4 · Reserved 1 · Blocked 1 · Due Out 1 · Dirty 8`).
 *
 * The count is the point: staff scan the numbers to decide where the day's work is, so a chip
 * always reserves space for one even while it is still loading.
 */
export function CountedChips<T extends string>({
  chips,
  value,
  onChange,
  loading,
  className,
  'aria-label': ariaLabel = 'Filter',
}: {
  chips: readonly Chip<T>[];
  value: T;
  onChange: (value: T) => void;
  loading?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cn('flex flex-wrap gap-2', className)}>
      {chips.map((chip) => {
        const active = chip.value === value;
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              active
                ? ACTIVE_TONES[chip.tone ?? 'muted']
                : 'border-line-strong bg-surface text-ink-2 hover:text-ink',
            )}
          >
            {chip.label}
            <span
              className={cn(
                'min-w-[1.25rem] rounded-full px-1 text-[11px] font-semibold tabular-nums',
                active ? 'bg-black/10' : 'bg-surface-2 text-ink-3',
                loading && 'animate-pulse',
              )}
            >
              {loading ? '·' : (chip.count ?? 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
