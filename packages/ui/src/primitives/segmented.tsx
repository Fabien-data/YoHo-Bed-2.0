'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface SegmentedOption<T extends string = string> {
  value: T;
  /** Text label, an icon, or both. */
  label: React.ReactNode;
  /** Accessible name when `label` is icon-only. */
  ariaLabel?: string;
}

/**
 * A compact segmented control — the list ⇄ card view toggle, Individual ⇄ Group switch,
 * Posting Date ⇄ Departure Date choice. For filters WITH counts use `CountedChips`; this is
 * for mutually exclusive presentation modes.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  'aria-label': ariaLabel = 'View',
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-line-strong bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition duration-1 ease-smooth',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass',
              active ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
