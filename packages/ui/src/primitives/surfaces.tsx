'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

// --- Card --------------------------------------------------------------------

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border border-line bg-surface',
          'shadow-[0_1px_2px_rgba(20,22,31,0.05),0_8px_24px_rgba(20,22,31,0.06)]',
          className,
        )}
        {...props}
      />
    );
  },
);

// --- Badge -------------------------------------------------------------------

export type Tone = 'avail' | 'low' | 'closed' | 'brand' | 'info' | 'muted';

const TONES: Record<Tone, { color: string; bg: string }> = {
  avail: { color: 'var(--avail-ink)', bg: 'var(--avail-soft)' },
  low: { color: 'var(--low-ink)', bg: 'var(--low-soft)' },
  closed: { color: 'var(--closed-ink)', bg: 'var(--closed-soft)' },
  brand: { color: 'var(--brand-ink)', bg: 'var(--brand-soft)' },
  info: { color: 'var(--info)', bg: 'var(--surface-2)' },
  muted: { color: 'var(--ink-2)', bg: 'var(--surface-2)' },
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
  const s = TONES[tone];
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        className,
      )}
      style={{ color: s.color, background: s.bg }}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {children}
    </span>
  );
});

// --- Skeleton ----------------------------------------------------------------

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-2', className)} {...props} />;
}

// --- EmptyState --------------------------------------------------------------

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
      {icon && <div className="mb-3 text-ink-3 opacity-60">{icon}</div>}
      <p className="text-sm font-semibold text-ink-2">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --- PageHeader --------------------------------------------------------------

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
          <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
            {eyebrow}
          </div>
        )}
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-2 max-w-2xl text-base text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
