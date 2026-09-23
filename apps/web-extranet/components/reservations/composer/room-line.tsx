'use client';

import * as React from 'react';
import { ArrowCounterClockwise, X } from '@phosphor-icons/react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  cn,
} from '@yohobed/ui';
import type { ReservationQuote, RoomAvailability } from '@/lib/api';
import { freeFor, type LineDraft } from './draft';

const AUTO = '__auto';

/** "24390.25" → "24,390.25" for reading; the field shows the raw number while editing. */
function grouped(v: string) {
  const n = Number(v.replace(/,/g, ''));
  return Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v;
}
const ADULTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const CHILDREN = [0, 1, 2, 3, 4, 5, 6];

/** The grid's column template — shared with the header row so they line up. */
export const LINE_GRID =
  'grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_4rem_4rem_minmax(0,1.1fr)_2rem] sm:items-start';

/**
 * One room of the reservation — one row of Yanolja's grid: Room Type · Rate Type · Room · Adult ·
 * Child · Rate (tax inclusive). The rate shows the quoted stay total for the room; typing over it
 * sets the price for the room (the pricer spreads it across the nights), and the arrow puts the
 * calendar price back. Where tax is charged on top (India, Malaysia — Sprint 7) the rate shown and
 * typed is the price before tax, as those markets quote it.
 */
export function RoomLine({
  index,
  line,
  lines,
  grid,
  takesRooms,
  quote,
  money,
  error,
  beforeTax = false,
  onChange,
  onRemove,
}: {
  index: number;
  line: LineDraft;
  lines: LineDraft[];
  grid: RoomAvailability | undefined;
  /** Whether the reservation type takes rooms — an inquiry may pick a sold-out type. */
  takesRooms: boolean;
  quote: ReservationQuote['lines'][number] | undefined;
  money: (v: string | number) => string;
  error?: string | null;
  /** The property charges tax on top: show and take the rate before tax. */
  beforeTax?: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove?: () => void;
}) {
  const n = index + 1;
  const roomType = grid?.roomTypes.find((r) => r.roomId === line.roomId);
  const rateTypes = roomType?.rateTypes ?? [];
  const takenUnits = new Set(
    lines.filter((l, i) => i !== index && l.roomUnitId).map((l) => l.roomUnitId),
  );
  const units = (roomType?.units ?? []).filter(
    (u) => u.id === line.roomUnitId || (u.free && !takenUnits.has(u.id)),
  );
  const [editingRate, setEditingRate] = React.useState(false);
  const typed = line.rate.trim() !== '';
  // What the field shows untouched: the stay's price, before tax where tax is added on top.
  const shown = quote
    ? beforeTax
      ? (Number(quote.amount) - Number(quote.taxes)).toFixed(2)
      : quote.amount
    : '';
  // Typing the calendar price back is the same as not typing one.
  const calendar = quote
    ? beforeTax
      ? quote.rateSource === 'calendar'
        ? shown
        : null
      : quote.listAmount
    : null;

  function chooseRoomType(roomId: string) {
    const rt = grid?.roomTypes.find((r) => r.roomId === roomId);
    const rate =
      rt?.rateTypes.find((t) => t.priced && t.accommodates >= line.adults) ??
      rt?.rateTypes.find((t) => t.priced) ??
      rt?.rateTypes[0];
    onChange({ roomId, occupancyId: rate?.occupancyId ?? null, roomUnitId: '', rate: '' });
  }

  return (
    <div className={LINE_GRID} data-testid={`room-line-${n}`}>
      <Select value={line.roomId ?? undefined} onValueChange={chooseRoomType}>
        <SelectTrigger aria-label={`Room type, room ${n}`} className="col-span-2 sm:col-span-1">
          <SelectValue placeholder="-Select-" />
        </SelectTrigger>
        <SelectContent>
          {grid?.roomTypes.map((rt) => {
            const left = freeFor(grid, lines, index, rt.roomId);
            const soldOut = takesRooms && left === 0 && rt.roomId !== line.roomId;
            return (
              <SelectItem
                key={rt.roomId}
                value={rt.roomId}
                disabled={soldOut}
                hint={
                  <span
                    className={cn(
                      left === 0 ? 'text-closed-ink' : left <= 2 ? 'text-low-ink' : 'text-ink-3',
                    )}
                  >
                    {left === 0 ? 'Sold out' : `${left} left`}
                  </span>
                }
              >
                {rt.name}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      <Select
        value={line.occupancyId ?? undefined}
        onValueChange={(occupancyId) => onChange({ occupancyId, rate: '' })}
        disabled={!roomType}
      >
        <SelectTrigger aria-label={`Rate type, room ${n}`} className="col-span-2 sm:col-span-1">
          <SelectValue placeholder="-Select-" />
        </SelectTrigger>
        <SelectContent>
          {rateTypes.map((t) => (
            <SelectItem
              key={t.occupancyId}
              value={t.occupancyId}
              disabled={!t.priced}
              hint={
                t.requiresGuestQuote
                  ? 'Calculated from guests'
                  : t.priced
                    ? `${money(t.average!)}/night`
                    : 'No price'
              }
            >
              {t.rateCode} · {t.label}
              {t.audience !== 'all' ? (t.audience === 'local' ? ' · Resident' : ' · Foreign') : ''}
            </SelectItem>
          ))}
          {roomType && roomType.hiddenRateTypes > 0 && (
            <div className="px-2.5 py-1.5 text-xs text-ink-3">
              {roomType.hiddenRateTypes} resident/foreign rate
              {roomType.hiddenRateTypes === 1 ? '' : 's'} hidden
            </div>
          )}
        </SelectContent>
      </Select>

      <Select
        value={line.roomUnitId || AUTO}
        onValueChange={(v) => onChange({ roomUnitId: v === AUTO ? '' : v })}
        disabled={!roomType}
      >
        <SelectTrigger aria-label={`Room, room ${n}`} className={cn(error && 'border-closed')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>{takesRooms ? 'Any room' : 'No preference'}</SelectItem>
          {units.map((u) => (
            <SelectItem key={u.id} value={u.id} hint={u.floor ? `fl ${u.floor}` : undefined}>
              {u.code}
              {u.displayName ? ` · ${u.displayName}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={String(line.adults)} onValueChange={(v) => onChange({ adults: Number(v) })}>
        <SelectTrigger aria-label={`Adults, room ${n}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ADULTS.map((a) => (
            <SelectItem key={a} value={String(a)}>
              {/* A string: Radix drops a falsy label, so the number 0 would show as blank. */}
              {String(a)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={String(line.children)}
        onValueChange={(v) =>
          onChange({ children: Number(v), childAges: (line.childAges ?? []).slice(0, Number(v)) })
        }
      >
        <SelectTrigger aria-label={`Children, room ${n}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHILDREN.map((c) => (
            <SelectItem key={c} value={String(c)}>
              {String(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="col-span-2 sm:col-span-1">
        <div
          className={cn(
            'flex h-9 items-center rounded-lg border bg-surface text-sm transition duration-1 focus-within:border-brass focus-within:ring-2 focus-within:ring-brass-soft',
            typed ? 'border-brass' : 'border-line-strong',
          )}
        >
          <input
            aria-label={`Rate for the stay, ${beforeTax ? 'before tax' : 'tax inclusive'}, room ${n}`}
            inputMode="decimal"
            disabled={!line.occupancyId}
            value={
              editingRate ? line.rate : typed ? grouped(line.rate) : quote ? grouped(shown) : ''
            }
            placeholder="0.00"
            onFocus={(e) => {
              setEditingRate(true);
              if (!typed && quote) onChange({ rate: shown });
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={() => {
              setEditingRate(false);
              // Typing the calendar price back is the same as not typing one.
              if (quote && Number(line.rate) === Number(calendar)) onChange({ rate: '' });
            }}
            onChange={(e) => onChange({ rate: e.target.value.replace(/[^\d.,]/g, '') })}
            className="h-full w-full min-w-0 bg-transparent px-3 text-right font-mono tabular-nums text-ink outline-none disabled:opacity-50"
          />
          {typed && (
            <Tooltip label="Back to the calendar price">
              <button
                type="button"
                aria-label={`Use the calendar price, room ${n}`}
                onClick={() => onChange({ rate: '' })}
                className="px-2 text-ink-3 transition duration-1 hover:text-ink"
              >
                <ArrowCounterClockwise size={13} />
              </button>
            </Tooltip>
          )}
        </div>
        {quote && (typed || quote.rateSource !== 'calendar') && (
          <p className="mt-1 text-right text-[11px] text-ink-3">
            List <span className="font-mono line-through">{money(quote.listAmount)}</span>
            {quote.discountPct !== 0 && (
              <span className={cn('ml-1', quote.discountPct > 0 ? 'text-low-ink' : 'text-ink-3')}>
                {quote.discountPct > 0
                  ? `−${quote.discountPct.toFixed(1)}%`
                  : `+${(-quote.discountPct).toFixed(1)}%`}
              </span>
            )}
          </p>
        )}
      </div>

      <div className="hidden justify-center pt-1.5 sm:flex">
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove room ${n}`}
            onClick={onRemove}
            className="rounded-md p-1 text-ink-3 transition duration-1 hover:bg-surface-2 hover:text-ink"
          >
            <X size={15} />
          </button>
        )}
      </div>
      {line.children > 0 && (
        <label className="col-span-full text-xs text-ink-2">
          Child ages for room {n}, separated by commas
          <input
            aria-label={`Child ages, room ${n}`}
            className="mt-1 block w-full rounded-lg border border-line bg-surface p-2 text-sm"
            inputMode="numeric"
            defaultValue={(line.childAges ?? []).join(', ')}
            key={`${line.key}-${line.children}`}
            placeholder="For example: 4, 11"
            onBlur={(event) =>
              onChange({
                childAges: event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean)
                  .map(Number),
              })
            }
          />
          {(line.childAges?.length ?? 0) !== line.children && (
            <span className="mt-1 block text-closed-ink">
              Enter one age from 0 to 17 for each child.
            </span>
          )}
        </label>
      )}
      <details className="col-span-full rounded-lg border border-line p-2 text-xs text-ink-2">
        <summary className="cursor-pointer">Beds, cots and minimum-rate exception</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(['extraBeds', 'cots'] as const).map((key) => (
            <label key={key}>
              {key === 'extraBeds' ? 'Extra beds' : 'Cots'}
              <input
                type="number"
                min="0"
                max="10"
                aria-label={`${key === 'extraBeds' ? 'Extra beds' : 'Cots'}, room ${n}`}
                className="mt-1 block w-full rounded-lg border border-line bg-surface p-2"
                value={line[key] ?? 0}
                onChange={(event) => onChange({ [key]: Number(event.target.value) })}
              />
            </label>
          ))}
          <label className="sm:col-span-2">
            Minimum-rate exception reason
            <input
              className="mt-1 block w-full rounded-lg border border-line bg-surface p-2"
              value={line.minimumExceptionReason ?? ''}
              onChange={(event) => onChange({ minimumExceptionReason: event.target.value })}
              placeholder="Only an authorized role may use an exception"
            />
          </label>
        </div>
      </details>
      {quote?.policyVersion && (
        <details className="col-span-full rounded-lg border border-line p-2 text-xs text-ink-2">
          <summary className="cursor-pointer">
            Nightly calculation · policy {quote.policyVersion}
          </summary>
          {quote.nights.map((night) => (
            <div key={night.date} className="mt-2 border-t border-line pt-2">
              <strong>{night.date}</strong>
              {night.smartQuote?.lines.map((item, i) => (
                <div key={i} className="flex justify-between gap-3">
                  <span>{item.label}</span>
                  <span>{money(item.amountMinor / 100)}</span>
                </div>
              ))}
              <p>Room and meal minimum: {money((night.smartQuote?.minimumNetMinor ?? 0) / 100)}</p>
              <p>
                Taxes: {money(night.tax)} · Guest total: {money(night.sellingPrice)}
              </p>
              {night.smartQuote?.belowMinimum && (
                <p className="text-low-ink">
                  Minimum-rate exception: {night.smartQuote.exceptionReason}
                </p>
              )}
            </div>
          ))}
        </details>
      )}
      {error && <p className="col-span-full -mt-1 text-xs font-medium text-closed-ink">{error}</p>}
    </div>
  );
}
