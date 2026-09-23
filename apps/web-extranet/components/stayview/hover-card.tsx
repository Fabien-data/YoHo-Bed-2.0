'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowsLeftRight,
  ChatCircleText,
  ClockCountdown,
  Crown,
  CurrencyCircleDollar,
  UsersThree,
} from '@phosphor-icons/react';
import { useMoney } from '@/components/currency';
import { useInteraction } from './interaction/store';
import { STATE_ICON } from './icons';
import { daysBetween, nightsLabel, stayRange } from './model/dates';
import { STATE_META, sourceLabel, stateOf } from './model/status';

/**
 * The one hover card for the whole grid (instead of a tooltip per bar): what a stay is at a
 * glance, without opening it. It follows the store's `hover`, which is cleared the moment a
 * drag starts, so it never covers the room the desk is aiming for.
 */
export function StayHoverCard({
  roomLabel,
  roomTypeName,
  currency,
}: {
  roomLabel: (unitId: string | null | undefined) => string | undefined;
  roomTypeName: (roomId: string | undefined) => string | undefined;
  currency: string;
}) {
  const hover = useInteraction((s) => s.hover);
  const { money } = useMoney();
  if (!hover || typeof document === 'undefined') return null;
  const { bar, rect } = hover;
  const state = stateOf(bar);
  const Icon = STATE_ICON[state];
  const nights = daysBetween(bar.from, bar.to);
  const width = 288;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const below = rect.top + rect.height + 8;
  const above = rect.top - 8;
  const placeAbove = below + 200 > window.innerHeight && above > 220;
  const style: React.CSSProperties = placeAbove
    ? { left, bottom: window.innerHeight - above, width }
    : { left, top: below, width };

  return createPortal(
    <div
      role="tooltip"
      className="sv-hovercard pointer-events-none fixed z-50 rounded-xl border border-line bg-surface p-3 text-xs shadow-overlay"
      style={style}
    >
      <div className="flex items-start gap-2">
        <span
          className="sv-bar relative !static inline-flex h-6 w-6 shrink-0 justify-center !p-0"
          data-state={state}
          data-arrival="true"
          data-departure="true"
        >
          <Icon size={13} weight="bold" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">
            {bar.kind === 'block' ? STATE_META[state].label : bar.guestName}
          </div>
          <div className="text-ink-3">
            {bar.kind === 'block'
              ? bar.reason
              : `${bar.reference ?? ''} · ${STATE_META[state].label}`}
          </div>
        </div>
      </div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-2">
        <dt className="text-ink-3">Stay</dt>
        <dd>
          {stayRange(bar.from, bar.to)} · {nightsLabel(nights)}
        </dd>
        {bar.kind === 'booking' && (
          <>
            <dt className="text-ink-3">Room</dt>
            <dd>
              {roomLabel(bar.roomUnitId) ?? 'Not assigned'}
              {roomTypeName(bar.roomId) ? ` · ${roomTypeName(bar.roomId)}` : ''}
            </dd>
            <dt className="text-ink-3">Guests</dt>
            <dd>
              {bar.adults ?? 0} adult{bar.adults === 1 ? '' : 's'}
              {bar.children ? ` · ${bar.children} child${bar.children === 1 ? '' : 'ren'}` : ''}
            </dd>
            <dt className="text-ink-3">Source</dt>
            <dd>{sourceLabel(bar) || '—'}</dd>
            {bar.amount !== undefined && (
              <>
                <dt className="text-ink-3">Total</dt>
                <dd className="font-mono tabular-nums">
                  {money(bar.amount, currency)}
                  {bar.balance && Number(bar.balance) > 0 && (
                    <span className="text-low-ink"> · {money(bar.balance, currency)} due</span>
                  )}
                </dd>
              </>
            )}
          </>
        )}
        {bar.kind === 'block' && bar.blockedBy && (
          <>
            <dt className="text-ink-3">By</dt>
            <dd>{bar.blockedBy}</dd>
          </>
        )}
      </dl>
      {bar.kind === 'booking' && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-ink-2 empty:hidden">
          {bar.holdUntil && (
            <span className="inline-flex items-center gap-1">
              <ClockCountdown size={12} aria-hidden /> Hold until{' '}
              {new Date(bar.holdUntil).toLocaleString('en-GB', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          {bar.vip && (
            <span className="inline-flex items-center gap-1">
              <Crown size={12} weight="fill" aria-hidden /> VIP
            </span>
          )}
          {bar.hasNotes && (
            <span className="inline-flex items-center gap-1">
              <ChatCircleText size={12} aria-hidden /> Has notes
            </span>
          )}
          {bar.groupId && (
            <span className="inline-flex items-center gap-1">
              <UsersThree size={12} aria-hidden /> Group {bar.groupCode ?? ''}
            </span>
          )}
          {(bar.segment?.of ?? 1) > 1 && (
            <span className="inline-flex items-center gap-1">
              <ArrowsLeftRight size={12} aria-hidden /> Room move: part{' '}
              {(bar.segment?.index ?? 0) + 1} of {bar.segment?.of}
            </span>
          )}
          {bar.balanceDue && (
            <span className="inline-flex items-center gap-1 text-low-ink">
              <CurrencyCircleDollar size={12} aria-hidden /> Payment due
            </span>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
