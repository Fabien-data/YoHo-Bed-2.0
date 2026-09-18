'use client';

import * as React from 'react';
import { Prohibit, Wrench } from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';
import type { StayBar, StayRoomType, StayView } from '@/lib/api';

export const COL_W = 92;
export const ROW_H = 40;
export const LABEL_W = 200;

/** Colour a bar by what the front desk needs to see at a glance, the way Yanolja does. */
function barTone(bar: StayBar): string {
  if (bar.kind === 'block') return 'bg-ink-3 text-white';
  switch (bar.status) {
    case 'CheckedIn':
      return 'bg-avail text-white';
    case 'CheckedOut':
      return 'bg-ink-3 text-white';
    case 'Pending':
      return 'bg-low text-white';
    case 'NoShow':
    case 'Cancelled':
      return 'bg-closed text-white';
    default:
      return 'bg-brand text-white';
  }
}

const SOURCE_LABEL: Record<string, string> = {
  Extranet: 'Direct',
  OTA: 'OTA',
  Backend: 'YoHo',
};

/** Index of a date within the window; -1 when outside it. */
function dayIndex(dates: string[], date: string): number {
  return dates.indexOf(date);
}

/**
 * Geometry for one bar, clipped to the window.
 *
 * A stay that starts before the window or ends after it still has to draw — clipped, with the cut
 * edge squared off so it reads as "continues beyond here" rather than as a short stay.
 */
function barGeometry(dates: string[], bar: StayBar) {
  const first = dates[0]!;
  const lastExclusive = dates[dates.length - 1]!;
  const startsBefore = bar.from < first;
  // `to` is exclusive; the last drawn night is the day before it.
  const endsAfter = bar.to > lastExclusive;

  const startIdx = startsBefore ? 0 : dayIndex(dates, bar.from);
  const endIdx = endsAfter ? dates.length : dayIndex(dates, bar.to);
  const span = (endIdx < 0 ? dates.length : endIdx) - (startIdx < 0 ? 0 : startIdx);

  return {
    left: Math.max(startIdx, 0) * COL_W,
    width: Math.max(span, 1) * COL_W - 4,
    startsBefore,
    endsAfter,
  };
}

function Bar({
  bar,
  dates,
  onSelect,
}: {
  bar: StayBar;
  dates: string[];
  onSelect: (bar: StayBar) => void;
}) {
  const g = barGeometry(dates, bar);

  if (bar.kind === 'block') {
    return (
      <button
        type="button"
        onClick={() => onSelect(bar)}
        // A double-click on the row opens a new reservation; on a bar it must not.
        onDoubleClick={(e) => e.stopPropagation()}
        title={bar.reason}
        className={cn(
          'absolute top-1 flex h-[calc(100%-8px)] items-center gap-1.5 overflow-hidden rounded px-2',
          'text-left text-xs font-semibold text-white',
          !g.startsBefore && 'rounded-l',
          !g.endsAfter && 'rounded-r',
        )}
        style={{
          left: g.left + 2,
          width: g.width,
          // The hatched navy bar Yanolja uses for out-of-service rooms.
          backgroundColor: 'var(--brand)',
          backgroundImage:
            'repeating-linear-gradient(45deg, rgba(255,255,255,.16) 0 6px, transparent 6px 12px)',
        }}
      >
        <Wrench size={12} className="shrink-0" />
        <span className="truncate">{bar.reason}</span>
      </button>
    );
  }

  return (
    <Tooltip
      variant="panel"
      label={
        <div className="space-y-0.5">
          <div className="font-semibold text-ink">{bar.guestName}</div>
          <div className="text-ink-2">
            {bar.reference} · {bar.status}
          </div>
          <div className="text-ink-3">
            {bar.from} → {bar.to}
          </div>
          {bar.holdUntil && (
            <div className="font-semibold text-brass-ink">
              Hold releases{' '}
              {new Date(bar.holdUntil).toLocaleString('en-GB', {
                day: '2-digit',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          )}
          {bar.balanceDue && <div className="font-semibold text-closed-ink">Payment pending</div>}
        </div>
      }
    >
      <button
        type="button"
        onClick={() => onSelect(bar)}
        onDoubleClick={(e) => e.stopPropagation()}
        className={cn(
          'absolute top-1 flex h-[calc(100%-8px)] items-center gap-1.5 overflow-hidden px-2',
          'text-left text-xs font-semibold shadow-sm transition hover:brightness-110',
          barTone(bar),
          bar.holdUntil && 'ring-2 ring-inset ring-brass',
          g.startsBefore ? 'rounded-l-none' : 'rounded-l',
          g.endsAfter ? 'rounded-r-none' : 'rounded-r',
        )}
        style={{ left: g.left + 2, width: g.width }}
      >
        <span className="shrink-0 rounded bg-black/25 px-1 text-[10px] uppercase leading-4">
          {SOURCE_LABEL[bar.source ?? ''] ?? bar.source}
        </span>
        <span className="truncate">{bar.guestName}</span>
        {bar.balanceDue && <span className="ml-auto shrink-0 text-[11px] opacity-90">$</span>}
      </button>
    </Tooltip>
  );
}

/** The repeating column rule, drawn as a background so there is no per-cell DOM node. */
function gridBackground(dates: string[]): React.CSSProperties {
  return {
    width: dates.length * COL_W,
    backgroundImage: `repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${COL_W}px)`,
  };
}

function RoomTypeRow({ rt, dates }: { rt: StayRoomType; dates: string[] }) {
  return (
    <div className="flex border-b border-line bg-surface-2">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface-2 px-3 py-2"
        style={{ width: LABEL_W }}
      >
        <span className="truncate text-sm font-bold text-ink">{rt.name}</span>
        <span className="rounded bg-surface px-1.5 text-[11px] font-semibold text-ink-3">
          {rt.quantity}
        </span>
      </div>
      <div className="flex shrink-0" style={{ width: dates.length * COL_W }}>
        {rt.perDate.map((d) => (
          <div
            key={d.date}
            className="flex shrink-0 flex-col items-center justify-center border-r border-line py-1"
            style={{ width: COL_W }}
          >
            <span
              className={cn(
                'text-xs font-bold tabular-nums',
                d.closed || d.available === 0 ? 'text-closed-ink' : 'text-ink-2',
              )}
            >
              {d.closed ? 'Closed' : (d.available ?? '—')}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-3">
              {d.rate ? Number(d.rate).toFixed(2) : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TapeChart({
  data,
  onSelectBar,
  onSelectEmpty,
}: {
  data: StayView;
  onSelectBar: (bar: StayBar) => void;
  onSelectEmpty?: (unitId: string, date: string) => void;
}) {
  const { dates } = data;

  return (
    <div className="overflow-x-auto">
      <div style={{ width: LABEL_W + dates.length * COL_W }}>
        {/* Date header */}
        <div className="flex border-b border-line bg-surface">
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-line bg-surface"
            style={{ width: LABEL_W }}
          />
          {dates.map((d) => {
            const day = new Date(`${d}T00:00:00Z`);
            const weekend = [0, 6].includes(day.getUTCDay());
            return (
              <div
                key={d}
                className={cn(
                  'shrink-0 border-r border-line py-1.5 text-center',
                  weekend && 'bg-surface-2',
                )}
                style={{ width: COL_W }}
              >
                <div className="text-[11px] uppercase tracking-wide text-ink-3">
                  {day.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' })}
                </div>
                <div className="text-sm font-bold text-ink">
                  {day.toLocaleDateString('en', {
                    day: '2-digit',
                    month: 'short',
                    timeZone: 'UTC',
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Room types and their rooms */}
        {data.roomTypes.map((rt) => (
          <div key={rt.roomId}>
            <RoomTypeRow rt={rt} dates={dates} />
            {rt.units.map((u) => (
              <div key={u.id} className="flex border-b border-line">
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-surface px-3"
                  style={{ width: LABEL_W, height: ROW_H }}
                >
                  <span className="font-mono text-sm font-semibold text-ink">{u.code}</span>
                  {u.floor && <span className="text-[11px] text-ink-3">fl {u.floor}</span>}
                  {u.status === 'inactive' && (
                    <Tooltip label="Out of service">
                      <Prohibit size={13} className="ml-auto text-closed-ink" />
                    </Tooltip>
                  )}
                </div>
                {/* One relatively-positioned strip per room, with the grid drawn as a background
                    and bars placed absolutely. 40 rooms x 90 days would be 3,600 cell elements
                    if each day were a node; this way it is 40. */}
                <div
                  className="relative shrink-0"
                  style={{ ...gridBackground(dates), height: ROW_H }}
                  data-unit-id={u.id}
                  data-unit-code={u.code}
                  title="Double-click an empty night to reserve this room"
                  onDoubleClick={(e) => {
                    if (!onSelectEmpty) return;
                    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
                    const idx = Math.floor(x / COL_W);
                    const date = dates[idx];
                    if (date) onSelectEmpty(u.id, date);
                  }}
                >
                  {u.bars.map((b) => (
                    <Bar key={`${b.kind}-${b.id}`} bar={b} dates={dates} onSelect={onSelectBar} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Unassigned — Yanolja's "Default Unmapped Room" row */}
        {data.unassigned.length > 0 && (
          <div className="flex border-b border-line bg-low-soft">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-low-soft px-3"
              style={{ width: LABEL_W, height: ROW_H }}
            >
              <span className="text-xs font-bold text-low-ink">
                Unassigned ({data.unassigned.length})
              </span>
            </div>
            <div className="relative shrink-0" style={{ ...gridBackground(dates), height: ROW_H }}>
              {data.unassigned.map((b) => (
                <Bar key={b.id} bar={b} dates={dates} onSelect={onSelectBar} />
              ))}
            </div>
          </div>
        )}

        {/* Tentative — inquiries hold no room; they are shown, never counted */}
        {(data.tentative?.length ?? 0) > 0 && (
          <div className="flex border-b border-line bg-info-soft">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-info-soft px-3"
              style={{ width: LABEL_W, height: ROW_H }}
            >
              <span className="text-xs font-bold text-info-ink">
                Tentative ({data.tentative!.length})
              </span>
            </div>
            <div className="relative shrink-0" style={{ ...gridBackground(dates), height: ROW_H }}>
              {data.tentative!.map((b) => (
                <Bar key={b.id} bar={b} dates={dates} onSelect={onSelectBar} />
              ))}
            </div>
          </div>
        )}

        {/* Sticky metric footer */}
        {(
          [
            ['Available inventory', (f: StayView['footer'][number]) => f.availableInventory],
            ['Occupancy', (f: StayView['footer'][number]) => `${f.occupancyPct}%`],
          ] as const
        ).map(([label, get]) => (
          <div key={label} className="flex border-b border-line bg-surface-2 last:border-b-0">
            <div
              className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink-2"
              style={{ width: LABEL_W }}
            >
              {label}
            </div>
            {data.footer.map((f) => (
              <div
                key={f.date}
                className="flex shrink-0 items-center justify-center gap-1.5 border-r border-line py-2"
                style={{ width: COL_W }}
              >
                {label === 'Occupancy' && (
                  <span
                    className="h-1.5 w-6 overflow-hidden rounded-full"
                    style={{ background: 'var(--line-strong)' }}
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${f.occupancyPct}%`,
                        background:
                          f.occupancyPct >= 90
                            ? 'var(--closed-ink)'
                            : f.occupancyPct >= 60
                              ? 'var(--low-ink)'
                              : 'var(--avail-ink)',
                      }}
                    />
                  </span>
                )}
                <span className="font-mono text-xs tabular-nums text-ink">{get(f)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
