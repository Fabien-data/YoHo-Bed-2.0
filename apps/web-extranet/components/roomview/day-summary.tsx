'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bed, Broom, SignIn, SignOut, UserCircleDashed } from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';
import type { HouseDay } from '@/lib/api';
import { dayOfMonth, monthShort, weekday } from '@/components/stayview/model/dates';
import { occupancyPercent } from '@/components/stayview/model/stats';

/**
 * The day at a glance, above the rooms: the Stay View's date header laid out as one strip, with
 * the same numbers — the server counts them with the calendar's own logic (`day`), so the two
 * screens never disagree about the same date. Dirty rooms come from the room cards.
 */
export function DaySummary({
  date,
  today,
  day,
  dirty,
  loading,
  canOpenCalendar,
}: {
  date: string;
  today: string;
  day: HouseDay | undefined;
  dirty: number;
  loading: boolean;
  /** Whether the person can reach the Stay View to assign rooms (not housekeeping). */
  canOpenCalendar: boolean;
}) {
  const occupancy = day ? occupancyPercent(day) : null;
  const pct = occupancy === null ? '—' : `${occupancy.toFixed(2)}%`;
  const count = (n: number | undefined) => (n === undefined ? '—' : n);
  const isToday = date === today;
  const unassigned = day?.unassigned ?? 0;
  return (
    <section
      aria-label={`The day at a glance, ${weekday(date)} ${dayOfMonth(date)} ${monthShort(date)}`}
      aria-busy={loading || undefined}
      className="rv-day"
    >
      <div className="rv-day-date" data-today={isToday || undefined}>
        <span className="rv-day-label">{isToday ? 'Today' : weekday(date)}</span>
        <span className="rv-day-number">
          {dayOfMonth(date)}
          <span className="rv-day-month">{monthShort(date)}</span>
        </span>
      </div>
      <Stat
        label="Occupancy"
        value={pct}
        hint={
          day
            ? `${day.soldRooms} of ${Math.max(0, day.totalRooms - day.blocked)} rooms that can be sold are taken`
            : 'Occupancy of the rooms that can be sold'
        }
        tone={occupancy !== null && occupancy >= 90 ? 'closed' : undefined}
      >
        <span className="sv-date-meter rv-day-meter" aria-hidden>
          <span
            style={{ width: `${Math.min(100, occupancy ?? 0)}%` }}
            data-full={(occupancy ?? 0) >= 90 || undefined}
          />
        </span>
      </Stat>
      <Stat
        icon={<Bed size={13} weight="bold" aria-hidden />}
        label="Free"
        value={count(day?.availableInventory)}
        hint="Rooms still free to sell tonight"
      />
      <Stat
        icon={<SignIn size={13} weight="bold" aria-hidden />}
        label="Arrivals"
        value={count(day?.arrivals)}
        hint="Rooms arriving on this date (a room move is not an arrival)"
      />
      <Stat
        icon={<SignOut size={13} weight="bold" aria-hidden />}
        label="Departures"
        value={count(day?.departures)}
        hint="Rooms leaving on this date (a room move is not a departure)"
      />
      <Stat
        icon={<UserCircleDashed size={13} weight="bold" aria-hidden />}
        label="Unassigned"
        value={count(day?.unassigned)}
        hint={
          unassigned > 0
            ? `${unassigned} ${unassigned === 1 ? 'stay has' : 'stays have'} no room tonight${canOpenCalendar ? ' — open the Stay View to assign them' : ''}`
            : 'Every stay tonight has a room'
        }
        tone={unassigned > 0 ? 'low' : undefined}
        href={canOpenCalendar && unassigned > 0 ? `/app/stayview?from=${date}` : undefined}
      />
      <Stat
        icon={<Broom size={13} weight="bold" aria-hidden />}
        label="Dirty"
        value={dirty}
        hint="Rooms waiting to be cleaned"
        tone={dirty > 0 ? 'low' : undefined}
      />
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
  href,
  children,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone?: 'low' | 'closed';
  href?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="rv-day-label">
        {icon}
        {label}
      </span>
      <span className={cn('rv-day-value font-mono tabular-nums')} data-tone={tone}>
        {value}
      </span>
      {children}
    </>
  );
  return (
    <Tooltip label={hint}>
      {href ? (
        <Link href={href} className="rv-day-stat" aria-label={`${label}: ${value}. ${hint}`}>
          {body}
        </Link>
      ) : (
        <div className="rv-day-stat" role="group" aria-label={`${label}: ${value}. ${hint}`}>
          {body}
        </div>
      )}
    </Tooltip>
  );
}
