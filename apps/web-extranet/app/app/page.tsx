'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  clearSession,
  getToken,
  getUser,
  listProperties,
  createProperty,
  listRooms,
  createRoom,
  getAvailability,
  openAvailability,
  getRoomRates,
  setPrice,
  reserve,
  release,
  listBookings,
  createBooking,
  bookingTransition,
  getPayoutStatement,
  getRevenue,
  ApiError,
  type AvailabilityDay,
  type Booking,
  type PayoutStatement,
  type Revenue,
  type Property,
  type Room,
  type SessionUser,
} from '@/lib/api';
import { Button, Card, Field, Logo, Pill } from '@/components/ui';

const FROM = '2026-08-01';
const TO = '2026-08-14';
const FIN_FROM = '2026-08-01';
const FIN_TO = '2026-08-31';

function dow(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}
function dom(d: string) {
  return new Date(`${d}T00:00:00Z`).getUTCDate();
}
function nextDay(d: string) {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
function money(v?: string) {
  return v ? `$${Number(v).toFixed(2)}` : '—';
}
function statusOf(day: AvailabilityDay): { tone: 'avail' | 'low' | 'closed'; label: string } {
  if (day.status === 'Close') return { tone: 'closed', label: 'Closed' };
  if (day.roomsToSell === 0) return { tone: 'closed', label: 'Sold out' };
  if (day.roomsToSell <= 2) return { tone: 'low', label: 'Low' };
  return { tone: 'avail', label: 'Open' };
}

function bookingTone(status: Booking['status']): 'avail' | 'low' | 'closed' | 'muted' {
  if (status === 'Approved') return 'avail';
  if (status === 'Pending') return 'low';
  if (status === 'Rejected' || status === 'Cancelled') return 'closed';
  return 'muted';
}

export default function AppPage() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [occupancyId, setOccupancyId] = useState<string | null>(null);
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [propForm, setPropForm] = useState('');
  const [roomForm, setRoomForm] = useState({ name: '', quantity: 5 });
  const [baseForm, setBaseForm] = useState(120);
  const [bookForm, setBookForm] = useState({ name: '', checkin: '2026-08-04', checkout: '2026-08-06' });
  const [showPropForm, setShowPropForm] = useState(false);
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showBookForm, setShowBookForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [payout, setPayout] = useState<PayoutStatement | null>(null);
  const [revenue, setRevenue] = useState<Revenue | null>(null);

  const loadBookings = useCallback(async () => {
    setBookings(await listBookings().catch(() => []));
  }, []);

  const loadFinance = useCallback(async (pid: string | null) => {
    const [rev, pay] = await Promise.all([
      getRevenue(FIN_FROM, FIN_TO).catch(() => null),
      pid ? getPayoutStatement(pid, FIN_FROM, FIN_TO).catch(() => null) : Promise.resolve(null),
    ]);
    setRevenue(rev);
    setPayout(pay);
  }, []);

  const propertyRooms = useMemo(
    () => rooms.filter((r) => r.propertyId === propertyId),
    [rooms, propertyId],
  );
  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);

  const loadRoomData = useCallback(async (id: string) => {
    const [avail, rates] = await Promise.all([
      getAvailability(id, FROM, TO),
      getRoomRates(id, FROM, TO).catch(() => []),
    ]);
    setDays(avail);
    setPrices(Object.fromEntries(rates.map((r) => [r.date, r.sellingPrice])));
    setOccupancyId(rates[0]?.occupancyId ?? null);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    setUser(getUser());
    (async () => {
      try {
        const [props, allRooms] = await Promise.all([listProperties(), listRooms()]);
        setProperties(props);
        setRooms(allRooms);
        const pid = props[0]?.id ?? null;
        setPropertyId(pid);
        const firstRoom = allRooms.find((r) => r.propertyId === pid) ?? null;
        setRoomId(firstRoom?.id ?? null);
        if (firstRoom) await loadRoomData(firstRoom.id);
        await loadBookings();
        await loadFinance(pid);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          clearSession();
          router.replace('/');
        }
      }
    })();
  }, [router, loadRoomData, loadBookings, loadFinance]);

  async function selectProperty(pid: string) {
    setPropertyId(pid);
    setMsg(null);
    setShowRoomForm(false);
    const forProp = rooms.filter((r) => r.propertyId === pid);
    const next = forProp[0]?.id ?? null;
    setRoomId(next);
    if (next) await loadRoomData(next);
    else {
      setDays([]);
      setPrices({});
      setOccupancyId(null);
    }
    await loadFinance(pid);
  }

  async function selectRoom(id: string) {
    setRoomId(id);
    setMsg(null);
    await loadRoomData(id);
  }

  async function refreshRoomsAndSelect(pid: string, selectId: string) {
    const all = await listRooms();
    setRooms(all);
    setRoomId(selectId);
    await loadRoomData(selectId);
  }

  async function act(kind: 'reserve' | 'release', date: string) {
    if (!roomId) return;
    setBusyDate(date);
    setMsg(null);
    try {
      if (kind === 'reserve') await reserve(roomId, date, nextDay(date));
      else await release(roomId, date, nextDay(date));
      await loadRoomData(roomId);
    } catch (e) {
      setMsg({
        tone: 'closed',
        text:
          e instanceof ApiError && e.status === 409
            ? `Sold out on ${date} — no rooms left.`
            : e instanceof ApiError
              ? e.message
              : 'Something went wrong',
      });
    } finally {
      setBusyDate(null);
    }
  }

  async function submitProperty(e: React.FormEvent) {
    e.preventDefault();
    if (!propForm.trim()) return;
    setSaving(true);
    try {
      const p = await createProperty(propForm.trim());
      setProperties((prev) => [...prev, p]);
      setPropForm('');
      setShowPropForm(false);
      await selectProperty(p.id);
      setMsg({ tone: 'avail', text: `Created property “${p.name}”.` });
    } finally {
      setSaving(false);
    }
  }

  async function submitRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!propertyId || !roomForm.name.trim()) return;
    setSaving(true);
    try {
      const r = await createRoom(propertyId, roomForm.name.trim(), roomForm.quantity);
      setRoomForm({ name: '', quantity: 5 });
      setShowRoomForm(false);
      await refreshRoomsAndSelect(propertyId, r.id);
      setMsg({ tone: 'avail', text: `Added “${r.name}”. Open its dates to start selling.` });
    } finally {
      setSaving(false);
    }
  }

  async function openDates() {
    if (!selectedRoom) return;
    setSaving(true);
    try {
      await openAvailability(selectedRoom.id, FROM, TO, selectedRoom.quantity);
      await loadRoomData(selectedRoom.id);
      setMsg({ tone: 'avail', text: `Opened ${FROM} – ${TO}.` });
    } finally {
      setSaving(false);
    }
  }

  async function applyPrice() {
    if (!occupancyId) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await setPrice(occupancyId, FROM, TO, baseForm);
      if (roomId) await loadRoomData(roomId);
      setMsg({
        tone: 'avail',
        text: `Base $${baseForm.toFixed(2)} → selling $${res.selling.toFixed(2)} (commission $${res.commission.toFixed(2)}) across 14 days.`,
      });
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  async function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId || !occupancyId || !bookForm.name.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const b = await createBooking({
        roomId,
        occupancyId,
        customerName: bookForm.name.trim(),
        checkin: bookForm.checkin,
        checkout: bookForm.checkout,
      });
      setShowBookForm(false);
      setBookForm((f) => ({ ...f, name: '' }));
      await Promise.all([loadBookings(), loadRoomData(roomId)]);
      setMsg({ tone: 'avail', text: `Booked ${b.reference} — $${Number(b.amount).toFixed(2)}.` });
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
      setSaving(false);
    }
  }

  async function doBookingAction(id: string, action: 'approve' | 'cancel') {
    setSaving(true);
    setMsg(null);
    try {
      await bookingTransition(id, action);
      await Promise.all([
        loadBookings(),
        loadFinance(propertyId),
        roomId ? loadRoomData(roomId) : Promise.resolve(),
      ]);
    } catch (err) {
      setMsg({ tone: 'closed', text: err instanceof ApiError ? err.message : 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    clearSession();
    router.replace('/');
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-line bg-surface/90 px-6 py-3 backdrop-blur">
        <Logo />
        <div className="flex-1" />
        {user && <span className="hidden text-sm text-ink-2 sm:inline">{user.email}</span>}
        <Button variant="secondary" onClick={logout}>
          Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
          Rates &amp; Availability
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Rate calendar</h1>
        <p className="mt-1 text-sm text-ink-2">
          Set a base price and the engine derives the selling price (commission + OTA); reserve or
          release inventory per night, atomically.
        </p>

        {/* Properties */}
        <div className="mt-6">
          <div className="mb-2 font-mono text-[0.65rem] uppercase tracking-widest text-ink-3">
            Property
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProperty(p.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  propertyId === p.id
                    ? 'border-brand text-brand-ink'
                    : 'border-line-strong text-ink-2 hover:border-ink-3'
                }`}
                style={propertyId === p.id ? { background: 'var(--brand-soft)' } : undefined}
              >
                {p.name}
              </button>
            ))}
            <Button variant="ghost" onClick={() => setShowPropForm((v) => !v)}>
              + New property
            </Button>
          </div>
          {showPropForm && (
            <form onSubmit={submitProperty} className="mt-3 flex items-end gap-2">
              <div className="w-64">
                <Field
                  label="Property name"
                  value={propForm}
                  onChange={(e) => setPropForm(e.target.value)}
                  placeholder="e.g. Cinnamon Grand"
                  autoFocus
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Create'}
              </Button>
            </form>
          )}
        </div>

        {/* Rooms */}
        <div className="mt-5">
          <div className="mb-2 font-mono text-[0.65rem] uppercase tracking-widest text-ink-3">
            Room
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {propertyRooms.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRoom(r.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
                  roomId === r.id
                    ? 'border-brand text-brand-ink'
                    : 'border-line-strong text-ink-2 hover:border-ink-3'
                }`}
                style={roomId === r.id ? { background: 'var(--brand-soft)' } : undefined}
              >
                {r.name}
                <span className="ml-2 font-mono text-xs text-ink-3">×{r.quantity}</span>
              </button>
            ))}
            {propertyRooms.length === 0 && <span className="text-sm text-ink-3">No rooms yet.</span>}
            <Button variant="ghost" onClick={() => setShowRoomForm((v) => !v)} disabled={!propertyId}>
              + New room
            </Button>
          </div>
          {showRoomForm && (
            <form onSubmit={submitRoom} className="mt-3 flex items-end gap-2">
              <div className="w-56">
                <Field
                  label="Room name"
                  value={roomForm.name}
                  onChange={(e) => setRoomForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Garden Villa"
                  autoFocus
                />
              </div>
              <div className="w-28">
                <Field
                  label="Quantity"
                  type="number"
                  min={0}
                  value={roomForm.quantity}
                  onChange={(e) =>
                    setRoomForm((f) => ({ ...f, quantity: Number(e.target.value) || 0 }))
                  }
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : 'Add room'}
              </Button>
            </form>
          )}
        </div>

        {/* Pricing control */}
        {occupancyId && (
          <div className="mt-5 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-2 p-3">
            <div className="w-40">
              <Field
                label="Base price (per night)"
                type="number"
                min={1}
                value={baseForm}
                onChange={(e) => setBaseForm(Number(e.target.value) || 0)}
              />
            </div>
            <Button onClick={applyPrice} disabled={saving}>
              {saving ? 'Pricing…' : 'Set price for 14 days'}
            </Button>
            <span className="pb-2 text-xs text-ink-3">
              selling price is derived by the engine (commission + 18% OTA)
            </span>
          </div>
        )}

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

        {/* Calendar */}
        <Card className="mt-5 p-4">
          {selectedRoom && days.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-ink-2">
                No availability set for <b className="text-ink">{selectedRoom.name}</b> in {FROM} –{' '}
                {TO}.
              </p>
              <Button onClick={openDates} disabled={saving}>
                {saving ? 'Opening…' : `Open these 14 days (×${selectedRoom.quantity})`}
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="flex gap-2" style={{ minWidth: 'max-content' }}>
                {days.map((day) => {
                  const s = statusOf(day);
                  const soldOut = day.roomsToSell === 0 || day.status === 'Close';
                  return (
                    <div
                      key={day.date}
                      className="flex w-24 flex-shrink-0 flex-col items-center gap-1.5 rounded-lg border border-line p-3"
                      style={{
                        background:
                          s.tone === 'avail'
                            ? 'color-mix(in srgb, var(--avail-soft) 55%, var(--surface))'
                            : s.tone === 'low'
                              ? 'color-mix(in srgb, var(--low-soft) 55%, var(--surface))'
                              : 'color-mix(in srgb, var(--closed-soft) 45%, var(--surface))',
                      }}
                    >
                      <div className="text-center">
                        <div className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-3">
                          {dow(day.date)}
                        </div>
                        <div className="font-mono text-base font-bold leading-tight text-ink">
                          {dom(day.date)}
                        </div>
                      </div>
                      <div className="font-mono text-sm font-bold text-ink">
                        {money(prices[day.date])}
                      </div>
                      <Pill tone={s.tone}>{s.label}</Pill>
                      <div className="font-mono text-xs font-semibold text-ink-2">
                        {day.roomsToSell}
                        <span className="text-ink-3">/{day.physicalQuantity}</span>
                      </div>
                      {soldOut ? (
                        <Button
                          variant="ghost"
                          className="w-full !px-2 !py-1 text-xs"
                          disabled={busyDate === day.date || day.status === 'Close'}
                          onClick={() => act('release', day.date)}
                        >
                          {busyDate === day.date ? '…' : 'Release'}
                        </Button>
                      ) : (
                        <Button
                          className="w-full !px-2 !py-1 text-xs"
                          disabled={busyDate === day.date}
                          onClick={() => act('reserve', day.date)}
                        >
                          {busyDate === day.date ? '…' : 'Reserve'}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        <p className="mt-4 font-mono text-xs text-ink-3">
          Tip: change the base price → every cell&rsquo;s selling price recomputes via the
          parity-tested engine.
        </p>

        {/* Bookings */}
        <div className="mt-8 flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink">Bookings</h2>
          <span className="font-mono text-xs text-ink-3">{bookings.length}</span>
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => setShowBookForm((v) => !v)} disabled={!occupancyId}>
            + Book a stay
          </Button>
        </div>
        {showBookForm && (
          <form
            onSubmit={submitBooking}
            className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-2 p-3"
          >
            <div className="w-52">
              <Field
                label="Guest name"
                value={bookForm.name}
                onChange={(e) => setBookForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. A. Fernando"
                autoFocus
              />
            </div>
            <div className="w-40">
              <Field
                label="Check-in"
                type="date"
                value={bookForm.checkin}
                onChange={(e) => setBookForm((f) => ({ ...f, checkin: e.target.value }))}
              />
            </div>
            <div className="w-40">
              <Field
                label="Check-out"
                type="date"
                value={bookForm.checkout}
                onChange={(e) => setBookForm((f) => ({ ...f, checkout: e.target.value }))}
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Booking…' : 'Create booking'}
            </Button>
          </form>
        )}
        <Card className="mt-3 overflow-x-auto">
          {bookings.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-3">No bookings yet.</p>
          ) : (
            <table className="w-full text-sm" style={{ minWidth: 640 }}>
              <thead>
                <tr className="border-b border-line text-left font-mono text-[0.6rem] uppercase tracking-widest text-ink-3">
                  <th className="px-4 py-2 font-medium">Ref</th>
                  <th className="px-4 py-2 font-medium">Guest</th>
                  <th className="px-4 py-2 font-medium">Stay</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-mono font-semibold text-brand-ink">{b.reference}</td>
                    <td className="px-4 py-2">{b.customerName}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-2">
                      {b.checkin} → {b.checkout} · {b.nights}n
                    </td>
                    <td className="px-4 py-2">
                      <Pill tone={bookingTone(b.status)}>{b.status}</Pill>
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">
                      ${Number(b.amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {b.status === 'Pending' && (
                          <Button
                            className="!px-2 !py-1 text-xs"
                            disabled={saving}
                            onClick={() => doBookingAction(b.id, 'approve')}
                          >
                            Approve
                          </Button>
                        )}
                        {(b.status === 'Pending' || b.status === 'Approved') && (
                          <Button
                            variant="ghost"
                            className="!px-2 !py-1 text-xs"
                            disabled={saving}
                            onClick={() => doBookingAction(b.id, 'cancel')}
                          >
                            Cancel
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

        {/* Finance */}
        <div className="mt-8 mb-3 flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink">Finance</h2>
          <span className="font-mono text-xs text-ink-3">Aug 2026</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
              Revenue · approved
            </div>
            <div className="mt-1 text-2xl font-extrabold text-ink">
              ${revenue ? revenue.approvedGross.toFixed(2) : '0.00'}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {revenue &&
                Object.entries(revenue.byStatus).map(([st, v]) => (
                  <Pill key={st} tone={st === 'Approved' ? 'avail' : st === 'Pending' ? 'low' : 'muted'}>
                    {st} · {v.count}
                  </Pill>
                ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="font-mono text-[0.62rem] uppercase tracking-widest text-ink-3">
              Payout statement · this property
            </div>
            {payout && payout.bookingCount > 0 ? (
              <>
                <div className="mt-1 text-2xl font-extrabold text-ink">
                  ${payout.netPayable.toFixed(2)}{' '}
                  <span className="text-sm font-semibold text-ink-3">net payable</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm">
                  <span className="text-ink-3">Gross selling</span>
                  <span className="text-right">${payout.grossSelling.toFixed(2)}</span>
                  <span className="text-ink-3">Property base</span>
                  <span className="text-right">${payout.propertyBase.toFixed(2)}</span>
                  <span className="text-ink-3">Yoho commission</span>
                  <span className="text-right">${payout.yohoCommission.toFixed(2)}</span>
                  <span className="text-ink-3">OTA commission</span>
                  <span className="text-right">${payout.otaCommission.toFixed(2)}</span>
                </div>
                <div className="mt-2 text-xs" style={{ color: 'var(--avail-ink)' }}>
                  ✓ base + yoho + ota = $
                  {(payout.propertyBase + payout.yohoCommission + payout.otaCommission).toFixed(2)}{' '}
                  reconciles to gross
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-3">No approved bookings in this period.</p>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
