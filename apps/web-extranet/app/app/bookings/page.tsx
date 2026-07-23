'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listRooms,
  listRatePlans,
  listOccupancies,
  listBookings,
  createBooking,
  bookingTransition,
  amendBooking,
  ApiError,
  type Booking,
  type Room,
  type Occupancy,
} from '@/lib/api';
import { Button, Card, Field, Modal, Pill } from '@/components/ui';
import { money, todayISO, addDays } from '@/lib/format';

/** Whole nights between two YYYY-MM-DD dates (0 if invalid or not positive). */
function nightsBetween(checkin: string, checkout: string): number {
  const n = Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const STATUSES = [
  'All',
  'Pending',
  'Approved',
  'CheckedIn',
  'CheckedOut',
  'Rejected',
  'Cancelled',
  'NoShow',
] as const;
type Filter = (typeof STATUSES)[number];

function tone(s: Booking['status']): 'avail' | 'low' | 'closed' | 'muted' {
  if (s === 'Approved' || s === 'CheckedIn') return 'avail';
  if (s === 'Pending') return 'low';
  if (s === 'Rejected' || s === 'Cancelled') return 'closed';
  return 'muted';
}

/** Stay (dates/rooms) can move while Pending/Approved; guest details also after check-in. */
function canEditStay(s: Booking['status']) {
  return s === 'Pending' || s === 'Approved';
}
function canEdit(s: Booking['status']) {
  return canEditStay(s) || s === 'CheckedIn' || s === 'CheckedOut';
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
    email: '',
    phone: '',
    checkin: todayISO(),
    checkout: addDays(todayISO(), 2),
    rooms: 1,
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

  async function act(
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'no-show' | 'check-in' | 'check-out',
  ) {
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

  const [edit, setEdit] = useState<{
    id: string;
    reference: string;
    stayEditable: boolean;
    name: string;
    email: string;
    phone: string;
    checkin: string;
    checkout: string;
    rooms: number;
  } | null>(null);

  function startEdit(b: Booking) {
    setMsg(null);
    setEdit({
      id: b.id,
      reference: b.reference,
      stayEditable: canEditStay(b.status),
      name: b.customerName,
      email: b.customerEmail ?? '',
      phone: b.customerPhone ?? '',
      checkin: b.checkin,
      checkout: b.checkout,
      rooms: b.rooms,
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setMsg(null);
    try {
      const b = await amendBooking(edit.id, {
        customerName: edit.name.trim() || undefined,
        customerEmail: edit.email.trim(),
        customerPhone: edit.phone.trim(),
        ...(edit.stayEditable
          ? { checkin: edit.checkin, checkout: edit.checkout, rooms: edit.rooms }
          : {}),
      });
      setEdit(null);
      await load();
      setMsg({ tone: 'avail', text: `Updated ${edit.reference} — new total ${money(b.amount)}.` });
    } catch (err) {
      setMsg({
        tone: 'closed',
        text:
          err instanceof ApiError
            ? err.status === 409
              ? 'No availability for the new dates.'
              : err.message
            : 'Something went wrong',
      });
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
        ...(form.email.trim() ? { customerEmail: form.email.trim() } : {}),
        ...(form.phone.trim() ? { customerPhone: form.phone.trim() } : {}),
        checkin: form.checkin,
        checkout: form.checkout,
        rooms: form.rooms,
        ...(form.couponCode.trim() ? { couponCode: form.couponCode.trim() } : {}),
        ...(form.referralCode.trim() ? { referralCode: form.referralCode.trim() } : {}),
      });
      setShowNew(false);
      setForm((f) => ({ ...f, name: '', email: '', phone: '', rooms: 1 }));
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
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
        Reservations
      </div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Bookings</h1>
        <span className="font-mono text-sm text-ink-3">{bookings.length}</span>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setMsg(null);
            setShowNew((v) => !v);
          }}
          disabled={occs.length === 0}
        >
          + Walk-in booking
        </Button>
      </div>

      {showNew && (
        <Modal
          title="New walk-in booking"
          subtitle="The stay is priced from the rate calendar; availability is reserved atomically."
          onClose={() => setShowNew(false)}
        >
          <form onSubmit={create} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Room</span>
              <select
                className={`${selectClass} w-full`}
                value={roomId}
                onChange={(e) => selectRoom(e.target.value)}
              >
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Occupancy / rate plan</span>
              <select
                className={`${selectClass} w-full`}
                value={occId}
                onChange={(e) => setOccId(e.target.value)}
              >
                {occs.length === 0 && <option>No occupancies — set up in Setup</option>}
                {occs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label} (×{o.accommodates})
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Guest name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. A. Fernando"
              required
            />
            <Field
              label="Rooms"
              type="number"
              min={1}
              value={String(form.rooms)}
              onChange={(e) => setForm((f) => ({ ...f, rooms: Number(e.target.value) || 1 }))}
            />
            <Field
              label="Email (optional)"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="guest@example.com"
            />
            <Field
              label="Phone (optional)"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+94 …"
            />
            <Field
              label="Check-in"
              type="date"
              value={form.checkin}
              onChange={(e) => setForm((f) => ({ ...f, checkin: e.target.value }))}
            />
            <Field
              label="Check-out"
              type="date"
              min={form.checkin}
              value={form.checkout}
              onChange={(e) => setForm((f) => ({ ...f, checkout: e.target.value }))}
            />
            <Field
              label="Coupon (optional)"
              value={form.couponCode}
              onChange={(e) => setForm((f) => ({ ...f, couponCode: e.target.value.toUpperCase() }))}
              placeholder="SUMMER10"
            />
            <Field
              label="Referral (optional)"
              value={form.referralCode}
              onChange={(e) =>
                setForm((f) => ({ ...f, referralCode: e.target.value.toUpperCase() }))
              }
              placeholder="LANKA"
            />
            {msg?.tone === 'closed' && (
              <div
                className="rounded-lg px-3 py-2 text-sm font-medium sm:col-span-2"
                style={{ color: 'var(--closed-ink)', background: 'var(--closed-soft)' }}
              >
                {msg.text}
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 border-t border-line pt-4 sm:col-span-2">
              <span className="text-sm text-ink-3">
                {nightsBetween(form.checkin, form.checkout) > 0
                  ? `${nightsBetween(form.checkin, form.checkout)} night${
                      nightsBetween(form.checkin, form.checkout) === 1 ? '' : 's'
                    } · ${form.rooms} room${form.rooms === 1 ? '' : 's'}`
                  : 'Check-out must be after check-in'}
              </span>
              <div className="flex-1" />
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !occId || nightsBetween(form.checkin, form.checkout) === 0}
              >
                {busy ? 'Booking…' : 'Create booking'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {edit && (
        <Modal
          title={`Edit booking ${edit.reference}`}
          subtitle={
            edit.stayEditable
              ? 'Changing dates or rooms re-prices the stay from the rate calendar and swaps inventory atomically; any coupon discount is kept as granted.'
              : 'Guest details only — this booking has already checked in.'
          }
          onClose={() => setEdit(null)}
        >
          <form onSubmit={saveEdit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field
                label="Guest name"
                value={edit.name}
                onChange={(e) => setEdit((v) => v && { ...v, name: e.target.value })}
              />
            </div>
            <Field
              label="Email"
              type="email"
              value={edit.email}
              onChange={(e) => setEdit((v) => v && { ...v, email: e.target.value })}
              placeholder="guest@example.com"
            />
            <Field
              label="Phone"
              value={edit.phone}
              onChange={(e) => setEdit((v) => v && { ...v, phone: e.target.value })}
              placeholder="+94 …"
            />
            {edit.stayEditable && (
              <>
                <Field
                  label="Check-in"
                  type="date"
                  value={edit.checkin}
                  onChange={(e) => setEdit((v) => v && { ...v, checkin: e.target.value })}
                />
                <Field
                  label="Check-out"
                  type="date"
                  min={edit.checkin}
                  value={edit.checkout}
                  onChange={(e) => setEdit((v) => v && { ...v, checkout: e.target.value })}
                />
                <Field
                  label="Rooms"
                  type="number"
                  min={1}
                  value={String(edit.rooms)}
                  onChange={(e) =>
                    setEdit((v) => v && { ...v, rooms: Number(e.target.value) || 1 })
                  }
                />
              </>
            )}
            {msg?.tone === 'closed' && (
              <div
                className="rounded-lg px-3 py-2 text-sm font-medium sm:col-span-2"
                style={{ color: 'var(--closed-ink)', background: 'var(--closed-soft)' }}
              >
                {msg.text}
              </div>
            )}
            <div className="mt-2 flex items-center gap-3 border-t border-line pt-4 sm:col-span-2">
              {edit.stayEditable && (
                <span className="text-sm text-ink-3">
                  {nightsBetween(edit.checkin, edit.checkout) > 0
                    ? `${nightsBetween(edit.checkin, edit.checkout)} night${
                        nightsBetween(edit.checkin, edit.checkout) === 1 ? '' : 's'
                      } · ${edit.rooms} room${edit.rooms === 1 ? '' : 's'}`
                    : 'Check-out must be after check-in'}
                </span>
              )}
              <div className="flex-1" />
              <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy || (edit.stayEditable && nightsBetween(edit.checkin, edit.checkout) === 0)
                }
              >
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              filter === s
                ? 'border-brand text-brand-ink'
                : 'border-line-strong text-ink-2 hover:border-ink-3'
            }`}
            style={filter === s ? { background: 'var(--brand-soft)' } : undefined}
          >
            {s}
            {s !== 'All' && counts[s] ? (
              <span className="ml-1.5 text-ink-3">{counts[s]}</span>
            ) : null}
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

      {msg && !showNew && !edit && (
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
                  <td className="px-4 py-2 font-mono font-semibold text-brand-ink">
                    {b.reference}
                  </td>
                  <td className="px-4 py-2">{b.customerName}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">
                    {b.checkin} → {b.checkout} · {b.nights}n
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-3">{b.source}</td>
                  <td className="px-4 py-2">
                    <Pill tone={tone(b.status)}>{b.status}</Pill>
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">
                    {money(b.amount)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === 'Pending' && (
                        <>
                          <Button
                            className="!px-2 !py-1 text-xs"
                            disabled={busy}
                            onClick={() => act(b.id, 'approve')}
                          >
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
                            className="!px-2 !py-1 text-xs"
                            disabled={busy}
                            onClick={() => act(b.id, 'check-in')}
                          >
                            Check in
                          </Button>
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
                      {b.status === 'CheckedIn' && (
                        <Button
                          className="!px-2 !py-1 text-xs"
                          disabled={busy}
                          onClick={() => act(b.id, 'check-out')}
                        >
                          Check out
                        </Button>
                      )}
                      {canEdit(b.status) && (
                        <Button
                          variant="ghost"
                          className="!px-2 !py-1 text-xs"
                          disabled={busy}
                          onClick={() => startEdit(b)}
                        >
                          Edit
                        </Button>
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
