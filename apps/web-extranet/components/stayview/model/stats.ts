import type { StayBar, StayView } from '@/lib/api';

/**
 * The numbers under each date: how full the house is and what the day holds. Derived from the
 * window already loaded, so they cost no request and always agree with the bars on screen.
 */
export interface DayStats {
  date: string;
  occupancyPct: number;
  available: number;
  arrivals: number;
  departures: number;
  unassigned: number;
}

/** Reservation legs only (not blocks, not enquiries holding nothing). */
function heldBars(data: StayView): StayBar[] {
  return [
    ...data.roomTypes.flatMap((rt) => rt.units.flatMap((u) => u.bars)),
    ...data.unassigned,
  ].filter((b) => b.kind === 'booking');
}

export function dayStats(data: StayView): DayStats[] {
  const bars = heldBars(data);
  // A stay moved mid-way is one arrival and one departure, not one per room segment.
  const firstSegment = (b: StayBar) => (b.segment?.index ?? 0) === 0;
  const lastSegment = (b: StayBar) => (b.segment?.index ?? 0) === (b.segment?.of ?? 1) - 1;
  const footer = new Map(data.footer.map((f) => [f.date, f]));
  return data.dates.map((date) => {
    const f = footer.get(date);
    return {
      date,
      occupancyPct: f?.occupancyPct ?? 0,
      available: f?.availableInventory ?? 0,
      arrivals: bars.filter((b) => b.from === date && firstSegment(b)).length,
      departures: bars.filter((b) => b.to === date && lastSegment(b)).length,
      unassigned: data.unassigned.filter((b) => b.from <= date && date < b.to).length,
    };
  });
}

/** Rooms of a type still free on a date, from the rooms themselves (blocks and stays counted). */
export function freeUnitsOn(units: StayView['roomTypes'][number]['units'], date: string): number {
  return units.filter(
    (u) => u.status === 'active' && !u.bars.some((b) => b.from <= date && date < b.to),
  ).length;
}
