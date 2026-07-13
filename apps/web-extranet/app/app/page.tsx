'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getDashboard,
  listProperties,
  bookingTransition,
  ApiError,
  type DashboardOverview,
  type DashboardBooking,
  type Property,
} from '@/lib/api';
import { Button, Card, Pill } from '@/components/ui';
import { money } from '@/lib/format';

const selectClass =
  'rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

function today() {
  return new Date().toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex-1 p-4">
      <div className="font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-ink" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-3">{hint}</div>}
    </Card>
  );
}

function MovementList({
  title,
  emptyText,
  items,
  actionLabel,
  actionFor,
  onAction,
  busy,
}: {
  title: string;
  emptyText: string;
  items: DashboardBooking[];
  actionLabel: string;
  actionFor: (b: DashboardBooking) => boolean;
  onAction: (b: DashboardBooking) => void;
  busy: boolean;
}) {
  return (
    <Card className="flex-1 p-0">
      <div className="border-b border-line px-4 py-3 font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">
        {title} <span className="ml-1 text-ink-2">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-ink-3">{emptyText}</p>
      ) : (
        <ul>
          {items.map((b) => (
            <li key={b.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{b.customerName}</div>
                <div className="truncate font-mono text-xs text-ink-3">
                  {b.reference} · {b.roomName} · {b.nights}n ×{b.rooms}
                </div>
              </div>
              <Pill tone={b.status === 'Approved' ? 'low' : 'avail'}>
                {b.status === 'Approved' ? 'Due' : b.status === 'CheckedIn' ? 'In-house' : 'Done'}
              </Pill>
              {actionFor(b) && (
                <Button className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => onAction(b)}>
                  {actionLabel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const [date, setDate] = useState(today());
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getDashboard(date, propertyId || undefined));
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Failed to load dashboard');
    }
  }, [date, propertyId]);

  useEffect(() => {
    listProperties()
      .then(setProperties)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function act(b: DashboardBooking, action: 'check-in' | 'check-out') {
    setBusy(true);
    try {
      await bookingTransition(b.id, action);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  const monthLabel = data
    ? new Date(`${data.month.from}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';

  return (
    <div>
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">Front desk</div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Dashboard</h1>
        <div className="flex-1" />
        <select className={selectClass} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input className={selectClass} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {err && (
        <div
          className="mt-4 rounded-lg px-3 py-2 text-sm font-medium"
          style={{ color: 'var(--closed-ink)', background: 'var(--closed-soft)' }}
        >
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <Stat
              label="Arrivals"
              value={String(data.arrivals.length)}
              hint={`${data.arrivals.filter((a) => a.status === 'Approved').length} still due`}
            />
            <Stat
              label="Departures"
              value={String(data.departures.length)}
              hint={`${data.departures.filter((d) => d.status === 'CheckedIn').length} still in-house`}
            />
            <Stat label="In-house" value={String(data.inHouse)} hint="guests checked in" />
            <Stat label="Pending" value={String(data.pendingApprovals)} hint="awaiting approval" />
            <Stat
              label="Occupancy"
              value={`${data.occupancy.pct}%`}
              hint={`${data.occupancy.occupied} of ${data.occupancy.totalRooms} rooms tonight`}
            />
            <Stat
              label={monthLabel || 'This month'}
              value={money(String(data.month.gross))}
              hint={`${data.month.nightsSold} room-nights confirmed`}
            />
          </div>

          {data.pendingApprovals > 0 && (
            <Link
              href="/app/bookings"
              className="mt-4 block rounded-lg px-3 py-2 text-sm font-semibold"
              style={{ color: 'var(--low-ink)', background: 'var(--low-soft)' }}
            >
              {data.pendingApprovals} booking{data.pendingApprovals === 1 ? '' : 's'} waiting for approval →
            </Link>
          )}

          <div className="mt-5 flex flex-col gap-4 lg:flex-row">
            <MovementList
              title={`Arrivals · ${data.date}`}
              emptyText="No arrivals today."
              items={data.arrivals}
              actionLabel="Check in"
              actionFor={(b) => b.status === 'Approved'}
              onAction={(b) => act(b, 'check-in')}
              busy={busy}
            />
            <MovementList
              title={`Departures · ${data.date}`}
              emptyText="No departures today."
              items={data.departures}
              actionLabel="Check out"
              actionFor={(b) => b.status === 'CheckedIn'}
              onAction={(b) => act(b, 'check-out')}
              busy={busy}
            />
          </div>

          <Card className="mt-5 overflow-x-auto p-0">
            <div className="border-b border-line px-4 py-3 font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">
              Recent bookings
            </div>
            {data.recent.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-3">No bookings yet.</p>
            ) : (
              <table className="w-full text-sm" style={{ minWidth: 640 }}>
                <tbody>
                  {data.recent.map((b) => (
                    <tr key={b.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-mono font-semibold text-brand-ink">{b.reference}</td>
                      <td className="px-4 py-2">{b.customerName}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-2">
                        {b.checkin} → {b.checkout}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-3">{b.roomName}</td>
                      <td className="px-4 py-2">
                        <Pill
                          tone={
                            b.status === 'Approved' || b.status === 'CheckedIn' || b.status === 'CheckedOut'
                              ? 'avail'
                              : b.status === 'Pending'
                                ? 'low'
                                : b.status === 'NoShow'
                                  ? 'muted'
                                  : 'closed'
                          }
                        >
                          {b.status}
                        </Pill>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">{money(b.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
