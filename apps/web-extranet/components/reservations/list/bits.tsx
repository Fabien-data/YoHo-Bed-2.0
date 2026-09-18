'use client';

import * as React from 'react';
import { Hourglass, Person } from '@phosphor-icons/react';
import { Badge, TagChip, Tooltip, cn } from '@yohobed/ui';
import { formatDate, formatTime } from '@yohobed/locale';
import type { ReservationConfig, ReservationRow } from '@/lib/api';

type Kinds = ReservationConfig['kinds'];

/**
 * Small pieces of the Reservations list (Development Phase 02, Sprint 4), shared by the table,
 * the cards and the detail sheet.
 */

/** "3 adults, 1 child" as Yanolja draws it: a tall figure per adult count, a small one for children. */
export function Pax({
  adults,
  children,
  className,
}: {
  adults: number;
  children: number;
  className?: string;
}) {
  const label = `${adults} adult${adults === 1 ? '' : 's'}${children ? `, ${children} child${children === 1 ? '' : 'ren'}` : ''}`;
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-xs text-ink-2', className)}
      aria-label={label}
      title={label}
    >
      <span className="inline-flex items-end gap-0.5">
        <Person size={15} weight="fill" aria-hidden />
        <span className="font-mono tabular-nums">{adults}</span>
      </span>
      <span className={cn('inline-flex items-end gap-0.5', children === 0 && 'text-ink-3')}>
        <Person size={11} weight="fill" aria-hidden />
        <span className="font-mono tabular-nums">{children}</span>
      </span>
    </span>
  );
}

/** "in 3h 20m", "in 2 days", or "overdue". */
export function releaseIn(holdUntil: string, now = Date.now()): string {
  const ms = Date.parse(holdUntil) - now;
  if (ms <= 0) return 'overdue';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  return `in ${Math.round(hours / 24)} days`;
}

const STATUS_BADGE: Record<
  string,
  { label: string; tone: 'avail' | 'muted' | 'closed' | 'brand' }
> = {
  CheckedIn: { label: 'Checked in', tone: 'avail' },
  CheckedOut: { label: 'Checked out', tone: 'muted' },
  Cancelled: { label: 'Cancelled', tone: 'closed' },
  Rejected: { label: 'Rejected', tone: 'closed' },
  NoShow: { label: 'No-show', tone: 'closed' },
};

/**
 * What a reservation is, in one chip: before arrival, its reservation type (Confirmed, Hold,
 * Inquiry…) in the property's colours; after that, what happened to it. A hold also says when it
 * lets its rooms go.
 */
export function StatusChip({
  row,
  kinds,
}: {
  row: Pick<ReservationRow, 'status' | 'reservationKind' | 'holdUntil'>;
  kinds: Kinds | undefined;
}) {
  const after = STATUS_BADGE[row.status];
  if (after) return <Badge tone={after.tone}>{after.label}</Badge>;
  const kind = kinds?.find((k) => k.kind === row.reservationKind);
  const isHold = row.reservationKind === 'hold_confirm' || row.reservationKind === 'hold_unconfirm';
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <TagChip color={kind?.color}>{kind?.label ?? row.reservationKind}</TagChip>
      {isHold && row.holdUntil && (
        <Tooltip label={`Rooms go back on sale ${new Date(row.holdUntil).toLocaleString()}`}>
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px]',
              releaseIn(row.holdUntil) === 'overdue' ? 'text-closed-ink' : 'text-low-ink',
            )}
          >
            <Hourglass size={11} aria-hidden />
            Releases {releaseIn(row.holdUntil)}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

/** dd/mm/yyyy and a 12-hour time in the hotel's own timezone. */
export function bookedAt(iso: string, timeZone: string): { date: string; time: string } {
  const at = new Date(iso);
  const fmt = (tz: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return {
      date: `${parts.day}/${parts.month}/${parts.year}`,
      time: `${parts.hour}:${parts.minute} ${String(parts.dayPeriod ?? '').toUpperCase()}`,
    };
  };
  try {
    return fmt(timeZone);
  } catch {
    return fmt('UTC');
  }
}

/** A stay date with its time: the booking's own, or the hotel's standard check-in / check-out. */
export function StayWhen({
  date,
  time,
  fallback,
  format = '12h',
}: {
  date: string;
  time: string | null;
  fallback: string;
  format?: '12h' | '24h';
}) {
  return (
    <span className="flex flex-col whitespace-nowrap">
      <span className="font-mono text-[13px] tabular-nums text-ink">{formatDate(date)}</span>
      <span className="text-xs text-ink-3">
        {formatTime((time ?? fallback).slice(0, 5), format)}
      </span>
    </span>
  );
}
