import type { StayBar, StayUnit } from '@/lib/api';

/**
 * What a bar means, as one semantic state. The grid styles each state from tokens in
 * globals.css (`.sv-bar[data-state=…]`) and always pairs the colour with an icon and a label,
 * so no state is told apart by colour alone.
 */
export type StayState =
  | 'inhouse'
  | 'confirmed'
  | 'pending'
  | 'hold'
  | 'tentative'
  | 'checkedout'
  | 'noshow'
  | 'cancelled'
  | 'out_of_service'
  | 'blocked';

export const STATE_META: Record<StayState, { label: string; hint: string }> = {
  inhouse: { label: 'In house', hint: 'Checked in and staying tonight' },
  confirmed: { label: 'Confirmed', hint: 'Booked and confirmed, not yet arrived' },
  pending: { label: 'Pending', hint: 'Awaiting confirmation' },
  hold: { label: 'On hold', hint: 'Rooms held until a release time' },
  tentative: { label: 'Tentative', hint: 'An enquiry: shown, but holding no room' },
  checkedout: { label: 'Checked out', hint: 'The guest has left' },
  noshow: { label: 'No-show', hint: 'The guest did not arrive' },
  cancelled: { label: 'Cancelled', hint: 'No longer holding the room' },
  out_of_service: { label: 'Out of service', hint: 'Maintenance: the room cannot be sold' },
  blocked: { label: 'Blocked', hint: 'Held back from sale (owner use, staff, events)' },
};

/** The order the legend lists states in: the day's work first. */
export const LEGEND_STATES: StayState[] = [
  'inhouse',
  'confirmed',
  'pending',
  'hold',
  'tentative',
  'checkedout',
  'out_of_service',
  'blocked',
];

export function stateOf(bar: StayBar): StayState {
  if (bar.kind === 'block') return bar.blockKind === 'blocked' ? 'blocked' : 'out_of_service';
  // Only an enquiry holds no room. A failed online booking keeps its room, so it sits in the
  // grid like any other unconfirmed stay.
  if (bar.reservationKind === 'inquiry') return 'tentative';
  switch (bar.status) {
    case 'CheckedIn':
      return 'inhouse';
    case 'CheckedOut':
      return 'checkedout';
    case 'NoShow':
      return 'noshow';
    case 'Cancelled':
    case 'Rejected':
      return 'cancelled';
    case 'Pending':
      return bar.holdUntil ? 'hold' : 'pending';
    default:
      return bar.reservationKind === 'hold_confirm' ? 'hold' : 'confirmed';
  }
}

export const stateLabel = (bar: StayBar) => STATE_META[stateOf(bar)].label;

export type Housekeeping = StayUnit['housekeeping'];
export const HK_META: Record<Housekeeping, { label: string; hint: string }> = {
  clean: { label: 'Clean', hint: 'Clean and ready' },
  dirty: { label: 'Dirty', hint: 'Needs cleaning before the next arrival' },
  inspected: { label: 'Inspected', hint: 'Clean and checked by a supervisor' },
  out_of_order: { label: 'Out of order', hint: 'Not usable today' },
};

const SOURCE_LABEL: Record<string, string> = { Extranet: 'Direct', OTA: 'OTA', Backend: 'YoHo' };

/** "Booking.com", "Direct", or the business source's code — secondary, never dominant. */
export function sourceLabel(bar: Pick<StayBar, 'channel' | 'source' | 'sourceCode'>): string {
  if (bar.channel) return bar.channel;
  if (bar.sourceCode) return bar.sourceCode;
  return SOURCE_LABEL[bar.source ?? ''] ?? bar.source ?? '';
}

/** The words a screen reader hears for a bar, and the hover card's first line. */
export function barSummary(bar: StayBar): string {
  if (bar.kind === 'block') return `${STATE_META[stateOf(bar)].label}: ${bar.reason ?? ''}`;
  const parts = [bar.guestName ?? 'Guest', stateLabel(bar)];
  if (bar.reference) parts.push(bar.reference);
  return parts.join(', ');
}
