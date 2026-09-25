import type { TagColor } from './palette';

/**
 * Reservation kinds — Yanolja's "Reservation Type", fixed in code.
 *
 * A kind is a separate axis from the booking's lifecycle status. The status (Pending, Approved,
 * CheckedIn…) says where the stay is in its life; the kind says what sort of commitment it is.
 *
 * The behaviour of each kind is NOT configurable. Only the label and colour can be changed per
 * property. A hotel-editable "deducts inventory" flag would be an overbooking switch, and
 * whether a booking holds a room is the single most important fact in the system.
 *
 * Behaviour, following eZee/Yanolja (research of 2026-09-17):
 * - Holds block inventory until a release date and time. On release they become "Released".
 *   A hold with no release time is never auto-released. Checking in a hold confirms it.
 * - An inquiry does not hold a room.
 * - An online-failed booking was made on a travel website or booking engine but did not come
 *   through properly (the payment failed, the channel message broke). The guest believes they
 *   have booked, so the room is kept for them — it holds inventory like a confirmed stay — while
 *   the desk sorts it out and confirms or cancels it (owner brief, 2026-09-26).
 */
export const RESERVATION_KINDS = [
  'confirm',
  'inquiry',
  'online_failed',
  'hold_confirm',
  'hold_unconfirm',
] as const;
export type ReservationKind = (typeof RESERVATION_KINDS)[number];

export interface ReservationKindMeta {
  kind: ReservationKind;
  /** Yanolja's label on the full Add Reservation page. */
  label: string;
  /** Yanolja's short label on the Quick Reservation panel. */
  shortLabel: string;
  /** Whether a booking of this kind takes rooms out of inventory. */
  holdsInventory: boolean;
  /** Whether a release date and time is required. */
  isHold: boolean;
  /** The lifecycle status a new booking of this kind starts in. */
  initialStatus: 'Approved' | 'Pending';
  /** Default colour; a property may override it. */
  color: TagColor;
  /** Offered on the Quick Reservation panel (Yanolja offers Confirm / Inquiry / Hold there). */
  quick: boolean;
}

export const RESERVATION_KIND_META: Record<ReservationKind, ReservationKindMeta> = {
  confirm: {
    kind: 'confirm',
    label: 'Confirm Booking',
    shortLabel: 'Confirm',
    holdsInventory: true,
    isHold: false,
    initialStatus: 'Approved',
    color: 'green',
    quick: true,
  },
  inquiry: {
    kind: 'inquiry',
    label: 'Unconfirmed Booking Inquiry',
    shortLabel: 'Inquiry',
    holdsInventory: false,
    isHold: false,
    initialStatus: 'Pending',
    color: 'sky',
    quick: true,
  },
  online_failed: {
    kind: 'online_failed',
    label: 'Online Failed Booking',
    shortLabel: 'Failed',
    holdsInventory: true,
    isHold: false,
    initialStatus: 'Pending',
    color: 'red',
    quick: false,
  },
  hold_confirm: {
    kind: 'hold_confirm',
    label: 'Hold Confirm Booking',
    // The Quick panel's single "Hold" choice is a confirmed hold.
    shortLabel: 'Hold',
    holdsInventory: true,
    isHold: true,
    initialStatus: 'Approved',
    color: 'amber',
    quick: true,
  },
  hold_unconfirm: {
    kind: 'hold_unconfirm',
    label: 'Hold Unconfirm Booking',
    shortLabel: 'Hold (unconfirmed)',
    holdsInventory: true,
    isHold: true,
    initialStatus: 'Pending',
    color: 'orange',
    quick: false,
  },
};

export function isReservationKind(v: unknown): v is ReservationKind {
  return typeof v === 'string' && (RESERVATION_KINDS as readonly string[]).includes(v);
}

/**
 * The kind a booking becomes when an unconfirmed booking is approved. An unconfirmed hold with a
 * release time stays a hold (now a confirmed one); everything else becomes a plain confirmation.
 */
export function kindAfterApproval(kind: ReservationKind, hasReleaseTime: boolean): ReservationKind {
  if (kind === 'hold_unconfirm') return hasReleaseTime ? 'hold_confirm' : 'confirm';
  if (kind === 'inquiry' || kind === 'online_failed') return 'confirm';
  return kind;
}

/**
 * The kinds a booking may be put on hold from, and the hold it can become. A confirmed booking can
 * only become a confirmed hold — putting it on hold must never quietly un-confirm it.
 */
export function holdKindFor(
  current: ReservationKind,
  requested: 'hold_confirm' | 'hold_unconfirm' | undefined,
): 'hold_confirm' | 'hold_unconfirm' | null {
  const confirmed = current === 'confirm' || current === 'hold_confirm';
  if (confirmed) return requested === 'hold_unconfirm' ? null : 'hold_confirm';
  return requested ?? 'hold_unconfirm';
}

/** Label and colour after applying a property's overrides. */
export function resolveKindDisplay(
  kind: ReservationKind,
  overrides?: Partial<Record<ReservationKind, { label?: string; color?: TagColor }>> | null,
): { label: string; shortLabel: string; color: TagColor } {
  const meta = RESERVATION_KIND_META[kind];
  const o = overrides?.[kind];
  return {
    label: o?.label?.trim() || meta.label,
    shortLabel: o?.label?.trim() || meta.shortLabel,
    color: o?.color ?? meta.color,
  };
}
