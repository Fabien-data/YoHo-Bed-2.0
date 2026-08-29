'use client';

import { Fragment, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Sheet,
  SheetContent,
  type Tone,
} from '@yohobed/ui';
import { listCustomers, getCustomer, type CustomerRow, type Booking } from '@/lib/api';
import { longDate } from '@/lib/format';
import { useMoney } from '@/components/currency';
import { GuestProfileForm } from '@/components/reservations/guest-profile';

const STATUS_TONE: Record<string, Tone> = {
  Approved: 'avail',
  CheckedIn: 'brand',
  CheckedOut: 'muted',
  Pending: 'low',
  Rejected: 'closed',
  Cancelled: 'closed',
  NoShow: 'closed',
};

export default function CustomersPage() {
  const { money } = useMoney();
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, Booking[]>>({});
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  function reload() {
    listCustomers()
      .then(setCustomers)
      .catch(() => {});
  }

  useEffect(() => {
    listCustomers()
      .then(setCustomers)
      .catch(() => {});
  }, []);

  async function toggle(id: string) {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next && !history[next]) {
      const detail = await getCustomer(next).catch(() => null);
      if (detail) setHistory((h) => ({ ...h, [next]: detail.history }));
    }
  }

  const totalGuests = customers.length;
  const repeatGuests = customers.filter((c) => c.bookings > 1).length;

  return (
    <div>
      <PageHeader
        eyebrow="Guest"
        title="Customers"
        description="Every guest you have hosted, with their booking history and value. Click a guest to see their stays."
        actions={
          <>
            <Badge tone="muted">{totalGuests} guests</Badge>
            <Badge tone="brand">{repeatGuests} repeat</Badge>
          </>
        }
      />

      <Card className="mt-6 overflow-hidden">
        {customers.length === 0 ? (
          <EmptyState title="No guests yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Guest
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Contact
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Nationality
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Bookings
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Nights
                  </th>
                  <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Total value
                  </th>
                  <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    Last check-in
                  </th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <Fragment key={c.id}>
                    <tr
                      onClick={() => void toggle(c.id)}
                      className={`cursor-pointer border-b border-line transition last:border-0 ${
                        openId === c.id ? 'bg-brand-soft' : 'hover:bg-surface-2'
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold text-ink">
                        {c.name}
                        {c.vip && (
                          <span className="ml-2 align-middle">
                            <Badge tone="low">VIP</Badge>
                          </span>
                        )}
                        {c.bookings > 1 && (
                          <span className="ml-2 align-middle">
                            <Badge tone="brand">repeat</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-2">
                        {c.email ?? '—'}
                        {c.phone ? ` · ${c.phone}` : ''}
                      </td>
                      <td className="px-4 py-3 text-ink-2">{c.nationality ?? c.country ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                        {c.bookings}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-2">
                        {c.nights}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-ink">
                        {money(c.totalSpend, c.currency, c.approximate)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-2">
                        {c.lastCheckin ? longDate(c.lastCheckin) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(c);
                          }}
                        >
                          Edit profile
                        </Button>
                      </td>
                    </tr>
                    {openId === c.id && (
                      <tr className="border-b border-line last:border-0">
                        <td colSpan={8} className="bg-surface-2 px-6 py-4">
                          {!history[c.id] ? (
                            <p className="text-sm text-ink-3">Loading stays…</p>
                          ) : history[c.id]!.length === 0 ? (
                            <p className="text-sm text-ink-3">No stays recorded.</p>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {history[c.id]!.map((b) => (
                                <div
                                  key={b.id}
                                  className="flex flex-wrap items-center gap-3 text-sm"
                                >
                                  <span className="font-mono text-xs text-ink-3">
                                    {b.reference}
                                  </span>
                                  <Badge tone={STATUS_TONE[b.status] ?? 'muted'}>{b.status}</Badge>
                                  <span className="text-ink-2">
                                    {longDate(b.checkin)} → {longDate(b.checkout)} · {b.nights}n
                                    {b.rooms > 1 ? ` · ${b.rooms} rooms` : ''}
                                  </span>
                                  <span className="ml-auto font-mono font-semibold tabular-nums text-ink">
                                    {money(b.amount, b.currency)}
                                  </span>
                                  <span className="font-mono text-[0.65rem] uppercase text-ink-3">
                                    {b.source}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent
          title={editing ? editing.name : 'Guest'}
          description="Details for the registration card and reporting"
        >
          {editing && (
            <GuestProfileForm
              key={editing.id}
              guest={{
                id: editing.id,
                name: editing.name,
                nationality: editing.nationality,
                country: editing.country,
                vip: editing.vip,
              }}
              onSaved={() => {
                reload();
                setEditing(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
