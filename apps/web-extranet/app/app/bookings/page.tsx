'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listRooms,
  listRatePlans,
  listOccupancies,
  listBookings,
  createBooking,
  bookingTransition,
  ApiError,
  type Booking,
  type Room,
  type Occupancy,
} from '@/lib/api';
import { Button, Card, Field, Pill } from '@/components/ui';
import { money } from '@/lib/format';

const STATUSES = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled', 'NoShow'] as const;
type Filter = (typeof STATUSES)[number];

function tone(s: Booking['status']): 'avail' | 'low' | 'closed' | 'muted' {
  if (s === 'Approved') return 'avail';
  if (s === 'Pending') return 'low';
  if (s === 'Rejected' || s === 'Cancelled') return 'closed';
  return 'muted';
}

const selectClass =
  'rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm font-medium text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<Filter>('All');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState('');
  const [occs, setOccs] = useState<Occupancy[]>([]);
  const [occId, setOccId] = useState('');
  const [form, setForm] = useState({
    name: '',
    checkin: '2026-08-04',
    checkout: '2026-08-06',
    couponCode: '',
    referralCode: '',
  });

  const load = useCallback(async () => setBookings(await listBookings().catch(() => [])), []);

  useEffect(() => {
    load();
    listRooms()
      .then((rs) => {
        setRooms(rs);
        if (rs[0]) void selectRoom(rs[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function selectRoom(id: string) {
    setRoomId(id);
    setOccId('');
    const plans = await listRatePlans(id).catch(() => []);
    const all: Occupancy[] = [];
    for (const p of plans) all.push(...(await listOccupancies(p.id).catch(() => [])));
    setOccs(all);
    setOccId(all[0]?.id ?? '');
  }

  const filtered = useMemo(
    () =>
      bookings.filter(
        (b) =>
          (filter === 'All' || b.status === filter) &&
          (q === '' ||
            b.customerName.toLowerCase().includes(q.toLowerCase()) ||
            b.reference.toLowerCase().includes(q.toLowerCase())),
      ),
    [bookings, filter, q],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const b of bookings) c[b.status] = (c[b.status] ?? 0) + 1;
    return c;
  }, [bookings]);

  async function act(id: string, action: 'approve' | 'reject' | 'cancel' | 'no-show') {
    setBusy(true);
    setMsg(null);
    try {
      await bookingTransition(id, action);
      await load();
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Failed' });
    } finally {
      setBusy(false);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId || !occId || !form.name.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const b = await createBooking({
        roomId,
        occupancyId: occId,
        customerName: form.name.trim(),
        checkin: form.checkin,
        checkout: form.checkout,
        ...(form.couponCode.trim() ? { couponCode: form.couponCode.trim() } : {}),
        ...(form.referralCode.trim() ? { referralCode: form.referralCode.trim() } : {}),
      });
      setShowNew(false);
      setForm((f) => ({ ...f, name: '' }));
      await load();
      setMsg({ tone: 'avail', text: `Booked ${b.reference} — ${money(b.amount)}.` });
    } catch (err) {
      setMsg({
        tone: 'closed',
        text:
          err instanceof ApiError
            ? err.status === 409
              ? 'No availability for those dates.'
              : err.message
            : 'Something went wrong',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">Reservations</div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Bookings</h1>
        <span className="font-mono text-sm text-ink-3">{bookings.length}</span>
        <div className="flex-1" />
        <Button onClick={() => setShowNew((v) => !v)} disabled={occs.length === 0}>
          + Walk-in booking
        </Button>
      </div>

      {showNew && (
        <Card className="mt-4 p-4">
          <form onSubmit={create} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-3">Room</span>
              <select className={selectClass} value={roomId} onChange={(e) => selectRoom(e.target.value)}>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-3">
                Occupancy / rate plan
              </span>
              <select className={selectClass} value={occId} onChange={(e) => setOccId(e.target.value)}>
                {occs.length === 0 && <option>No occupancies — set up in Setup</option>}
                {occs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} (×{o.accommodates})
                  </option>
                ))}
              </select>
            </label>
            <div className="w-48">
              <Field
                label="Guest name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. A. Fernando"
              />
            </div>
            <div className="w-40">
              <Field
                label="Check-in"
                type="date"
                value={form.checkin}
                onChange={(e) => setForm((f) => ({ ...f, checkin: e.target.value }))}
              />
            </div>
            <div className="w-40">
              <Field
                label="Check-out"
                type="date"
                value={form.checkout}
                onChange={(e) => setForm((f) => ({ ...f, checkout: e.target.value }))}
              />
            </div>
            <div className="w-32">
              <Field
                label="Coupon (optional)"
                value={form.couponCode}
                onChange={(e) => setForm((f) => ({ ...f, couponCode: e.target.value.toUpperCase() }))}
                placeholder="SUMMER10"
              />
            </div>
            <div className="w-32">
              <Field
                label="Referral (optional)"
                value={form.referralCode}
                onChange={(e) => setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase() }))}
                placeholder="LANKA"
              />
            </div>
            <Button type="submit" disabled={busy || !occId}>
              {busy ? 'Booking…' : 'Create booking'}
            </Button>
          </form>
        </Card>
      )}

      {/* filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              filter === s ? 'border-brand text-brand-ink' : 'border-line-strong text-ink-2 hover:border-ink-3'
            }`}
            style={filter === s ? { background: 'var(--brand-soft)' } : undefined}
          >
            {s}
            {s !== 'All' && counts[s] ? <span className="ml-1.5 text-ink-3">{counts[s]}</span> : null}
          </button>
        ))}
        <div className="flex-1" />
        <input
          className={`${selectClass} w-56`}
          placeholder="Search guest or reference…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {msg && (
        <div
          className="mt-4 rounded-lg px-3 py-2 text-sm font-medium"
          style={{
            color: msg.tone === 'avail' ? 'var(--avail-ink)' : 'var(--closed-ink)',
            background: msg.tone === 'avail' ? 'var(--avail-soft)' : 'var(--closed-soft)',
          }}
        >
          {msg.text}
        </div>
      )}

      <Card className="mt-4 overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-ink-3">No bookings match.</p>
        ) : (
          <table className="w-full text-sm" style={{ minWidth: 720 }}>
            <thead>
              <tr className="border-b border-line text-left font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">
                <th className="px-4 py-2 font-medium">Ref</th>
                <th className="px-4 py-2 font-medium">Guest</th>
                <th className="px-4 py-2 font-medium">Stay</th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-mono font-semibold text-brand-ink">{b.reference}</td>
                  <td className="px-4 py-2">{b.customerName}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">
                    {b.checkin} → {b.checkout} · {b.nights}n
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-3">{b.source}</td>
                  <td className="px-4 py-2">
                    <Pill tone={tone(b.status)}>{b.status}</Pill>
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{money(b.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === 'Pending' && (
                        <>
                          <Button className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => act(b.id, 'approve')}>
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs"
                            disabled={busy}
                            onClick={() => act(b.id, 'reject')}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {b.status === 'Approved' && (
                        <>
                          <Button
                            variant="secondary"
                            className="!px-2 !py-1 text-xs"
                            disabled={busy}
                            onClick={() => act(b.id, 'no-show')}
                          >
                            No-show
                          </Button>
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs"
                            disabled={busy}
                            onClick={() => act(b.id, 'cancel')}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
