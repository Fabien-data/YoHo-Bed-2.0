'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listBookings, bookingTransition, amendBooking, ApiError, type Booking } from '@/lib/api';
import { useDesk } from '@/components/booking/desk-dialogs';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Sheet,
  SheetContent,
} from '@yohobed/ui';
import { useMoney } from '@/components/currency';
import {
  useOnReservationCreated,
  useReservationComposer,
} from '@/components/reservations/composer/composer-context';

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

export default function BookingsPage() {
  const { money } = useMoney();
  const [filter, setFilter] = useState<Filter>('All');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);
  const [noShow, setNoShow] = useState<Booking | null>(null);
  const desk = useDesk();

  // Under the "reservations" key, so an action taken in the shared dialogs refreshes this list.
  const list = useQuery({ queryKey: ['reservations', 'all-bookings'], queryFn: listBookings });
  const bookings = useMemo(() => list.data ?? [], [list.data]);
  const load = useCallback(async () => {
    await list.refetch();
  }, [list]);
  const { openComposer } = useReservationComposer();

  /** Check-in, check-out and cancel go through the same guided dialogs as everywhere else. */
  function openDesk(b: Booking, action: 'check-in' | 'check-out' | 'cancel') {
    desk(action, {
      id: b.id,
      reference: b.reference,
      guestName: b.customerName,
      checkin: b.checkin,
      checkout: b.checkout,
    });
  }

  // A reservation saved from the Quick Reservation lands in this list straight away.
  useOnReservationCreated(() => void load());

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
      setMsg({
        tone: 'avail',
        text: `Updated ${edit.reference} — new total ${money(b.amount, b.currency)}.`,
      });
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

  return (
    <div>
      <PageHeader
        eyebrow="Front desk"
        title="Bookings"
        actions={
          <>
            <span className="font-mono text-sm tabular-nums text-ink-3">{bookings.length}</span>
            <Button onClick={() => openComposer()}>+ New reservation</Button>
          </>
        }
      />

      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent
          side="right"
          wide
          title={edit ? `Edit booking ${edit.reference}` : 'Edit booking'}
          description={
            edit?.stayEditable
              ? 'Changing dates or rooms re-prices the stay from the rate calendar and swaps inventory atomically; any coupon discount is kept as granted.'
              : 'Guest details only — this booking has already checked in.'
          }
          footer={
            edit && (
              <div className="flex items-center gap-3">
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
                <Button type="button" variant="outline" onClick={() => setEdit(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="edit-booking-form"
                  loading={busy}
                  disabled={edit.stayEditable && nightsBetween(edit.checkin, edit.checkout) === 0}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            )
          }
        >
          {edit && (
            <form
              id="edit-booking-form"
              onSubmit={saveEdit}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <Field label="Guest name" className="sm:col-span-2">
                <Input
                  value={edit.name}
                  onChange={(e) => setEdit((v) => v && { ...v, name: e.target.value })}
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={edit.email}
                  onChange={(e) => setEdit((v) => v && { ...v, email: e.target.value })}
                  placeholder="guest@example.com"
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={edit.phone}
                  onChange={(e) => setEdit((v) => v && { ...v, phone: e.target.value })}
                  placeholder="+94 …"
                />
              </Field>
              {edit.stayEditable && (
                <>
                  <Field label="Check-in">
                    <Input
                      type="date"
                      value={edit.checkin}
                      onChange={(e) => setEdit((v) => v && { ...v, checkin: e.target.value })}
                    />
                  </Field>
                  <Field label="Check-out">
                    <Input
                      type="date"
                      min={edit.checkin}
                      value={edit.checkout}
                      onChange={(e) => setEdit((v) => v && { ...v, checkout: e.target.value })}
                    />
                  </Field>
                  <Field label="Rooms">
                    <Input
                      type="number"
                      min={1}
                      value={String(edit.rooms)}
                      onChange={(e) =>
                        setEdit((v) => v && { ...v, rooms: Number(e.target.value) || 1 })
                      }
                    />
                  </Field>
                </>
              )}
              {msg?.tone === 'closed' && (
                <div className="rounded-lg bg-closed-soft px-3 py-2 text-sm font-medium text-closed-ink sm:col-span-2">
                  {msg.text}
                </div>
              )}
            </form>
          )}
        </SheetContent>
      </Sheet>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              filter === s
                ? 'border-brand bg-brand-soft text-brand-ink'
                : 'border-line-strong text-ink-2 hover:border-ink-3'
            }`}
          >
            {s}
            {s !== 'All' && counts[s] ? (
              <span className="ml-1.5 text-ink-3">{counts[s]}</span>
            ) : null}
          </button>
        ))}
        <div className="flex-1" />
        <Input
          className="w-56"
          placeholder="Search guest or reference…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {msg && !edit && (
        <div
          className={`mt-4 rounded-lg px-3 py-2 text-sm font-medium ${
            msg.tone === 'avail' ? 'bg-avail-soft text-avail-ink' : 'bg-closed-soft text-closed-ink'
          }`}
        >
          {msg.text}
        </div>
      )}

      <Card className="mt-4 overflow-x-auto">
        {filtered.length === 0 ? (
          <EmptyState title="No bookings match." />
        ) : (
          <table className="w-full text-sm" style={{ minWidth: 720 }}>
            <thead>
              <tr className="border-b border-line bg-surface-2">
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                  Ref
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                  Guest
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                  Stay
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                  Source
                </th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                  Status
                </th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                  Amount
                </th>
                <th className="px-3 py-2.5" />
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
                    <Badge tone={tone(b.status)}>{b.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                    {money(b.amount, b.currency)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {b.status === 'Pending' && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => act(b.id, 'approve')}>
                            Approve
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => act(b.id, 'reject')}
                          >
                            Reject
                          </Button>
                        </>
                      )}
                      {b.status === 'Approved' && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => openDesk(b, 'check-in')}>
                            Check in
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            onClick={() => setNoShow(b)}
                          >
                            No-show
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => openDesk(b, 'cancel')}
                          >
                            Cancel
                          </Button>
                        </>
                      )}
                      {b.status === 'CheckedIn' && (
                        <Button size="sm" disabled={busy} onClick={() => openDesk(b, 'check-out')}>
                          Check out
                        </Button>
                      )}
                      {canEdit(b.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
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
      <ConfirmDialog
        open={noShow !== null}
        onOpenChange={(o) => !o && setNoShow(null)}
        title={`Mark ${noShow?.reference ?? ''} as a no-show?`}
        description="The guest did not arrive. The nights after tonight go back on sale. If they turn up later, bring the reservation back."
        confirmLabel="Mark no-show"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => noShow && void act(noShow.id, 'no-show')}
      />
    </div>
  );
}
