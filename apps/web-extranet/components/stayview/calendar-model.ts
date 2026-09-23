import type { StayBar, StayUnit, StayView } from '@/lib/api';

export const DAY_WIDTH = 92;
export const LABEL_WIDTH = 200;
export const DAY_WINDOWS = [4, 7, 14, 21, 28, 30] as const;
export const SOURCE_LABEL: Record<string, string> = {
  Extranet: 'Direct',
  OTA: 'OTA',
  Backend: 'YoHo',
};
export const STATUS: Record<string, { label: string; tone: string }> = {
  Approved: { label: 'Confirmed', tone: 'bg-brand text-white' },
  Pending: { label: 'Pending', tone: 'bg-low text-white' },
  CheckedIn: { label: 'In house', tone: 'bg-avail text-white' },
  CheckedOut: { label: 'Checked out', tone: 'bg-ink-3 text-white' },
  Cancelled: { label: 'Cancelled', tone: 'bg-closed text-white' },
  NoShow: { label: 'No show', tone: 'bg-closed text-white' },
};
export const HK_LABEL = {
  clean: 'Clean',
  dirty: 'Dirty',
  inspected: 'Inspected',
  out_of_order: 'Out of service',
};
export function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
export function propertyToday(timezone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
}
export function geometry(dates: string[], bar: Pick<StayBar, 'from' | 'to'>) {
  if (!dates.length) return null;
  const end = addDays(dates[dates.length - 1]!, 1);
  if (bar.to <= dates[0]! || bar.from >= end || bar.to <= bar.from) return null;
  const startIndex = Math.max(0, daysBetween(dates[0]!, bar.from));
  const endIndex = Math.min(dates.length, daysBetween(dates[0]!, bar.to));
  return {
    left: startIndex * DAY_WIDTH,
    width: (endIndex - startIndex) * DAY_WIDTH - 4,
    startsBefore: bar.from < dates[0]!,
    endsAfter: bar.to > end,
  };
}
export interface CalendarFilters {
  status: string;
  source: string;
  category: string;
  floor: string;
  housekeeping: string;
  activity: string;
  balance: boolean;
}
export const EMPTY_FILTERS: CalendarFilters = {
  status: '',
  source: '',
  category: '',
  floor: '',
  housekeeping: '',
  activity: '',
  balance: false,
};
export function matchesBar(bar: StayBar, filters: CalendarFilters, date: string) {
  return (
    (!filters.status || bar.status === filters.status) &&
    (!filters.source || (bar.channel ?? bar.source) === filters.source) &&
    (!filters.balance || bar.balanceDue === true) &&
    (!filters.activity ||
      (filters.activity === 'arrivals'
        ? bar.from === date
        : filters.activity === 'departures'
          ? bar.to === date
          : bar.status === 'CheckedIn'))
  );
}
export function calendarBars(data: StayView) {
  return [
    ...data.roomTypes.flatMap((group) => group.units.flatMap((unit) => unit.bars)),
    ...data.unassigned,
    ...(data.tentative ?? []),
  ];
}
export function destinationIssue(bar: StayBar, unit: StayUnit, from = bar.from, to = bar.to) {
  if (unit.status !== 'active') return 'This room is out of service.';
  if (bar.roomId && bar.roomId !== unit.roomId)
    return 'Choose a room in the booked category. Category changes use Edit reservation.';
  if (unit.bars.some((other) => other.id !== bar.id && other.from < to && from < other.to))
    return 'This room has an overlapping reservation or block.';
  return null;
}
export interface CalendarPreferences {
  days: number;
  density: 'compact' | 'comfortable';
  groupBy: 'category' | 'floor';
  statistics: boolean;
  housekeeping: boolean;
  metadata: boolean;
  sources: boolean;
  legend: boolean;
  shortcuts: boolean;
  dragHints: boolean;
  snap: boolean;
  widePanel: boolean;
}
export const DEFAULT_PREFERENCES: CalendarPreferences = {
  days: 14,
  density: 'comfortable',
  groupBy: 'category',
  statistics: true,
  housekeeping: true,
  metadata: true,
  sources: true,
  legend: false,
  shortcuts: true,
  dragHints: true,
  snap: true,
  widePanel: false,
};
export function parsePreferences(value: unknown): CalendarPreferences {
  const result = { ...DEFAULT_PREFERENCES };
  if (!value || typeof value !== 'object') return result;
  const candidate = value as Record<string, unknown>;
  for (const key of Object.keys(result) as (keyof CalendarPreferences)[]) {
    if (typeof result[key] === 'boolean' && typeof candidate[key] === 'boolean')
      Object.assign(result, { [key]: candidate[key] });
  }
  if (DAY_WINDOWS.includes(candidate.days as (typeof DAY_WINDOWS)[number]))
    result.days = Number(candidate.days);
  if (candidate.density === 'compact') result.density = 'compact';
  if (candidate.groupBy === 'floor') result.groupBy = 'floor';
  return result;
}
