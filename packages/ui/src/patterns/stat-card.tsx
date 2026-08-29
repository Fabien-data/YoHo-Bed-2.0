'use client';

import * as React from 'react';
import { cn } from '../lib/cn';
import { Card, type Tone } from '../primitives/surfaces';

const ICON_TONES: Record<Tone, string> = {
  avail: 'bg-avail-soft text-avail-ink',
  low: 'bg-low-soft text-low-ink',
  closed: 'bg-closed-soft text-closed-ink',
  brand: 'bg-brand-soft text-brand-ink',
  brass: 'bg-brass-soft text-brass-ink',
  info: 'bg-info-soft text-info-ink',
  muted: 'bg-surface-2 text-ink-2',
};

/**
 * The KPI tile — icon in a tinted square, small label, one large tabular number
 * (Yanolja's Searches / Availability Ratio / Active Partners / Conversion row).
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** A qualifier under the number — "Last 30 days", "+2 vs yesterday". */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={cn('flex items-start gap-3 p-4', className)}>
      {icon && (
        <div
          className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', ICON_TONES[tone])}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-ink-2">{label}</div>
        <div className="mt-0.5 text-2xl font-semibold tracking-tight text-ink tabular-nums">
          {value}
        </div>
        {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
      </div>
    </Card>
  );
}
