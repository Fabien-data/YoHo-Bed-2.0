'use client';

import { useEffect, useState } from 'react';
import {
  listOtaReservations,
  retryOtaReservation,
  listCmMappings,
  setCmMapping,
  simulateOta,
  listRooms,
  ApiError,
  type OtaReservation,
  type CmMapping,
  type Room,
} from '@/lib/api';
import { longDate, todayISO, addDays } from '@/lib/format';
import { useMoney } from '@/components/currency';
import { Button, Card, Field, Pill } from '@/components/ui';

const STATUS_TONE: Record<
  OtaReservation['status'],
  'avail' | 'closed' | 'low' | 'muted' | 'brand'
> = {
  imported: 'avail',
  failed: 'closed',
  received: 'low',
  cancelled: 'muted',
  ignored: 'muted',
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }).replace(',', '');
}

export default function InboxPage() {
  const { money } = useMoney();
  const [reservations, setReservations] = useState<OtaReservation[]>([]);
  const [mappings, setMappings] = useState<CmMapping[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [sim, setSim] = useState({
    guestName: 'Amara Perera',
    checkin: addDays(todayISO(), 7),
    checkout: addDays(todayISO(), 9),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

  async function load() {
    const [r, m, rm] = await Promise.all([
      listOtaReservations().catch(() => [] as OtaReservation[]),
      listCmMappings().catch(() => [] as CmMapping[]),
      listRooms().catch(() => [] as Room[]),
    ]);
    setReservations(r);
    setMappings(m);
    setRooms(rm);
    setCodes(Object.fromEntries(m.map((x) => [x.roomId, x.code])));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function run(
    fn: () => Promise<{ status: string; reference?: string; error?: string } | unknown>,
    okText?: string,
  ) {
    setBusy(true);
    setMsg(null);
    try {
      const res = (await fn()) as { status?: string; reference?: string; error?: string } | null;
      await load();
      if (res && res.status === 'failed') {
        setMsg({ tone: 'closed', text: `Import failed: ${res.error ?? 'see inbox row'}` });
      } else if (res && res.status === 'imported') {
        setMsg({ tone: 'avail', text: `Imported as booking ${res.reference ?? ''}`.trim() + '.' });
      } else if (okText) {
        setMsg({ tone: 'avail', text: okText });
      }
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Request failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
        Distribution
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink">OTA reservation inbox</h1>
      <p className="mt-2 max-w-2xl text-base text-ink-2">
        Reservations pushed by the channel manager land here and are imported as bookings
        automatically — inventory is reserved atomically, and failures stay visible below so nothing
        is ever silently dropped. Retry a failed import after fixing its cause.
      </p>

      {msg && (
        <div
          className="mt-5 rounded-xl px-4 py-3 text-sm font-semibold"
          style={{
            color: msg.tone === 'avail' ? 'var(--avail-ink)' : 'var(--closed-ink)',
            background: msg.tone === 'avail' ? 'var(--avail-soft)' : 'var(--closed-soft)',
          }}
        >
          {msg.text}
        </div>
      )}

      {/* Simulate an incoming reservation (dev/demo) */}
      <Card className="mt-6 p-5">
        <h2 className="text-lg font-bold tracking-tight text-ink">
          Simulate an incoming reservation
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          Fires the same webhook the channel manager would call, for the first mapped room.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field
            label="Guest name"
            value={sim.guestName}
            onChange={(e) => setSim((s) => ({ ...s, guestName: e.target.value }))}
          />
          <Field
            label="Check-in"
            type="date"
            value={sim.checkin}
            onChange={(e) => setSim((s) => ({ ...s, checkin: e.target.value }))}
          />
          <Field
            label="Check-out"
            type="date"
            value={sim.checkout}
            onChange={(e) => setSim((s) => ({ ...s, checkout: e.target.value }))}
          />
          <Button
            disabled={busy || mappings.length === 0}
            onClick={() => run(() => simulateOta(sim))}
          >
            {busy ? 'Working…' : 'Send OTA reservation'}
          </Button>
          {mappings.length === 0 && (
            <span className="text-sm text-ink-3">Map a room to a CM code first (below).</span>
          )}
        </div>
      </Card>

      {/* The inbox */}
      <section className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-ink">Incoming reservations</h2>
        <Card className="mt-3 overflow-hidden">
          {reservations.length === 0 ? (
            <p className="p-8 text-center text-sm text-ink-3">
              Nothing from the channel manager yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[0.65rem] uppercase tracking-wider text-ink-3">
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Channel</th>
                    <th className="px-4 py-2.5">OTA ref</th>
                    <th className="px-4 py-2.5">Guest</th>
                    <th className="px-4 py-2.5">Stay</th>
                    <th className="px-4 py-2.5 text-right">OTA amount</th>
                    <th className="px-4 py-2.5">Received</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => (
                    <tr key={r.id} className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-3">
                        <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
                        {r.error && (
                          <div
                            className="mt-1.5 max-w-[260px] break-words font-mono text-xs"
                            style={{ color: 'var(--closed-ink)' }}
                          >
                            {r.error}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-ink">{r.channel}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-2">{r.externalRef}</td>
                      <td className="px-4 py-3 text-ink">{r.guestName}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-ink-2">
                        {longDate(r.checkin)} → {longDate(r.checkout)}
                        {r.rooms > 1 ? ` · ${r.rooms} rooms` : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-ink-2">
                        {money(r.otaAmount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-ink-3">
                        {when(r.receivedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === 'failed' && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => run(() => retryOtaReservation(r.id))}
                          >
                            Retry
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* Room-code mappings */}
      <section className="mt-8">
        <h2 className="text-lg font-bold tracking-tight text-ink">Channel-manager room codes</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-3">
          The channel manager identifies rooms by these codes. A reservation for an unmapped code is
          rejected back to the channel manager for retry.
        </p>
        <Card className="mt-3 divide-y divide-[var(--line)] overflow-hidden">
          {rooms.map((room) => (
            <div key={room.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-[180px] font-semibold text-ink">{room.name}</span>
              <input
                className="rounded-lg border border-line-strong bg-surface-2 px-3 py-1.5 font-mono text-sm text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                placeholder="e.g. CM-DLX-001"
                value={codes[room.id] ?? ''}
                onChange={(e) => setCodes((c) => ({ ...c, [room.id]: e.target.value }))}
              />
              <Button
                variant="secondary"
                disabled={busy || !(codes[room.id] ?? '').trim()}
                onClick={() =>
                  run(() => setCmMapping(room.id, codes[room.id]!.trim()), `Mapped ${room.name}.`)
                }
              >
                Save
              </Button>
            </div>
          ))}
          {rooms.length === 0 && (
            <p className="p-8 text-center text-sm text-ink-3">No rooms yet.</p>
          )}
        </Card>
      </section>
    </div>
  );
}
