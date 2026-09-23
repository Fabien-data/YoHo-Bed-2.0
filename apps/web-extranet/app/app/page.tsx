'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bed, Clock, Gauge, SignIn, SignOut, Wallet, Warning } from '@phosphor-icons/react';
import {
  getDashboard,
  listProperties,
  describeError,
  type DashboardOverview,
  type DashboardBooking,
  type Property,
} from '@/lib/api';
import { useDesk } from '@/components/booking/desk-dialogs';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatCard,
} from '@yohobed/ui';
import { useMoney } from '@/components/currency';

const TH = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2';

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
        <EmptyState title={emptyText} className="py-8" />
      ) : (
        <ul>
          {items.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{b.customerName}</div>
                <div className="truncate font-mono text-xs text-ink-3">
                  {b.reference} · {b.roomName} · {b.nights}n ×{b.rooms}
                </div>
              </div>
              <Badge tone={b.status === 'Approved' ? 'low' : 'avail'}>
                {b.status === 'Approved' ? 'Due' : b.status === 'CheckedIn' ? 'In-house' : 'Done'}
              </Badge>
              {actionFor(b) && (
                <Button size="sm" disabled={busy} onClick={() => onAction(b)}>
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
  // Empty until someone picks a day: the API then answers for the hotel's own today, which the
  // browser's clock gets wrong whenever it sits in another timezone.
  const [date, setDate] = useState('');
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState('');
  const { money } = useMoney();
  const desk = useDesk();

  // A query, so a check-in or check-out made in the shared dialogs refreshes this screen too.
  const dashboard = useQuery({
    queryKey: ['dashboard', date, propertyId],
    queryFn: () => getDashboard(date, propertyId || undefined),
  });
  const data: DashboardOverview | undefined = dashboard.data;
  const err = dashboard.isError ? describeError(dashboard.error, 'Failed to load dashboard') : null;

  useEffect(() => {
    listProperties()
      .then(setProperties)
      .catch(() => {});
  }, []);

  // The same guided dialogs as everywhere else (UX-1b): checks first, then one press.
  function act(b: DashboardBooking, action: 'check-in' | 'check-out') {
    desk(action, {
      id: b.id,
      reference: b.reference,
      guestName: b.customerName,
      checkin: b.checkin,
      checkout: b.checkout,
    });
  }
  const busy = false;

  const monthLabel = data
    ? new Date(`${data.month.from}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';

  return (
    <div>
      <PageHeader
        eyebrow="Front desk"
        title="Dashboard"
        actions={
          <>
            <Select
              value={propertyId || 'all'}
              onValueChange={(v) => setPropertyId(v === 'all' ? '' : v)}
            >
              <SelectTrigger className="w-44" aria-label="Property">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={date || data?.date || ''}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              aria-label="Dashboard date"
            />
          </>
        }
      />

      {err && (
        <div className="mt-4 rounded-lg bg-closed-soft px-3 py-2 text-sm font-medium text-closed-ink">
          {err}
        </div>
      )}

      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard
              label="Arrivals"
              value={String(data.arrivals.length)}
              hint={`${data.arrivals.filter((a) => a.status === 'Approved').length} still due`}
              icon={<SignIn size={18} />}
            />
            <StatCard
              label="Departures"
              value={String(data.departures.length)}
              hint={`${data.departures.filter((d) => d.status === 'CheckedIn').length} still in-house`}
              icon={<SignOut size={18} />}
            />
            <StatCard
              label="In-house"
              value={String(data.inHouse)}
              hint="guests checked in"
              icon={<Bed size={18} />}
            />
            <StatCard
              label="Pending"
              value={String(data.pendingApprovals)}
              hint="awaiting approval"
              tone={data.pendingApprovals > 0 ? 'low' : 'brand'}
              icon={data.pendingApprovals > 0 ? <Warning size={18} /> : <Clock size={18} />}
            />
            <StatCard
              label="Occupancy"
              value={`${data.occupancy.pct}%`}
              hint={`${data.occupancy.occupied} of ${data.occupancy.totalRooms} rooms tonight`}
              icon={<Gauge size={18} />}
            />
            <StatCard
              label={monthLabel || 'This month'}
              value={money(String(data.month.gross), data.month.currency, data.month.approximate)}
              hint={
                data.month.approximate
                  ? `${data.month.nightsSold} room-nights · consolidated to ${data.month.currency}`
                  : `${data.month.nightsSold} room-nights confirmed`
              }
              tone="brass"
              icon={<Wallet size={18} />}
            />
          </div>

          {data.pendingApprovals > 0 && (
            <Link
              href="/app/bookings"
              className="mt-4 block rounded-lg bg-low-soft px-3 py-2 text-sm font-semibold text-low-ink"
            >
              {data.pendingApprovals} booking{data.pendingApprovals === 1 ? '' : 's'} waiting for
              approval →
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
              <EmptyState title="No bookings yet." className="py-8" />
            ) : (
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    <th className={TH}>Reference</th>
                    <th className={TH}>Guest</th>
                    <th className={TH}>Dates</th>
                    <th className={TH}>Room</th>
                    <th className={TH}>Status</th>
                    <th className={`${TH} text-right`}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((b) => (
                    <tr key={b.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-mono font-semibold text-brand-ink">
                        {b.reference}
                      </td>
                      <td className="px-4 py-2">{b.customerName}</td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-2">
                        {b.checkin} → {b.checkout}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-3">{b.roomName}</td>
                      <td className="px-4 py-2">
                        <Badge
                          tone={
                            b.status === 'Approved' ||
                            b.status === 'CheckedIn' ||
                            b.status === 'CheckedOut'
                              ? 'avail'
                              : b.status === 'Pending'
                                ? 'low'
                                : b.status === 'NoShow'
                                  ? 'muted'
                                  : 'closed'
                          }
                        >
                          {b.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                        {money(b.amount, b.currency)}
                      </td>
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
