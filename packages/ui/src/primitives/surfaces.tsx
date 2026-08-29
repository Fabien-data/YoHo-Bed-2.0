'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

// --- Card --------------------------------------------------------------------

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('rounded-xl border border-line bg-surface shadow-card', className)}
        {...props}
      />
    );
  },
);

// --- Badge -------------------------------------------------------------------

export type Tone = 'avail' | 'low' | 'closed' | 'brand' | 'brass' | 'info' | 'muted';

const TONES: Record<Tone, string> = {
  avail: 'bg-avail-soft text-avail-ink',
  low: 'bg-low-soft text-low-ink',
  closed: 'bg-closed-soft text-closed-ink',
  brand: 'bg-brand-soft text-brand-ink',
  brass: 'bg-brass-soft text-brass-ink',
  info: 'bg-info-soft text-info-ink',
  muted: 'bg-surface-2 text-ink-2',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Show the leading status dot. */
  dot?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'muted', dot = true, className, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
});

// --- Kbd ---------------------------------------------------------------------

/** A keyboard hint chip — command palette, tooltips, shortcut affordances. */
export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong',
        'bg-surface-2 px-1.5 font-mono text-[11px] font-medium text-ink-2',
        className,
      )}
      {...props}
    />
  );
}

// --- Skeleton ----------------------------------------------------------------

export function Skeleton({
  className,
  shimmer = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { shimmer?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-surface-2',
        shimmer
          ? 'animate-shimmer bg-gradient-to-r from-surface-2 via-line to-surface-2 bg-[length:200%_100%]'
          : 'animate-pulse',
        className,
      )}
      {...props}
    />
  );
}

// --- EmptyState --------------------------------------------------------------

/** The default "empty tray" glyph — one drawing everywhere, so empty never reads as broken. */
function TrayGlyph() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 14h30l3 14v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-8l3-14Z" />
      <path d="M6 28h10l3 5h10l3-5h10" />
    </svg>
  );
}

/**
 * Yanolja shows the same "No data" illustration + primary CTA on every empty list. Consistency
 * here is what stops an empty screen reading as a broken screen.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-16 text-center', className)}
    >
      <div className="mb-3 text-ink-3 opacity-60">{icon ?? <TrayGlyph />}</div>
      <p className="text-sm font-semibold text-ink-2">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --- PageHeader --------------------------------------------------------------

/**
 * The one page header. Every screen uses this — a single H1 scale is a large part of what makes
 * the product read as one system instead of many pages.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1 font-mono text-[11px] font-medium uppercase tracking-widest text-ink-3">
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1.5 max-w-2xl text-sm text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
