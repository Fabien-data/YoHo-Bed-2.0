'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  listProperties,
  listRooms,
  getAvailability,
  openAvailability,
  getRoomRates,
  setPrice,
  listRatePlans,
  listOccupancies,
  setLastMinuteDrop,
  setRestrictions,
  getAriHistory,
  ApiError,
  type Property,
  type Room,
  type AvailabilityDay,
  type RateDay,
  type Occupancy,
  type AriHistoryEntry,
} from '@/lib/api';
import { Button, Card, Pill } from '@/components/ui';
import {
  dom,
  monthDays,
  addMonths,
  monthYear,
  longDate,
  todayISO,
  firstOfMonth,
} from '@/lib/format';
import { useMoney } from '@/components/currency';

const INITIAL_MONTH = firstOfMonth(todayISO());
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type OccRow = Occupancy & { code: string };
type Editing = { kind: 'price'; date: string } | { kind: 'avail'; date: string } | null;

const selectClass =
  'rounded-xl border border-line-strong bg-surface-2 px-4 py-2.5 text-sm font-semibold text-ink outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand';

/** Monday-first weekday index (Mon=0 … Sun=6). */
function mondayIndex(d: string): number {
  return (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function availTone(a: AvailabilityDay | undefined): { ink: string; soft: string; label: string } {
  if (!a) return { ink: 'var(--ink-3)', soft: 'transparent', label: '' };
  if (a.status === 'Close')
    return { ink: 'var(--closed-ink)', soft: 'var(--closed-soft)', label: 'Closed' };
  if (a.roomsToSell === 0)
    return { ink: 'var(--closed-ink)', soft: 'var(--closed-soft)', label: 'Sold out' };
  if (a.roomsToSell <= 2) return { ink: 'var(--low-ink)', soft: 'var(--low-soft)', label: 'Low' };
  return { ink: 'var(--avail-ink)', soft: 'var(--avail-soft)', label: 'Open' };
}

export default function CalendarPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [occId, setOccId] = useState('');
  const [month, setMonth] = useState(INITIAL_MONTH);

  const [occs, setOccs] = useState<OccRow[]>([]);
  const [avail, setAvail] = useState<Record<string, AvailabilityDay>>({});
  const [rates, setRates] = useState<Record<string, Record<string, RateDay>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);

  const [bulkBase, setBulkBase] = useState(18000);
  const [bulkRooms, setBulkRooms] = useState(5);
  const [bulkDrop, setBulkDrop] = useState(15);
  const [bulkMin, setBulkMin] = useState(1);
  const [bulkMax, setBulkMax] = useState(0);
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [history, setHistory] = useState<AriHistoryEntry[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState('');
  const cancelRef = useRef(false);

  const { money, moneyShort } = useMoney();
  // Everything on this screen is scoped to the selected property, so all amounts are in its currency.
  const propCurrency = properties.find((p) => p.id === propertyId)?.currency;

  const dates = useMemo(() => monthDays(month), [month]);
  const monthFrom = dates[0]!;
  const monthTo = dates[dates.length - 1]!;
  // Bulk actions apply to this range; empty pickers fall back to the whole visible month.
  const bulkFrom = rangeFrom || monthFrom;
  const bulkTo = rangeTo || monthTo;
  const bulkNights = Math.round((Date.parse(bulkTo) - Date.parse(bulkFrom)) / 86_400_000) + 1;
  const bulkRangeValid = Number.isFinite(bulkNights) && bulkNights > 0;
  const bulkRangeLabel =
    bulkFrom === monthFrom && bulkTo === monthTo
      ? `all of ${monthYear(month)}`
      : `${longDate(bulkFrom)} → ${longDate(bulkTo)}`;
  const propertyRooms = useMemo(
    () => rooms.filter((r) => r.propertyId === propertyId),
    [rooms, propertyId],
  );
  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);
  const occRates = rates[occId] ?? {};

  // The month laid out as calendar weeks (leading/trailing blanks fill the grid).
  const weeks = useMemo(() => {
    const cells: (string | null)[] = [];
    for (let i = 0; i < mondayIndex(monthFrom); i++) cells.push(null);
    for (const d of dates) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    const rowsOut: (string | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rowsOut.push(cells.slice(i, i + 7));
    return rowsOut;
  }, [dates, monthFrom]);

  const loadGrid = useCallback(async (rid: string, first: string) => {
    setLoading(true);
    setEditing(null);
    try {
      const days = monthDays(first);
      const [plans, availDays, rateRows] = await Promise.all([
        listRatePlans(rid).catch(() => []),
        getAvailability(rid, days[0]!, days[days.length - 1]!).catch(() => []),
        getRoomRates(rid, days[0]!, days[days.length - 1]!).catch(() => [] as RateDay[]),
      ]);
      const occRows: OccRow[] = [];
      for (const plan of plans) {
        const os = await listOccupancies(plan.id).catch(() => []);
        for (const o of os) occRows.push({ ...o, code: plan.code });
      }
      setOccs(occRows);
      setOccId((prev) => (occRows.some((o) => o.id === prev) ? prev : (occRows[0]?.id ?? '')));
      setAvail(Object.fromEntries(availDays.map((d) => [d.date, d])));
      const byOcc: Record<string, Record<string, RateDay>> = {};
      for (const r of rateRows) (byOcc[r.occupancyId] ??= {})[r.date] = r;
      setRates(byOcc);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const [props, allRooms] = await Promise.all([listProperties(), listRooms()]);
      setProperties(props);
      setRooms(allRooms);
      const pid = props[0]?.id ?? null;
      setPropertyId(pid);
      const firstRoom = allRooms.find((r) => r.propertyId === pid) ?? null;
      setRoomId(firstRoom?.id ?? null);
      if (firstRoom) await loadGrid(firstRoom.id, INITIAL_MONTH);
      else setLoading(false);
    })().catch(() => setLoading(false));
  }, [loadGrid]);

  async function selectProperty(pid: string) {
    setPropertyId(pid);
    const next = rooms.filter((r) => r.propertyId === pid)[0]?.id ?? null;
    setRoomId(next);
    if (next) await loadGrid(next, month);
    else {
      setOccs([]);
      setAvail({});
      setRates({});
      setLoading(false);
    }
  }
  async function selectRoom(id: string) {
    setRoomId(id);
    await loadGrid(id, month);
  }
  async function shiftMonth(n: number) {
    const nm = addMonths(month, n);
    setMonth(nm);
    if (roomId) await loadGrid(roomId, nm);
  }
  async function jumpMonth(ym: string) {
    if (!ym) return;
    const nm = `${ym}-01`;
    setMonth(nm);
    if (roomId) await loadGrid(roomId, nm);
  }
  const reload = () => (roomId ? loadGrid(roomId, month) : Promise.resolve());

  async function guard(fn: () => Promise<void>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (ok) setMsg({ tone: 'avail', text: ok });
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  // --- inline cell editing ---
  function startPrice(date: string) {
    const cur = occRates[date];
    setDraft(cur ? String(Math.round(Number(cur.basePrice))) : String(bulkBase));
    cancelRef.current = false;
    setEditing({ kind: 'price', date });
  }
  function startAvail(date: string) {
    const a = avail[date];
    setDraft(a ? String(a.roomsToSell) : String(selectedRoom?.quantity ?? 0));
    setEditing({ kind: 'avail', date });
  }
  async function commitPrice(date: string) {
    if (cancelRef.current) {
      cancelRef.current = false;
      setEditing(null);
      return;
    }
    const base = Number(draft);
    setEditing(null);
    const cur = occRates[date];
    if (!occId || !base || base <= 0) return;
    if (cur && Math.round(Number(cur.basePrice)) === Math.round(base)) return;
    await guard(() => setPrice(occId, date, date, base).then(() => undefined));
  }
  async function commitAvail(date: string, status: 'Open' | 'Close') {
    if (!selectedRoom) return;
    const n = Number(draft);
    setEditing(null);
    await guard(() =>
      openAvailability(selectedRoom.id, date, date, Number.isNaN(n) ? 0 : n, status).then(
        () => undefined,
      ),
    );
  }

  // --- bulk (chosen date range, selected occupancy / room) ---
  const applyBulkPrice = () =>
    occId &&
    bulkRangeValid &&
    guard(async () => {
      const res = await setPrice(occId, bulkFrom, bulkTo, bulkBase);
      setMsg({
        tone: 'avail',
        text: `Base ${money(bulkBase, propCurrency)} → selling ${money(res.selling, propCurrency)} across ${bulkNights} nights (${bulkRangeLabel}).`,
      });
    });
  const applyBulkAvail = (status: 'Open' | 'Close') =>
    selectedRoom &&
    bulkRangeValid &&
    guard(
      () =>
        openAvailability(selectedRoom.id, bulkFrom, bulkTo, bulkRooms, status).then(
          () => undefined,
        ),
      `${status === 'Open' ? 'Opened' : 'Closed'} ${bulkNights} nights (${bulkRooms} rooms/night, ${bulkRangeLabel}).`,
    );
  const applyBulkDrop = () =>
    occId &&
    bulkRangeValid &&
    guard(
      () => setLastMinuteDrop(occId, bulkFrom, bulkTo, bulkDrop).then(() => undefined),
      `Applied a ${bulkDrop}% last-minute drop across ${bulkNights} nights (${bulkRangeLabel}).`,
    );
  const applyBulkRestrictions = () =>
    selectedRoom &&
    bulkRangeValid &&
    guard(
      () =>
        setRestrictions(selectedRoom.id, {
          from: bulkFrom,
          to: bulkTo,
          minStay: bulkMin,
          maxStay: bulkMax,
        }).then(() => undefined),
      `Min stay ${bulkMin} / max stay ${bulkMax === 0 ? 'unlimited' : bulkMax} set for arrivals ${bulkRangeLabel}.`,
    );

  async function toggleHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (next && selectedRoom) {
      setHistory(await getAriHistory(selectedRoom.id).catch(() => []));
    }
  }

  function historyLine(h: AriHistoryEntry): string {
    const d = h.detail as Record<string, unknown>;
    if (h.kind === 'price')
      return `base ${money(Number(d.base), propCurrency)} → selling ${money(Number(d.selling), propCurrency)}`;
    if (h.kind === 'drop') return `last-minute drop ${d.dropPct}%`;
    if (h.kind === 'restriction')
      return `min stay ${d.minStay} / max stay ${Number(d.maxStay) === 0 ? 'unlimited' : d.maxStay}`;
    return `${d.roomsToSell} rooms to sell · ${d.status}`;
  }

  const noRooms = propertyRooms.length === 0;
  const noPlans = !loading && selectedRoom && occs.length === 0;

  return (
    <div>
      <div className="mb-1.5 font-mono text-xs uppercase tracking-widest text-ink-3">
        Rates &amp; Availability
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-ink">Calendar</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => shiftMonth(-1)}
            className="!px-4 !py-2.5 text-base"
          >
            ◀
          </Button>
          <span className="min-w-[170px] text-center text-xl font-bold text-ink">
            {monthYear(month)}
          </span>
          <Button
            variant="secondary"
            onClick={() => shiftMonth(1)}
            className="!px-4 !py-2.5 text-base"
          >
            ▶
          </Button>
          <input
            type="month"
            className={`${selectClass} ml-1`}
            value={month.slice(0, 7)}
            onChange={(e) => jumpMonth(e.target.value)}
          />
        </div>
      </div>

      {/* selectors */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <select
          className={selectClass}
          value={propertyId ?? ''}
          onChange={(e) => selectProperty(e.target.value)}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={roomId ?? ''}
          onChange={(e) => selectRoom(e.target.value)}
          disabled={noRooms}
        >
          {noRooms && <option>No rooms yet</option>}
          {propertyRooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · ×{r.quantity}
            </option>
          ))}
        </select>
        <select
          className={selectClass}
          value={occId}
          onChange={(e) => setOccId(e.target.value)}
          disabled={occs.length === 0}
        >
          {occs.length === 0 && <option>No occupancies</option>}
          {occs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.code} · {o.label} (×{o.accommodates})
            </option>
          ))}
        </select>
      </div>

      {/* bulk toolbar */}
      {occs.length > 0 && (
        <Card className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-4 p-5">
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">From</span>
              <input
                type="date"
                className={`${selectClass} w-40`}
                value={bulkFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">To</span>
              <input
                type="date"
                className={`${selectClass} w-40`}
                value={bulkTo}
                min={bulkFrom}
                onChange={(e) => setRangeTo(e.target.value)}
              />
            </label>
            <Button
              variant="ghost"
              className="!py-2.5"
              onClick={() => {
                setRangeFrom('');
                setRangeTo('');
              }}
            >
              Whole month
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Base / night
              </span>
              <input
                type="number"
                min={1}
                className={`${selectClass} w-36`}
                value={bulkBase}
                onChange={(e) => setBulkBase(Number(e.target.value) || 0)}
              />
            </label>
            <Button
              onClick={applyBulkPrice}
              disabled={busy || !occId || !bulkRangeValid}
              className="!py-2.5"
            >
              Set price
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Drop %
              </span>
              <input
                type="number"
                min={0}
                max={90}
                className={`${selectClass} w-24`}
                value={bulkDrop}
                onChange={(e) => setBulkDrop(Number(e.target.value) || 0)}
              />
            </label>
            <Button
              variant="ghost"
              onClick={applyBulkDrop}
              disabled={busy || !occId || !bulkRangeValid}
              className="!py-2.5"
            >
              Last-minute drop
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Rooms to sell
              </span>
              <input
                type="number"
                min={0}
                className={`${selectClass} w-28`}
                value={bulkRooms}
                onChange={(e) => setBulkRooms(Number(e.target.value) || 0)}
              />
            </label>
            <Button
              variant="secondary"
              onClick={() => applyBulkAvail('Open')}
              disabled={busy || !bulkRangeValid}
              className="!py-2.5"
            >
              Open
            </Button>
            <Button
              variant="secondary"
              onClick={() => applyBulkAvail('Close')}
              disabled={busy || !bulkRangeValid}
              className="!py-2.5"
            >
              Close
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Min stay
              </span>
              <input
                type="number"
                min={1}
                max={60}
                className={`${selectClass} w-20`}
                value={bulkMin}
                onChange={(e) => setBulkMin(Number(e.target.value) || 1)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Max (0 = ∞)
              </span>
              <input
                type="number"
                min={0}
                max={365}
                className={`${selectClass} w-20`}
                value={bulkMax}
                onChange={(e) => setBulkMax(Number(e.target.value) || 0)}
              />
            </label>
            <Button
              variant="ghost"
              onClick={applyBulkRestrictions}
              disabled={busy || !selectedRoom || !bulkRangeValid}
              className="!py-2.5"
            >
              Restrictions
            </Button>
          </div>
          <span
            className="pb-2 text-xs font-medium"
            style={{ color: bulkRangeValid ? 'var(--ink-3)' : 'var(--closed-ink)' }}
          >
            {bulkRangeValid
              ? `applies to ${bulkRangeLabel} · ${bulkNights} night${bulkNights === 1 ? '' : 's'}`
              : '“To” date must be on or after “From”'}
          </span>
        </Card>
      )}

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

      {/* wall calendar */}
      <Card className="mt-6 overflow-hidden">
        {loading ? (
          <p className="p-16 text-center text-base text-ink-3">Loading calendar…</p>
        ) : noRooms ? (
          <p className="p-16 text-center text-base text-ink-3">
            No rooms in this property yet. Add rooms in the <b className="text-ink">Setup</b> tab.
          </p>
        ) : noPlans ? (
          <p className="p-16 text-center text-base text-ink-3">
            No rate plans for <b className="text-ink">{selectedRoom?.name}</b>. Create a rate plan
            and occupancy in <b className="text-ink">Setup</b>, then set prices here.
          </p>
        ) : (
          <>
            {/* weekday header */}
            <div className="grid grid-cols-7 border-b border-line">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={w}
                  className="px-3 py-3 text-center font-mono text-xs font-bold uppercase tracking-widest text-ink-3"
                  style={i >= 5 ? { background: 'var(--surface-2)' } : undefined}
                >
                  {w}
                </div>
              ))}
            </div>
            {/* weeks */}
            <div className="grid grid-cols-7">
              {weeks.flat().map((cell, idx) => {
                const col = idx % 7;
                const weekend = col >= 5;
                if (!cell) {
                  return (
                    <div
                      key={idx}
                      className="min-h-[128px] border-b border-r border-line last:border-r-0"
                      style={{ background: 'var(--surface-2)', opacity: 0.5 }}
                    />
                  );
                }
                const a = avail[cell];
                const t = availTone(a);
                const r = occRates[cell];
                const drop = r ? Number(r.lastMinuteDropPct) : 0;
                const editP = editing?.kind === 'price' && editing.date === cell;
                const editA = editing?.kind === 'avail' && editing.date === cell;
                return (
                  <div
                    key={cell}
                    className={`min-h-[128px] border-b border-line p-2.5 ${col < 6 ? 'border-r' : ''}`}
                    style={weekend ? { background: 'var(--surface-2)' } : undefined}
                  >
                    {/* day number + status */}
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-lg font-bold text-ink">{dom(cell)}</span>
                      {t.label && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide"
                          style={{ color: t.ink, background: t.soft }}
                        >
                          {t.label}
                        </span>
                      )}
                    </div>

                    {/* price */}
                    <div className="mt-2">
                      {editP ? (
                        <input
                          type="number"
                          autoFocus
                          min={0}
                          className="w-full rounded-lg border-2 border-brand bg-surface px-2 py-1.5 text-center font-mono text-base font-bold text-ink outline-none"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            else if (e.key === 'Escape') {
                              cancelRef.current = true;
                              e.currentTarget.blur();
                            }
                          }}
                          onBlur={() => commitPrice(cell)}
                        />
                      ) : (
                        <button
                          onClick={() => startPrice(cell)}
                          className="flex w-full flex-col items-start rounded-lg px-1 py-1 text-left transition hover:bg-black/5"
                          title="Click to set the base price"
                        >
                          {r ? (
                            <>
                              <span className="font-mono text-lg font-bold text-ink">
                                {moneyShort(r.effectiveSelling, propCurrency)}
                              </span>
                              {drop > 0 && (
                                <span className="mt-0.5 flex items-center gap-1.5">
                                  <span className="font-mono text-xs text-ink-3 line-through">
                                    {moneyShort(r.sellingPrice, propCurrency)}
                                  </span>
                                  <span
                                    className="rounded px-1 text-[0.6rem] font-bold"
                                    style={{
                                      color: 'var(--closed-ink)',
                                      background: 'var(--closed-soft)',
                                    }}
                                  >
                                    −{Math.round(drop)}%
                                  </span>
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-ink-3">Set price</span>
                          )}
                        </button>
                      )}
                    </div>

                    {/* rooms to sell */}
                    <div className="mt-1.5">
                      {editA ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            autoFocus
                            min={0}
                            className="w-14 rounded-lg border-2 border-brand bg-surface px-1 py-1 text-center font-mono text-sm font-bold text-ink outline-none"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitAvail(cell, 'Open');
                              else if (e.key === 'Escape') setEditing(null);
                            }}
                          />
                          <button
                            onClick={() => commitAvail(cell, 'Open')}
                            className="rounded-md px-1.5 py-1 text-[0.65rem] font-bold"
                            style={{ color: 'var(--avail-ink)', background: 'var(--avail-soft)' }}
                          >
                            Open
                          </button>
                          <button
                            onClick={() => commitAvail(cell, 'Close')}
                            className="rounded-md px-1.5 py-1 text-[0.65rem] font-bold"
                            style={{ color: 'var(--closed-ink)', background: 'var(--closed-soft)' }}
                          >
                            Close
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startAvail(cell)}
                          className="rounded-lg px-1 py-0.5 font-mono text-xs font-semibold text-ink-2 transition hover:bg-black/5"
                          title="Click to edit rooms-to-sell / open-close"
                        >
                          {a ? (
                            <>
                              {a.roomsToSell}
                              <span className="text-ink-3">/{a.physicalQuantity} rooms</span>
                            </>
                          ) : (
                            <span className="text-ink-3">Set rooms</span>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      <p className="mt-4 text-sm text-ink-3">
        {monthYear(month)} · {selectedRoom?.name}
        {occs.find((o) => o.id === occId) ? ` · ${occs.find((o) => o.id === occId)!.label}` : ''}.
        Click a price to type a new base (Enter to save, Esc to cancel); click rooms-to-sell to edit
        inventory or open/close. Selling prices come from the parity-tested engine.
      </p>

      {/* ARI change history (Compartment I) */}
      <section className="mt-8">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight text-ink">Change history</h2>
          <Button variant="secondary" onClick={toggleHistory} disabled={!selectedRoom}>
            {showHistory ? 'Hide' : 'Show'}
          </Button>
        </div>
        {showHistory && (
          <Card className="mt-3 overflow-hidden">
            {!history || history.length === 0 ? (
              <p className="p-8 text-center text-sm text-ink-3">
                No changes recorded yet for {selectedRoom?.name ?? 'this room'}.
              </p>
            ) : (
              <div className="flex flex-col">
                {history.map((h) => (
                  <div
                    key={h.id}
                    className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2.5 text-sm last:border-0"
                  >
                    <Pill
                      tone={
                        h.kind === 'price'
                          ? 'brand'
                          : h.kind === 'availability'
                            ? 'avail'
                            : h.kind === 'drop'
                              ? 'closed'
                              : 'low'
                      }
                    >
                      {h.kind}
                    </Pill>
                    <span className="whitespace-nowrap text-ink-2">
                      {longDate(h.fromDate)}
                      {h.toDate !== h.fromDate ? ` → ${longDate(h.toDate)}` : ''}
                    </span>
                    <span className="font-mono text-xs text-ink">{historyLine(h)}</span>
                    <span className="ml-auto font-mono text-[0.65rem] text-ink-3">
                      {h.actorEmail ?? 'system'} ·{' '}
                      {new Date(h.createdAt)
                        .toLocaleString('en-GB', { hour12: false })
                        .replace(',', '')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}
