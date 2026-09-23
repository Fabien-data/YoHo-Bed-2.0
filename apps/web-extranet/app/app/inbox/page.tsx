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
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, toast } from '@yohobed/ui';

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

const TH = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2';

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
    try {
      const res = (await fn()) as { status?: string; reference?: string; error?: string } | null;
      await load();
      if (res && res.status === 'failed') {
        toast.error(`Import failed: ${res.error ?? 'see inbox row'}`);
      } else if (res && res.status === 'imported') {
        toast.success(`Imported as booking ${res.reference ?? ''}`.trim() + '.');
      } else if (okText) {
        toast.success(okText);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Distribution"
        title="OTA reservation inbox"
        description="Reservations pushed by the channel manager land here and are imported as bookings automatically — inventory is reserved atomically, and failures stay visible below so nothing is ever silently dropped. Retry a failed import after fixing its cause."
      />

      {/* Simulate an incoming reservation (dev/demo) */}
      <Card className="p-5">
        <h2 className="text-lg font-bold tracking-tight text-ink">
          Simulate an incoming reservation
        </h2>
        <p className="mt-1 text-sm text-ink-3">
          Fires the same webhook the channel manager would call, for the first mapped room.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Guest name">
            <Input
              value={sim.guestName}
              onChange={(e) => setSim((s) => ({ ...s, guestName: e.target.value }))}
            />
          </Field>
          <Field label="Check-in">
            <Input
              type="date"
              value={sim.checkin}
              onChange={(e) => setSim((s) => ({ ...s, checkin: e.target.value }))}
            />
          </Field>
          <Field label="Check-out">
            <Input
              type="date"
              value={sim.checkout}
              onChange={(e) => setSim((s) => ({ ...s, checkout: e.target.value }))}
            />
          </Field>
          <Button
            loading={busy}
            disabled={mappings.length === 0}
            onClick={() => run(() => simulateOta(sim))}
          >
            Send OTA reservation
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
            <EmptyState title="Nothing from the channel manager yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    <th className={TH}>Status</th>
                    <th className={TH}>Channel</th>
                    <th className={TH}>OTA ref</th>
                    <th className={TH}>Guest</th>
                    <th className={TH}>Stay</th>
                    <th className={`${TH} text-right`}>OTA amount</th>
                    <th className={TH}>Received</th>
                    <th className={TH}></th>
                  </tr>
                </thead>
                <tbody>
                  {reservations.map((r) => (
                    <tr key={r.id} className="border-b border-line align-top last:border-0">
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                        {r.reviewRequired && <Badge tone="low">Review</Badge>}
                        {r.error && (
                          <div className="mt-1.5 max-w-[260px] break-words font-mono text-xs text-closed-ink">
                            {r.error}
                          </div>
                        )}
                        {r.reviewReason && (
                          <div className="mt-1.5 max-w-[260px] text-xs text-low-ink">
                            {r.reviewReason}
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
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-ink-2">
                        {money(r.otaAmount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-ink-3">
                        {when(r.receivedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {r.status === 'failed' && (
                          <Button
                            variant="secondary"
                            size="sm"
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
        <Card className="mt-3 divide-y divide-line overflow-hidden">
          {rooms.map((room) => (
            <div key={room.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="min-w-[180px] font-semibold text-ink">{room.name}</span>
              <Input
                className="w-56 font-mono"
                placeholder="e.g. CM-DLX-001"
                value={codes[room.id] ?? ''}
                onChange={(e) => setCodes((c) => ({ ...c, [room.id]: e.target.value }))}
              />
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !(codes[room.id] ?? '').trim()}
                onClick={() =>
                  run(() => setCmMapping(room.id, codes[room.id]!.trim()), `Mapped ${room.name}.`)
                }
              >
                Save
              </Button>
            </div>
          ))}
          {rooms.length === 0 && <EmptyState title="No rooms yet." />}
        </Card>
      </section>
    </div>
  );
}
