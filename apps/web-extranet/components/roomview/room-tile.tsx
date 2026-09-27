'use client';

import * as React from 'react';
import {
  ArrowsLeftRight,
  BellSlash,
  CalendarBlank,
  Cigarette,
  Crown,
  ForkKnife,
  GitBranch,
  Lightning,
  LinkSimple,
  Prohibit,
  ShieldCheck,
  User,
  Users,
  Wheelchair,
  Wrench,
} from '@phosphor-icons/react';
import { Tooltip, cn } from '@yohobed/ui';
import type { HousekeepingState, RoomCard, StayBar } from '@/lib/api';
import { HK_ICON, STATE_ICON } from '@/components/stayview/icons';
import { dayOfMonth, monthShort, stayRange } from '@/components/stayview/model/dates';
import { HK_META, sourceLabel, stateOf, type StayState } from '@/components/stayview/model/status';

/**
 * A room on the Room View: its number and housekeeping, and tonight's guest drawn as the same
 * band the Stay View draws — the same colours, shape and markers — so a room reads the same on
 * both screens. A slanted start is an arrival today, a slanted end a departure today; a square,
 * faded end is a stay that runs on either side.
 */

/** The Stay View state of the stay in the room, or what the room itself is. */
function bandOf(
  card: RoomCard,
  date: string,
): {
  state: StayState | 'vacant';
  slantStart: boolean;
  slantEnd: boolean;
} {
  if (card.state === 'OutOfOrder')
    return { state: 'out_of_service', slantStart: false, slantEnd: false };
  if (!card.bookingId) return { state: 'vacant', slantStart: false, slantEnd: false };
  const state = stateOf({
    kind: 'booking',
    status: card.bookingStatus ?? undefined,
    reservationKind: card.reservationKind ?? undefined,
    holdUntil: card.holdUntil ?? null,
  } as StayBar);
  return {
    state,
    slantStart: card.checkin === date,
    slantEnd: card.checkout === date || card.dayUse,
  };
}

const HK_TONE: Record<HousekeepingState, string> = {
  dirty: 'bg-low-soft text-low-ink',
  clean: 'bg-avail-soft text-avail-ink',
  inspected: 'bg-avail-soft text-avail-ink',
  out_of_order: 'bg-closed-soft text-closed-ink',
};

function shortDate(iso: string) {
  return `${dayOfMonth(iso)} ${monthShort(iso)}`;
}

export const HK_ACTION_LABEL: Record<HousekeepingState, string> = {
  dirty: 'Dirty',
  clean: 'Clean',
  inspected: 'Inspected',
  out_of_order: 'Out of order',
};

export function RoomTile({
  card,
  date,
  onOpen,
  compact = false,
  maintenanceOverlay = false,
  index = 0,
  onQuickStatus,
  canInspect = false,
  selected = false,
  dimmed = false,
}: {
  card: RoomCard;
  /** The business date the grid shows: arrivals and departures are relative to it. */
  date: string;
  onOpen: () => void;
  compact?: boolean;
  maintenanceOverlay?: boolean;
  index?: number;
  onQuickStatus?: (status: HousekeepingState) => void;
  canInspect?: boolean;
  selected?: boolean;
  dimmed?: boolean;
}) {
  const [quickOpen, setQuickOpen] = React.useState(false);
  const [statusPulse, setStatusPulse] = React.useState(false);
  const previousStatus = React.useRef(card.housekeeping);
  React.useEffect(() => {
    if (previousStatus.current !== card.housekeeping) {
      setStatusPulse(true);
      const timeout = window.setTimeout(() => setStatusPulse(false), 650);
      previousStatus.current = card.housekeeping;
      return () => window.clearTimeout(timeout);
    }
  }, [card.housekeeping]);

  const band = bandOf(card, date);
  const Hk = HK_ICON[card.housekeeping];
  const hk = HK_META[card.housekeeping];
  const StateIcon = band.state === 'vacant' ? null : STATE_ICON[band.state];
  const pax = (card.adults ?? 0) + (card.children ?? 0);
  const next =
    card.nextReservation &&
    `${shortDate(card.nextReservation.checkin)} · ${card.nextReservation.guestName}`;
  const stayLabel =
    band.state === 'vacant'
      ? 'Vacant'
      : band.state === 'out_of_service'
        ? (card.blockReason ?? card.frontDeskLabel)
        : (card.guestName ?? 'Guest');
  const summary = [
    `Room ${card.code}`,
    card.displayName,
    card.roomName,
    hk.label,
    card.frontDeskLabel,
    card.guestName,
    card.checkin && card.checkout && stayRange(card.checkin, card.checkout),
    card.balanceDue && 'payment due',
    card.hasNotes && 'has notes',
    card.vip && 'VIP',
    card.nextReservation &&
      `next arrival ${shortDate(card.nextReservation.checkin)}, ${card.nextReservation.guestName}`,
  ]
    .filter(Boolean)
    .join(', ');

  // Attributes of the room and the stay, each with its own tooltip.
  const flags: Array<[string, React.ReactNode]> = [];
  if (card.openWorkOrders > 0)
    flags.push([
      `${card.openWorkOrders} open work order${card.openWorkOrders === 1 ? '' : 's'}`,
      <span key="wo" className="inline-flex items-center gap-0.5 text-low-ink">
        <Wrench size={13} weight="bold" />
        <span className="font-mono text-[11px] font-semibold tabular-nums">
          {card.openWorkOrders}
        </span>
      </span>,
    ]);
  if (card.unitStatus === 'inactive')
    flags.push(['Room disabled', <Prohibit key="off" size={13} className="text-closed-ink" />]);
  if (card.doNotDisturb)
    flags.push(['Do not disturb', <BellSlash key="dnd" size={13} className="text-low-ink" />]);
  if (card.cleaningTask?.rush)
    flags.push(['Rush clean', <Lightning key="rush" size={13} className="text-low-ink" />]);
  if (card.plannedMove)
    flags.push([
      'Planned room move',
      <ArrowsLeftRight key="mv" size={13} className="text-low-ink" />,
    ]);
  if (card.requestedSafetyFlag)
    flags.push([
      'Guest-requested safety preference',
      <ShieldCheck key="safe" size={13} className="text-low-ink" />,
    ]);
  if (card.groupBooking)
    flags.push([
      card.groupOwner ? 'Group booking — the group owner' : 'Group booking',
      <Users key="grp" size={13} className={card.groupOwner ? 'text-info-ink' : undefined} />,
    ]);
  if (card.splitReservation)
    flags.push(['Linked multi-room reservation', <GitBranch key="split" size={13} />]);
  if (card.dayUse) flags.push(['Day-use reservation', <CalendarBlank key="day" size={13} />]);
  if (card.mealPlan) flags.push([`Meal plan ${card.mealPlan}`, <ForkKnife key="meal" size={13} />]);
  if (card.wheelchairAccessible)
    flags.push(['Wheelchair accessible', <Wheelchair key="acc" size={13} />]);
  if (card.smokingPolicy !== 'unspecified')
    flags.push([
      card.smokingPolicy === 'smoking' ? 'Smoking room' : 'No smoking',
      <span key="smoke" className="relative inline-flex">
        <Cigarette size={13} />
        {card.smokingPolicy === 'non_smoking' && (
          <span className="absolute left-0 top-1/2 h-px w-full -rotate-45 bg-closed-ink" />
        )}
      </span>,
    ]);
  if (card.connectedRoomUnitId) flags.push(['Connected room', <LinkSimple key="conn" size={13} />]);

  return (
    <div
      data-room-id={card.unitId}
      className="room-tile-wrap group relative"
      style={{
        animationDelay: `${Math.min(index, 12) * 25}ms`,
        viewTransitionName: `room-${card.unitId}`,
      }}
      onContextMenu={(event) => {
        if (!onQuickStatus) return;
        event.preventDefault();
        setQuickOpen(true);
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={summary}
        className={cn(
          'rv-tile',
          card.cleaningTask?.rush && 'room-rush',
          statusPulse && 'room-status-ripple',
        )}
        data-compact={compact || undefined}
        data-selected={selected || undefined}
        data-dimmed={dimmed || undefined}
        data-faded={
          (maintenanceOverlay && card.openWorkOrders === 0 && !card.blockReason) || undefined
        }
        data-rush={card.cleaningTask?.rush || undefined}
      >
        <span className="rv-tile-head">
          <span className="rv-code font-mono">{card.code}</span>
          <span className="rv-type">
            {card.displayName && <span className="rv-name">{card.displayName}</span>}
            {!compact || !card.displayName ? card.roomName : null}
          </span>
          {card.vip && (
            <Tooltip label="VIP guest">
              <span role="img" aria-label="VIP guest" className="rv-vip">
                <Crown size={13} weight="fill" aria-hidden />
              </span>
            </Tooltip>
          )}
          <Tooltip label={`${hk.label} — ${hk.hint}`}>
            <span className={cn('rv-hk', HK_TONE[card.housekeeping])}>
              <Hk
                size={12}
                weight={card.housekeeping === 'clean' ? 'regular' : 'bold'}
                aria-hidden
              />
              {!compact && hk.label}
            </span>
          </Tooltip>
        </span>

        {/* Tonight's stay, drawn exactly as the Stay View draws it. */}
        <span
          className="sv-bar rv-band"
          data-state={band.state}
          data-kind={band.state === 'out_of_service' ? 'block' : 'booking'}
          data-slant-start={band.slantStart}
          data-slant-end={band.slantEnd}
          // No continuation fade here: the square end already says the stay runs on, and on a
          // tile the fade would sit under the guest's name.
          data-arrival
          data-departure
        >
          <span className="sv-bar-shape" />
          <span className="sv-bar-content">
            {StateIcon && !compact && <StateIcon size={13} weight="bold" aria-hidden />}
            <span className="sv-bar-name">{stayLabel}</span>
            {pax > 0 && !compact && (
              <span className="sv-bar-meta font-mono tabular-nums">
                <User size={11} weight="bold" aria-hidden />
                {pax}
              </span>
            )}
          </span>
          {(card.balanceDue || card.hasNotes) && (
            <span className="sv-bar-markers">
              {card.balanceDue && (
                <Tooltip label="Payment due: this stay has a balance to collect">
                  <span className="sv-marker" data-marker="payment" />
                </Tooltip>
              )}
              {card.hasNotes && (
                <Tooltip label="Notes on this reservation: open the room to read them">
                  <span className="sv-marker" data-marker="notes" />
                </Tooltip>
              )}
            </span>
          )}
        </span>

        {!compact && (
          <span className="rv-meta">
            {card.bookingId && card.checkin && card.checkout
              ? [
                  stayRange(card.checkin, card.checkout),
                  // "Confirmed reservation" says more than a tile has room for.
                  card.frontDeskLabel.replace(/ reservation$/, '').replace('Dayuse', 'Day use'),
                  card.source && sourceLabel({ source: card.source }),
                ]
                  .filter(Boolean)
                  .join(' · ')
              : card.state === 'OutOfOrder'
                ? card.frontDeskLabel
                : next
                  ? `Next arrival ${next}`
                  : 'No arrival booked'}
          </span>
        )}
        {!compact && (
          <span className="rv-meta">
            {card.cleaningTask?.status === 'in_progress'
              ? 'Cleaning in progress'
              : card.bookingId && next
                ? `Next ${next}`
                : ' '}
          </span>
        )}
        {compact && card.cleaningTask?.status === 'in_progress' && (
          <span className="rv-meta text-info-ink">Cleaning in progress</span>
        )}

        <span className="rv-flags">
          {flags.slice(0, compact ? 4 : flags.length).map(([label, icon]) => (
            <Tooltip key={label} label={label}>
              <span role="img" aria-label={label} className="inline-flex">
                {icon}
              </span>
            </Tooltip>
          ))}
          {compact && flags.length > 4 && (
            <Tooltip
              label={flags
                .slice(4)
                .map(([label]) => label)
                .join(' · ')}
            >
              <span className="font-mono text-[10px] font-semibold text-ink-3">
                +{flags.length - 4}
              </span>
            </Tooltip>
          )}
        </span>
      </button>
      {onQuickStatus && (
        <div className="absolute bottom-2 right-2 z-30">
          <button
            type="button"
            aria-label={`Quick housekeeping for room ${card.code}`}
            aria-expanded={quickOpen}
            onClick={() => setQuickOpen((open) => !open)}
            className="rv-hk-button"
          >
            HK
          </button>
          {quickOpen && (
            <div className="absolute right-0 top-full z-40 mt-1 flex min-w-28 flex-col rounded-lg border border-line bg-surface p-1 shadow-raised">
              {(
                ['dirty', 'clean', ...(canInspect ? ['inspected'] : [])] as HousekeepingState[]
              ).map((status) => {
                const Icon = HK_ICON[status];
                return (
                  <button
                    key={status}
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
                    onClick={() => {
                      onQuickStatus(status);
                      setQuickOpen(false);
                    }}
                  >
                    <Icon size={13} aria-hidden />
                    {HK_ACTION_LABEL[status]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
