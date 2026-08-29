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

/** Toned active chips stay tinted; the default (`muted`) is Yanolja's dark filled pill. */
const ACTIVE_TONES: Record<Tone, string> = {
  avail: 'border-avail-ink text-avail-ink bg-avail-soft',
  low: 'border-low-ink text-low-ink bg-low-soft',
  closed: 'border-closed-ink text-closed-ink bg-closed-soft',
  brand: 'border-brand-ink text-brand-ink bg-brand-soft',
  brass: 'border-brass-ink text-brass-ink bg-brass-soft',
  info: 'border-info-ink text-info-ink bg-info-soft',
  muted: 'border-brand bg-brand text-white',
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
        const muted = (chip.tone ?? 'muted') === 'muted';
        return (
          <button
            key={chip.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition duration-1 ease-smooth',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass',
              active
                ? ACTIVE_TONES[chip.tone ?? 'muted']
                : 'border-line-strong bg-surface text-ink-2 hover:border-ink-3 hover:text-ink',
            )}
          >
            {chip.label}
            <span
              className={cn(
                'min-w-[1.25rem] rounded-full px-1 text-center text-[11px] font-semibold tabular-nums',
                active ? (muted ? 'bg-white/20' : 'bg-surface/80') : 'bg-surface-2 text-ink-3',
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
