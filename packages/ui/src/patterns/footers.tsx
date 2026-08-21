'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * The sticky Total / Paid / Balance block that Yanolja pins to the bottom of every reservation
 * surface. A non-zero balance is always the red line — that is the number a front-desk agent is
 * looking for, so it never has to be hunted.
 */
export function MoneyFooter({
  total,
  paid,
  balance,
  format,
  className,
}: {
  total: number;
  paid: number;
  balance: number;
  /** Formats a number into the property's currency. Defaults to a plain 2-dp string. */
  format?: (n: number) => string;
  className?: string;
}) {
  const fmt = format ?? ((n: number) => n.toFixed(2));
  const rows: Array<[string, number, boolean]> = [
    ['Total', total, false],
    ['Paid', paid, false],
    ['Balance', balance, balance !== 0],
  ];
  return (
    <dl className={cn('flex flex-col gap-1', className)}>
      {rows.map(([label, value, alert]) => (
        <div key={label} className="flex items-baseline justify-between gap-4">
          <dt
            className={cn(
              'text-sm',
              alert ? 'font-semibold text-[var(--closed-ink)]' : 'text-ink-2',
            )}
          >
            {label}
          </dt>
          <dd
            className={cn(
              'font-mono text-sm tabular-nums',
              alert ? 'font-semibold text-[var(--closed-ink)]' : 'text-ink',
            )}
          >
            {fmt(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface MetricColumn {
  key: string;
  /** One value per date column, aligned with the grid above. */
  values: Array<number | string>;
}

/**
 * The sticky metric rows under a date grid — Yanolja's `Sold Rooms / Available Inventory /
 * Total Rooms` and `Available Inventory / Occupancy %`. Rendered as a real table so the columns
 * line up with the grid and a screen reader can still read a row.
 */
export function MetricFooter({
  rows,
  labelWidth = 180,
  columnWidth = 92,
  renderCell,
  className,
}: {
  rows: Array<{ label: string; hint?: string; values: Array<number | string> }>;
  labelWidth?: number;
  columnWidth?: number;
  renderCell?: (value: number | string, rowLabel: string, index: number) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('border-t border-line bg-surface-2', className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex items-stretch border-b border-line last:border-b-0">
          <div
            className="flex shrink-0 items-center px-4 py-2 text-xs font-semibold text-ink-2"
            style={{ width: labelWidth }}
            title={row.hint}
          >
            {row.label}
          </div>
          {row.values.map((v, i) => (
            <div
              key={i}
              className="flex shrink-0 items-center justify-center border-l border-line px-1 py-2 font-mono text-xs tabular-nums text-ink"
              style={{ width: columnWidth }}
            >
              {renderCell ? renderCell(v, row.label, i) : v}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
