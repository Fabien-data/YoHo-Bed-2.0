'use client';

import * as React from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { EmptyState, SegmentedControl } from '@yohobed/ui';
import type { StayBar, StayView } from '@/lib/api';
import { STATE_ICON } from './icons';
import { shortDate, stayRange } from './model/dates';
import { STATE_META, stateOf } from './model/status';

type Tab = 'arrivals' | 'inhouse' | 'departures';

/**
 * On a phone the full grid would be a miniature no one can use, so the day is a list: who
 * arrives, who is in, who leaves — each a tap from its panel. The timeline is one switch away.
 */
export function MobileDayList({
  data,
  date,
  onOpen,
}: {
  data: StayView;
  date: string;
  onOpen: (bar: StayBar) => void;
}) {
  const [tab, setTab] = React.useState<Tab>('arrivals');
  const rooms = new Map(
    data.roomTypes.flatMap((rt) => rt.units.map((u) => [u.id, u.code] as const)),
  );
  const bars = [
    ...data.roomTypes.flatMap((rt) => rt.units.flatMap((u) => u.bars)),
    ...data.unassigned,
  ].filter((b) => b.kind === 'booking');
  // One row per reservation, not per room segment.
  const seen = new Set<string>();
  const list = bars
    .filter((b) =>
      tab === 'arrivals'
        ? b.from === date && (b.segment?.index ?? 0) === 0
        : tab === 'departures'
          ? b.to === date && (b.segment?.index ?? 0) === (b.segment?.of ?? 1) - 1
          : b.status === 'CheckedIn' && b.from <= date && date < b.to,
    )
    .filter((b) => {
      const key = b.bookingId ?? b.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.guestName ?? '').localeCompare(b.guestName ?? ''));
  const count = (t: Tab) =>
    t === 'arrivals'
      ? bars.filter((b) => b.from === date && (b.segment?.index ?? 0) === 0).length
      : t === 'departures'
        ? bars.filter((b) => b.to === date).length
        : bars.filter((b) => b.status === 'CheckedIn' && b.from <= date && date < b.to).length;

  return (
    <div aria-label="Daily stay list" className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-3">{shortDate(date)}</p>
      <SegmentedControl
        aria-label="Day list"
        value={tab}
        onChange={setTab}
        className="w-full"
        options={[
          { value: 'arrivals', label: `Arriving ${count('arrivals')}` },
          { value: 'inhouse', label: `In house ${count('inhouse')}` },
          { value: 'departures', label: `Leaving ${count('departures')}` },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState
          title="No one here today"
          description="Switch tabs, change the date, or open the timeline."
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {list.map((bar) => {
            const Icon = STATE_ICON[stateOf(bar)];
            return (
              <li key={bar.id}>
                <button
                  type="button"
                  onClick={() => onOpen(bar)}
                  className="flex min-h-[3.25rem] w-full items-center gap-3 px-3 py-2.5 text-left active:bg-surface-2"
                >
                  <span
                    className="sv-bar !static h-8 w-8 shrink-0 justify-center !p-0"
                    data-state={stateOf(bar)}
                    data-arrival="true"
                    data-departure="true"
                  >
                    <Icon size={14} weight="bold" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {bar.guestName}
                    </span>
                    <span className="block truncate text-xs text-ink-3">
                      {bar.roomUnitId ? `Room ${rooms.get(bar.roomUnitId) ?? ''}` : 'No room yet'} ·{' '}
                      {stayRange(bar.from, bar.to)} · {STATE_META[stateOf(bar)].label}
                    </span>
                  </span>
                  <CaretRight size={14} className="shrink-0 text-ink-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
