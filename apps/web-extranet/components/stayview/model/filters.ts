import type { StayBar, StayUnit } from '@/lib/api';
import {
  HK_META,
  STATE_META,
  sourceLabel,
  stateOf,
  type Housekeeping,
  type StayState,
} from './status';

/**
 * Two kinds of filter, deliberately different:
 * - reservation filters (status, source, activity, balance) DIM the bars that don't match, so
 *   the desk keeps the context of the rest of the house;
 * - room filters (category, floor, housekeeping, the room-status chips) HIDE rooms, because a
 *   shorter list is the point of asking for "vacant" or "floor 2".
 */
export interface CalendarFilters {
  state: StayState | '';
  source: string;
  activity: '' | 'arrivals' | 'departures' | 'inhouse';
  balance: boolean;
  category: string;
  floor: string;
  housekeeping: Housekeeping | '';
}

export const EMPTY_FILTERS: CalendarFilters = {
  state: '',
  source: '',
  activity: '',
  balance: false,
  category: '',
  floor: '',
  housekeeping: '',
};

export const hasBarFilters = (f: CalendarFilters) =>
  !!(f.state || f.source || f.activity || f.balance);

/** Does a bar survive the reservation filters, judged on `date` (the day the chips describe)? */
export function matchesBar(bar: StayBar, f: CalendarFilters, date: string): boolean {
  if (!hasBarFilters(f)) return true;
  if (bar.kind === 'block') return !f.state || f.state === stateOf(bar);
  if (f.state && stateOf(bar) !== f.state) return false;
  if (f.source && sourceLabel(bar) !== f.source) return false;
  if (f.balance && !bar.balanceDue) return false;
  if (f.activity === 'arrivals' && bar.from !== date) return false;
  if (f.activity === 'departures' && bar.to !== date) return false;
  if (f.activity === 'inhouse' && bar.status !== 'CheckedIn') return false;
  return true;
}

/** Does a room survive the room filters? */
export function unitVisible(unit: StayUnit, f: CalendarFilters): boolean {
  if (f.category && unit.roomId !== f.category) return false;
  if (f.floor && (unit.floor ?? '') !== f.floor) return false;
  if (f.housekeeping && unit.housekeeping !== f.housekeeping) return false;
  return true;
}

/** The counted room-status chips (Yanolja parity), judged on `date`. */
export type RoomChip = 'all' | 'vacant' | 'occupied' | 'reserved' | 'blocked' | 'dueOut';
export function roomChipMatches(unit: StayUnit, chip: RoomChip, date: string): boolean {
  if (chip === 'all') return true;
  const on = unit.bars.filter((b) => b.from <= date && date < b.to);
  switch (chip) {
    case 'vacant':
      return on.length === 0 && unit.status === 'active';
    case 'occupied':
      return on.some((b) => b.status === 'CheckedIn');
    case 'reserved':
      return on.some(
        (b) => b.kind === 'booking' && (b.status === 'Approved' || b.status === 'Pending'),
      );
    case 'blocked':
      return on.some((b) => b.kind === 'block') || unit.status !== 'active';
    case 'dueOut':
      return unit.bars.some(
        (b) => b.kind === 'booking' && b.status === 'CheckedIn' && b.to === date,
      );
  }
}

const ACTIVITY_LABEL: Record<Exclude<CalendarFilters['activity'], ''>, string> = {
  arrivals: 'Arriving',
  departures: 'Departing',
  inhouse: 'In house',
};
export const ACTIVITY_OPTIONS = Object.entries(ACTIVITY_LABEL) as Array<
  [Exclude<CalendarFilters['activity'], ''>, string]
>;

export interface FilterChip {
  key: keyof CalendarFilters;
  label: string;
}

/** Plain-language chips for the active filters: "Confirmed", "Booking.com", "Deluxe". */
export function filterChips(
  f: CalendarFilters,
  names: { category: (id: string) => string | undefined },
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.state) chips.push({ key: 'state', label: STATE_META[f.state].label });
  if (f.source) chips.push({ key: 'source', label: f.source });
  if (f.activity) chips.push({ key: 'activity', label: ACTIVITY_LABEL[f.activity] });
  if (f.balance) chips.push({ key: 'balance', label: 'Balance due' });
  if (f.category) chips.push({ key: 'category', label: names.category(f.category) ?? 'Category' });
  if (f.floor) chips.push({ key: 'floor', label: `Floor ${f.floor}` });
  if (f.housekeeping) chips.push({ key: 'housekeeping', label: HK_META[f.housekeeping].label });
  return chips;
}

export function clearFilter(f: CalendarFilters, key: keyof CalendarFilters): CalendarFilters {
  return { ...f, [key]: EMPTY_FILTERS[key] };
}
