import type { StayBar, StayUnit } from '@/lib/api';

/**
 * What the desk may do to a bar on the calendar, and whether a room can take it. These checks
 * only guide the pointer — highlight rooms, explain a refusal before it happens. The server
 * decides every change again under lock, so a stale calendar can never force one through.
 */

export interface Capabilities {
  /** Drag up or down to another room of the same type. */
  moveRoom: boolean;
  /** Drag sideways: the whole stay moves to new dates. */
  shiftDates: boolean;
  /** Drag the right edge: a new departure. */
  resize: boolean;
  /** Why a gesture is not available, in words the desk can act on. */
  why?: string;
}

export function capabilities(
  bar: StayBar,
  ctx: { today: string; canAssign: boolean; canChangeDates: boolean },
): Capabilities {
  const none = (why: string): Capabilities => ({
    moveRoom: false,
    shiftDates: false,
    resize: false,
    why,
  });
  if (bar.kind === 'block') return none('Edit a block from its panel.');
  if (bar.reservationKind === 'inquiry' || bar.reservationKind === 'online_failed')
    return none('An enquiry holds no room. Confirm it first.');
  if (bar.status !== 'Approved' && bar.status !== 'Pending' && bar.status !== 'CheckedIn')
    return none('This stay is closed and cannot change.');
  // The part of a split stay already slept in is history.
  if (bar.status === 'CheckedIn' && bar.to <= ctx.today)
    return none('These nights have been stayed and stay on this room’s record.');

  const split = (bar.segment?.of ?? 1) > 1;
  const inHouse = bar.status === 'CheckedIn';
  const ota = bar.source === 'OTA';
  return {
    moveRoom: ctx.canAssign,
    // A whole-stay date move re-prices every night; an in-house stay can only change departure.
    shiftDates: ctx.canChangeDates && !inHouse && !ota && !split,
    resize: ctx.canChangeDates && !ota && (inHouse || !split),
    why: !ctx.canAssign
      ? 'Your role cannot change rooms.'
      : ota
        ? 'Dates of a channel booking change through the channel.'
        : undefined,
  };
}

/**
 * Can `unit` take `bar` for the nights `[from, to)`? Null when it can; otherwise the reason.
 * An in-house guest only moves from today on, so only the nights from today must be free.
 */
export function destinationIssue(
  bar: StayBar,
  unit: StayUnit,
  opts: { from?: string; to?: string; today?: string } = {},
): string | null {
  let from = opts.from ?? bar.from;
  const to = opts.to ?? bar.to;
  if (bar.status === 'CheckedIn' && opts.today && from < opts.today) from = opts.today;
  if (unit.status !== 'active') return `Room ${unit.code} is out of service.`;
  if (bar.roomId && bar.roomId !== unit.roomId)
    return `Room ${unit.code} is another room type. Change the room type from the reservation.`;
  const clash = unit.bars.find(
    (other) => other.id !== bar.id && other.from < to && from < other.to,
  );
  if (clash)
    return clash.kind === 'block'
      ? `Room ${unit.code} is ${clash.blockKind === 'blocked' ? 'blocked' : 'out of service'} then.`
      : `Room ${unit.code} has ${clash.guestName ?? 'another stay'} then.`;
  return null;
}

/** Is `[from, to)` on this room free of every bar? (For a new reservation or block.) */
export function rangeIsFree(unit: StayUnit, from: string, to: string): boolean {
  return unit.status === 'active' && !unit.bars.some((b) => b.from < to && from < b.to);
}
