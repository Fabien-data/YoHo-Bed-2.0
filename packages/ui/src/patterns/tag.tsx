'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Chips and dots in the categorical palette — business sources, market segments, reservation
 * kinds.
 *
 * The class names are spelled out in full (not built from the key at runtime) because Tailwind
 * only generates classes it can find literally in the source.
 */
const TAG_CLASSES: Record<string, { dot: string; chip: string; bar: string }> = {
  slate: {
    dot: 'bg-tag-slate',
    chip: 'bg-tag-slate-soft text-tag-slate-ink',
    bar: 'border-tag-slate bg-tag-slate-soft text-tag-slate-ink',
  },
  red: {
    dot: 'bg-tag-red',
    chip: 'bg-tag-red-soft text-tag-red-ink',
    bar: 'border-tag-red bg-tag-red-soft text-tag-red-ink',
  },
  orange: {
    dot: 'bg-tag-orange',
    chip: 'bg-tag-orange-soft text-tag-orange-ink',
    bar: 'border-tag-orange bg-tag-orange-soft text-tag-orange-ink',
  },
  amber: {
    dot: 'bg-tag-amber',
    chip: 'bg-tag-amber-soft text-tag-amber-ink',
    bar: 'border-tag-amber bg-tag-amber-soft text-tag-amber-ink',
  },
  yellow: {
    dot: 'bg-tag-yellow',
    chip: 'bg-tag-yellow-soft text-tag-yellow-ink',
    bar: 'border-tag-yellow bg-tag-yellow-soft text-tag-yellow-ink',
  },
  lime: {
    dot: 'bg-tag-lime',
    chip: 'bg-tag-lime-soft text-tag-lime-ink',
    bar: 'border-tag-lime bg-tag-lime-soft text-tag-lime-ink',
  },
  green: {
    dot: 'bg-tag-green',
    chip: 'bg-tag-green-soft text-tag-green-ink',
    bar: 'border-tag-green bg-tag-green-soft text-tag-green-ink',
  },
  emerald: {
    dot: 'bg-tag-emerald',
    chip: 'bg-tag-emerald-soft text-tag-emerald-ink',
    bar: 'border-tag-emerald bg-tag-emerald-soft text-tag-emerald-ink',
  },
  teal: {
    dot: 'bg-tag-teal',
    chip: 'bg-tag-teal-soft text-tag-teal-ink',
    bar: 'border-tag-teal bg-tag-teal-soft text-tag-teal-ink',
  },
  cyan: {
    dot: 'bg-tag-cyan',
    chip: 'bg-tag-cyan-soft text-tag-cyan-ink',
    bar: 'border-tag-cyan bg-tag-cyan-soft text-tag-cyan-ink',
  },
  sky: {
    dot: 'bg-tag-sky',
    chip: 'bg-tag-sky-soft text-tag-sky-ink',
    bar: 'border-tag-sky bg-tag-sky-soft text-tag-sky-ink',
  },
  blue: {
    dot: 'bg-tag-blue',
    chip: 'bg-tag-blue-soft text-tag-blue-ink',
    bar: 'border-tag-blue bg-tag-blue-soft text-tag-blue-ink',
  },
  indigo: {
    dot: 'bg-tag-indigo',
    chip: 'bg-tag-indigo-soft text-tag-indigo-ink',
    bar: 'border-tag-indigo bg-tag-indigo-soft text-tag-indigo-ink',
  },
  violet: {
    dot: 'bg-tag-violet',
    chip: 'bg-tag-violet-soft text-tag-violet-ink',
    bar: 'border-tag-violet bg-tag-violet-soft text-tag-violet-ink',
  },
  purple: {
    dot: 'bg-tag-purple',
    chip: 'bg-tag-purple-soft text-tag-purple-ink',
    bar: 'border-tag-purple bg-tag-purple-soft text-tag-purple-ink',
  },
  pink: {
    dot: 'bg-tag-pink',
    chip: 'bg-tag-pink-soft text-tag-pink-ink',
    bar: 'border-tag-pink bg-tag-pink-soft text-tag-pink-ink',
  },
  rose: {
    dot: 'bg-tag-rose',
    chip: 'bg-tag-rose-soft text-tag-rose-ink',
    bar: 'border-tag-rose bg-tag-rose-soft text-tag-rose-ink',
  },
};

function classesFor(color: string | null | undefined) {
  return TAG_CLASSES[color ?? ''] ?? TAG_CLASSES.slate!;
}

/** The palette keys, in display order. */
export const TAG_COLOR_KEYS = Object.keys(TAG_CLASSES);

/** A small solid swatch. */
export function TagDot({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
        classesFor(color).dot,
        className,
      )}
    />
  );
}

/**
 * A tinted chip — the source/segment/kind label everywhere it appears. `code` renders as a
 * monospace prefix (e.g. "BDC"), the way Yanolja identifies a source at a glance.
 */
export function TagChip({
  color,
  code,
  children,
  className,
  title,
}: {
  color?: string | null;
  code?: string;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold',
        classesFor(color).chip,
        className,
      )}
    >
      {code && <span className="font-mono text-[11px] tracking-wide">{code}</span>}
      {children && <span className="truncate">{children}</span>}
    </span>
  );
}

/** Classes for a tinted bar with a solid leading edge (Stay View, list rows). */
export function tagBarClasses(color: string | null | undefined): string {
  return classesFor(color).bar;
}

/**
 * A palette picker: one swatch per colour, the chosen one ringed. It behaves as a radio group —
 * one tab stop, arrow keys move the choice.
 */
export function TagColorPicker({
  value,
  onChange,
  label = 'Colour',
  disabled,
  className,
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const swatches = React.useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, TAG_COLOR_KEYS.indexOf(value));

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = TAG_COLOR_KEYS.length - 1;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    onChange(TAG_COLOR_KEYS[next]!);
    swatches.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {TAG_COLOR_KEYS.map((key, i) => {
        const selected = key === value;
        return (
          <button
            key={key}
            ref={(el) => {
              swatches.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            title={key}
            tabIndex={i === current ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full border transition duration-1',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected ? 'border-ink' : 'border-transparent hover:border-line-strong',
            )}
          >
            <span className={cn('h-4 w-4 rounded-full', classesFor(key).dot)} />
          </button>
        );
      })}
    </div>
  );
}
