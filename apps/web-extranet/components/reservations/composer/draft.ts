import type { StayRange, PhoneValue } from '@yohobed/ui';
import type {
  CreateReservationInput,
  PriceApproval,
  ReservationStayInput,
  RoomAvailability,
} from '@/lib/api';

/**
 * The Quick Reservation's working state (Development Phase 02), and how it becomes an API body.
 * Kept free of React so the rules — which lines are complete, what a typed rate means — are
 * plain functions.
 */

export type QuickKind = 'confirm' | 'inquiry' | 'hold_confirm';

export interface LineDraft {
  /** Stable React key; lines are added and removed in place. */
  key: string;
  roomId: string | null;
  occupancyId: string | null;
  /** A chosen room; '' = assign later. */
  roomUnitId: string;
  adults: number;
  children: number;
  childAges?: number[];
  extraBeds?: number;
  cots?: number;
  minimumExceptionReason?: string;
  /** A typed stay total, tax-inclusive, as the desk typed it. '' = the rate calendar's price. */
  rate: string;
}

export interface GuestDraft {
  /** Set when a returning guest was picked; the fields below then just echo their profile. */
  customerId: string | null;
  title: string;
  name: string;
  phone: PhoneValue;
  email: string;
  whatsapp: boolean;
  /** Save as a new guest although one with this email/mobile exists. */
  createNew: boolean;
}

export interface Draft {
  stay: StayRange;
  kind: QuickKind;
  /** A hold's release, as the desk sees it: local date + time. */
  holdDate: string;
  holdTime: string;
  businessSourceId: string | null;
  lines: LineDraft[];
  guest: GuestDraft;
  couponCode: string;
  referralCode: string;
  priceReason: string;
  approvals: Partial<Record<PriceApproval, string>>;
}

export interface Prefill {
  kind?: QuickKind;
  checkin?: string;
  nights?: number;
  roomId?: string;
  roomUnitId?: string;
}

let seq = 0;
export function newLineKey() {
  seq += 1;
  return `line-${Date.now().toString(36)}-${seq}`;
}

export function emptyLine(from?: LineDraft): LineDraft {
  return {
    key: newLineKey(),
    roomId: from?.roomId ?? null,
    occupancyId: from?.occupancyId ?? null,
    roomUnitId: '',
    adults: from?.adults ?? 2,
    children: from?.children ?? 0,
    childAges: [...(from?.childAges ?? [])],
    extraBeds: from?.extraBeds ?? 0,
    cots: from?.cots ?? 0,
    rate: '',
  };
}

/** A line is ready to price once it has a room type and a rate type. */
export function isComplete(l: LineDraft) {
  return Boolean(l.roomId && l.occupancyId);
}

/** A typed rate, when the desk typed one that parses. */
export function typedRate(l: LineDraft): number | null {
  const n = Number(l.rate.replace(/,/g, '').trim());
  return l.rate.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** The local date and time a hold releases, as an ISO instant. */
export function holdInstant(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

/** Everything that decides the price — the quote's body. Null until every line is complete. */
export function stayBody(propertyId: string, d: Draft): ReservationStayInput | null {
  if (d.lines.length === 0 || !d.lines.every(isComplete)) return null;
  return {
    propertyId,
    checkin: d.stay.checkin,
    checkout: d.stay.checkout,
    arrivalTime: d.stay.checkinTime,
    departureTime: d.stay.checkoutTime,
    kind: d.kind,
    ...(d.kind === 'hold_confirm' && d.holdDate && d.holdTime
      ? { holdUntil: holdInstant(d.holdDate, d.holdTime) }
      : {}),
    ...(d.businessSourceId ? { businessSourceId: d.businessSourceId } : {}),
    ...(d.couponCode.trim() ? { couponCode: d.couponCode.trim().toUpperCase() } : {}),
    ...(d.referralCode.trim() ? { referralCode: d.referralCode.trim().toUpperCase() } : {}),
    ...(d.priceReason.trim() ? { priceReason: d.priceReason.trim() } : {}),
    ...(Object.keys(d.approvals).length ? { approvals: d.approvals } : {}),
    lines: d.lines.map((l) => {
      const rate = typedRate(l);
      return {
        roomId: l.roomId!,
        occupancyId: l.occupancyId!,
        ...(l.roomUnitId ? { roomUnitId: l.roomUnitId } : {}),
        adults: l.adults,
        children: l.children,
        childAges: (l.childAges ?? []).slice(0, l.children),
        extraBeds: l.extraBeds ?? 0,
        cots: l.cots ?? 0,
        ...(l.minimumExceptionReason?.trim()
          ? { minimumExceptionReason: l.minimumExceptionReason.trim() }
          : {}),
        ...(rate !== null ? { rate: { mode: 'total' as const, amount: rate } } : {}),
      };
    }),
  };
}

/** The full reservation body. */
export function createBody(
  propertyId: string,
  d: Draft,
  expectedTotal?: number,
): CreateReservationInput | null {
  const stay = stayBody(propertyId, d);
  if (!stay) return null;
  const g = d.guest;
  return {
    ...stay,
    guest: g.customerId
      ? { customerId: g.customerId }
      : {
          name: g.name.trim(),
          ...(g.title ? { title: g.title } : {}),
          ...(g.email.trim() ? { email: g.email.trim() } : {}),
          ...(g.phone.number.trim() ? { phone: g.phone.number.trim(), whatsapp: g.whatsapp } : {}),
          ...(g.createNew ? { createNew: true } : {}),
        },
    ...(expectedTotal !== undefined ? { expectedTotal } : {}),
  };
}

/** Rooms of a type still free for this line, after the other lines of the form took theirs. */
export function freeFor(
  grid: RoomAvailability | undefined,
  lines: LineDraft[],
  index: number,
  roomId: string,
): number {
  const rt = grid?.roomTypes.find((r) => r.roomId === roomId);
  if (!rt) return 0;
  const taken = lines.filter((l, i) => i !== index && l.roomId === roomId).length;
  return Math.max(0, rt.free - taken);
}
