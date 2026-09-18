'use client';

import * as React from 'react';
import { ChatText, Crown, UsersThree } from '@phosphor-icons/react';
import { Checkbox, TagChip, Tooltip, cn } from '@yohobed/ui';
import { displayMealCode, formatDate, formatTime } from '@yohobed/locale';
import type { ReservationConfig, ReservationGroupCard, ReservationRow } from '@/lib/api';
import { Pax, StatusChip, bookedAt } from './bits';

/** Yanolja's date strip: check-in · nights · check-out. */
function StayStrip({
  checkin,
  checkout,
  nights,
  checkinTime,
  checkoutTime,
  timeFormat,
}: {
  checkin: string;
  checkout: string;
  nights: number;
  checkinTime: string;
  checkoutTime: string;
  timeFormat: '12h' | '24h';
}) {
  return (
    <div className="grid grid-cols-[1fr_4rem_1fr] overflow-hidden rounded-lg bg-surface-2 text-center">
      <div className="px-2 py-2">
        <div className="font-mono text-[13px] tabular-nums text-ink">{formatDate(checkin)}</div>
        <div className="text-[11px] text-ink-3">
          {formatTime(checkinTime.slice(0, 5), timeFormat)}
        </div>
      </div>
      <div className="flex flex-col items-center justify-center bg-brand py-2 text-white">
        <span className="font-mono text-base font-semibold leading-none tabular-nums">
          {nights}
        </span>
        <span className="text-[10px]">Night{nights === 1 ? '' : 's'}</span>
      </div>
      <div className="px-2 py-2">
        <div className="font-mono text-[13px] tabular-nums text-ink">{formatDate(checkout)}</div>
        <div className="text-[11px] text-ink-3">
          {formatTime(checkoutTime.slice(0, 5), timeFormat)}
        </div>
      </div>
    </div>
  );
}

function MoneyRows({
  rate,
  total,
  paid,
  balance,
  money,
}: {
  rate: string;
  total: string;
  paid: string;
  balance: string;
  money: (v: string | number) => string;
}) {
  const due = Number(balance) > 0.004;
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-line pt-2 text-xs">
      <dt className="text-ink-3">Rate</dt>
      <dd className="text-right font-mono tabular-nums text-ink">{money(rate)}</dd>
      <dt className="text-ink-3">Total</dt>
      <dd className="text-right font-mono tabular-nums text-ink">{money(total)}</dd>
      <dt className="text-ink-3">Paid</dt>
      <dd className="text-right font-mono tabular-nums text-ink">{money(paid)}</dd>
      <dt className={due ? 'font-semibold text-closed-ink' : 'text-ink-3'}>Balance</dt>
      <dd
        className={cn(
          'text-right font-mono tabular-nums',
          due ? 'font-semibold text-closed-ink' : 'text-ink',
        )}
      >
        {money(balance)}
      </dd>
    </dl>
  );
}

/** One reservation as a card — the card half of the list ⇄ card toggle. */
export function ReservationCard({
  row,
  cfg,
  money,
  selected,
  onToggle,
  onOpen,
  actions,
}: {
  row: ReservationRow;
  cfg: ReservationConfig;
  money: (v: string | number) => string;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  actions: React.ReactNode;
}) {
  const booked = bookedAt(row.createdAt, cfg.property.timezone);
  const perNight = row.nights > 0 ? Number(row.total) / row.nights : Number(row.total);
  const style = cfg.settings.mealCodeStyle;
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-surface p-3 shadow-card transition duration-1',
        selected ? 'border-brand' : 'border-line hover:border-line-strong',
      )}
    >
      <header className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${row.reference}`}
          className="mt-1"
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5">
            {row.sourceCode && <TagChip color={row.sourceColor} code={row.sourceCode} />}
            {row.vip && (
              <Crown size={13} weight="fill" className="shrink-0 text-brass-ink" aria-label="VIP" />
            )}
            <span className="truncate font-semibold text-ink">
              {row.guestTitle ? `${row.guestTitle} ` : ''}
              {row.guestName}
            </span>
          </span>
          <span className="mt-0.5 block font-mono text-xs text-ink-3">
            {row.reference}
            {row.voucherNo && ` | ${row.voucherNo}`}
          </span>
        </button>
        {actions}
      </header>
      <StatusChip row={row} kinds={cfg.kinds} />
      <StayStrip
        checkin={row.checkin}
        checkout={row.checkout}
        nights={row.nights}
        checkinTime={row.arrivalTime ?? cfg.property.checkinTime}
        checkoutTime={row.departureTime ?? cfg.property.checkoutTime}
        timeFormat={cfg.settings.timeFormat}
      />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-ink-3">Booking date</dt>
          <dd className="font-mono tabular-nums text-ink">{booked.date}</dd>
        </div>
        <div className="text-right">
          <dt className="sr-only">Guests</dt>
          <dd>
            <Pax adults={row.adults} children={row.children} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Room</dt>
          <dd className="text-ink">
            {row.roomCodes[0] ?? 'Unassigned'}
            {row.roomTypeName && <span className="text-ink-3"> · {row.roomTypeName}</span>}
          </dd>
        </div>
        <div className="text-right">
          <dt className="text-ink-3">{row.groupCode ? 'Group ID' : 'Meal plan'}</dt>
          <dd className="font-mono text-ink">
            {row.groupCode ?? (row.rateCode ? displayMealCode(row.rateCode, style) : '—')}
          </dd>
        </div>
      </dl>
      <MoneyRows
        rate={perNight.toFixed(2)}
        total={row.total}
        paid={row.paid}
        balance={row.balance}
        money={money}
      />
    </article>
  );
}

/** One group as a card — Yanolja's group view. */
export function GroupCardView({
  group,
  cfg,
  money,
  selected,
  onToggle,
  onOpen,
}: {
  group: ReservationGroupCard;
  cfg: ReservationConfig;
  money: (v: string | number) => string;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const booked = bookedAt(group.bookedAt, cfg.property.timezone);
  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-surface p-3 shadow-card transition duration-1',
        selected ? 'border-brand' : 'border-line hover:border-line-strong',
      )}
      data-testid="group-card"
    >
      <header className="flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select group ${group.code}`}
          className="mt-1"
        />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="flex items-center gap-1.5">
            {group.sourceCode && <TagChip color={group.sourceColor} code={group.sourceCode} />}
            <span className="truncate font-semibold text-ink">{group.name || group.ownerName}</span>
          </span>
          <span className="mt-0.5 block font-mono text-xs text-ink-3">
            {group.code}
            {group.voucherNo && ` | ${group.voucherNo}`}
          </span>
        </button>
        {group.hasHold && (
          <Tooltip label="Some rooms are on hold">
            <span className="rounded-full bg-low-soft px-2 py-0.5 text-[11px] font-semibold text-low-ink">
              Hold
            </span>
          </Tooltip>
        )}
      </header>
      <StayStrip
        checkin={group.checkin}
        checkout={group.checkout}
        nights={group.nights}
        checkinTime={cfg.property.checkinTime}
        checkoutTime={cfg.property.checkoutTime}
        timeFormat={cfg.settings.timeFormat}
      />
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <dt className="text-ink-3">Booking date</dt>
          <dd className="font-mono tabular-nums text-ink">{booked.date}</dd>
        </div>
        <div className="text-right">
          <dt className="sr-only">Guests</dt>
          <dd>
            <Pax adults={group.adults} children={group.children} />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Group ID</dt>
          <dd className="font-mono text-ink">{group.code}</dd>
        </div>
        <div className="text-right">
          <dt className="text-ink-3">Rooms</dt>
          <dd className="font-mono tabular-nums text-ink" title="Live rooms (all rooms)">
            {group.roomsLive} ({group.roomsTotal})
          </dd>
        </div>
      </dl>
      <MoneyRows
        rate={group.averageRate}
        total={group.total}
        paid={group.paid}
        balance={group.balance}
        money={money}
      />
    </article>
  );
}

/** The guest cell of the list: source, name, VIP, others in the room, remarks, and pax. */
export function GuestCell({ row }: { row: ReservationRow }) {
  return (
    <div className="flex min-w-[11rem] flex-col gap-1">
      <span className="flex items-center gap-1.5">
        {row.sourceCode ? (
          <Tooltip label={row.sourceName ?? row.sourceCode}>
            <span>
              <TagChip color={row.sourceColor} code={row.sourceCode} />
            </span>
          </Tooltip>
        ) : row.channel ? (
          <TagChip color="blue" code={row.channel.slice(0, 3).toUpperCase()} />
        ) : null}
        <span className="truncate font-medium text-ink">
          {row.guestTitle ? `${row.guestTitle} ` : ''}
          {row.guestName}
        </span>
        {row.vip && (
          <Crown size={13} weight="fill" className="shrink-0 text-brass-ink" aria-label="VIP" />
        )}
        {row.extraGuests > 0 && (
          <Tooltip label={`${row.extraGuests + 1} guests on this booking`}>
            <span className="shrink-0 text-ink-3">
              <UsersThree size={14} aria-label="More than one guest" />
            </span>
          </Tooltip>
        )}
        {row.remarks > 0 && (
          <Tooltip label={`${row.remarks} remark${row.remarks === 1 ? '' : 's'}`}>
            <span className="shrink-0 text-ink-3">
              <ChatText size={14} aria-label="Has remarks" />
            </span>
          </Tooltip>
        )}
      </span>
      <Pax adults={row.adults} children={row.children} />
    </div>
  );
}
