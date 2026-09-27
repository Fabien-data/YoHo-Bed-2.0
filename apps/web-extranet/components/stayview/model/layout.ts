import type { StayBar, StayRoomType, StayUnit } from '@/lib/api';
import { daysBetween } from './dates';

/**
 * The calendar's geometry, in one place. A column is one night; a stay holds the nights `from`
 * inclusive to `to` exclusive (the departure morning is not a night), and its bar is drawn from
 * arrival midday to departure midday (`barPlacement`). Everything the grid draws, and everything
 * a drag hits, is converted here — no component does date maths.
 */

export type Density = 'comfortable' | 'compact';

/**
 * `inset` is the space above and below a bar inside its row (the payment and notes markers sit
 * on the bar's top edge, so it is never less than their radius). `slant` is how far a
 * reservation's slanted end leans, a third of the bar's height, so every density draws the
 * same angle.
 */
export const METRICS = {
  comfortable: { row: 48, group: 46, label: 196, minCol: 104, inset: 7, slant: 11 },
  compact: { row: 36, group: 40, label: 164, minCol: 88, inset: 6, slant: 8 },
} as const;

/** Clear space between two bars that meet on the same date, in px. */
export const BAR_GAP = 4;

/** Wide enough for a name at four days; any wider only spreads the same content out. */
export const MAX_COL = 196;

/**
 * Fit the window to the space available: every night shares the width, down to a minimum that
 * keeps a one-night stay clickable, after which the grid scrolls sideways instead of shrinking.
 */
export function columnWidth(viewportWidth: number, days: number, density: Density): number {
  const { label, minCol } = METRICS[density];
  if (!viewportWidth || days <= 0) return minCol;
  const fit = Math.floor((viewportWidth - label - 2) / days);
  return Math.max(minCol, Math.min(MAX_COL, fit));
}

export interface BarSpan {
  /** First column the bar covers, 0-based. */
  start: number;
  /** Number of columns covered (at least 1). */
  span: number;
  /** The stay began before the window: the left edge is a continuation, not an arrival. */
  startsBefore: boolean;
  /** The stay goes on after the window: the right edge is a continuation, not a departure. */
  endsAfter: boolean;
}

/**
 * Where a stay sits in a window of `days` nights starting at `windowFrom`, or null when it does
 * not touch the window. A departure exactly at the window's end is a real departure edge.
 */
export function barSpan(
  windowFrom: string,
  days: number,
  bar: Pick<StayBar, 'from' | 'to'>,
): BarSpan | null {
  if (bar.to <= bar.from) return null;
  const startOffset = daysBetween(windowFrom, bar.from);
  const endOffset = daysBetween(windowFrom, bar.to);
  if (endOffset <= 0 || startOffset >= days) return null;
  const start = Math.max(0, startOffset);
  const end = Math.min(days, endOffset);
  return {
    start,
    span: Math.max(1, end - start),
    startsBefore: startOffset < 0,
    endsAfter: endOffset > days,
  };
}

/**
 * Where a bar is DRAWN, as opposed to which nights it holds (`barSpan`). A reservation runs from
 * the middle of its arrival date to the middle of its departure date, as on a hotel wall chart:
 * a one-night stay straddles two date columns, and the guest leaving and the guest arriving on
 * the same date meet in that column's centre. Blocks keep whole nights (midnight to midnight).
 *
 * Dates, nights, billing, range selection and every gesture still work in whole nights; only the
 * drawing moves. Bars, drag previews and resize handles all take their position from here, so a
 * change of geometry can never leave one of them out of line with the others.
 */
export interface BarPlacement extends BarSpan {
  /** A reservation's arrival end: slanted, centred on the arrival date's middle. */
  slantStart: boolean;
  /** A reservation's departure end: slanted, centred on the departure date's middle. */
  slantEnd: boolean;
  /** Pixel adjustments to the column edges (independent of the column width). */
  leftPx: number;
  rightPx: number;
}

export function barPlacement(
  windowFrom: string,
  days: number,
  bar: Pick<StayBar, 'from' | 'to'> & { kind?: StayBar['kind'] },
  slant: number,
): BarPlacement | null {
  if (!barSpan(windowFrom, days, bar)) return null;
  const reservation = bar.kind !== 'block';
  const offset = reservation ? 0.5 : 0;
  const from = daysBetween(windowFrom, bar.from) + offset;
  const to = daysBetween(windowFrom, bar.to) + offset;
  const startsBefore = from < 0;
  const endsAfter = to > days;
  const start = Math.max(0, from);
  const end = Math.min(days, to);
  const slantStart = reservation && !startsBefore;
  const slantEnd = reservation && !endsAfter;
  const half = BAR_GAP / 2;
  return {
    start,
    span: end - start,
    startsBefore,
    endsAfter,
    slantStart,
    slantEnd,
    // A slanted end leans half its slant either side of the midday line, so the departing and
    // the arriving bar share one diagonal with an even gap. A clipped end sits flush on the
    // window's edge, square, so a continuing stay never reads as an arrival or a departure.
    leftPx: startsBefore ? 0 : slantStart ? half - slant / 2 : half,
    rightPx: endsAfter ? 0 : slantEnd ? slant / 2 - half : -half,
  };
}

/** A placement in pixels, for overlays drawn outside the rows (the drag preview). */
export function barRect(p: BarPlacement, colW: number): { left: number; width: number } {
  const left = p.start * colW + p.leftPx;
  return { left, width: (p.start + p.span) * colW + p.rightPx - left };
}

/** The same placement against the grid's `--col-w`, so rows re-lay without re-rendering. */
export function barStyle(p: BarPlacement): { left: string; width: string } {
  return {
    left: `calc(var(--col-w) * ${p.start} + ${p.leftPx}px)`,
    width: `calc(var(--col-w) * ${p.span} + ${p.rightPx - p.leftPx}px)`,
  };
}

/**
 * Pack bars into lines so none overlaps another: first line with room, else a new line. The
 * Unassigned and Tentative lanes hold many stays over the same nights (a five-room group with no
 * room numbers yet is five bars on the same dates); drawn in one line, all but one would hide.
 */
export function stackBars<T extends Pick<StayBar, 'from' | 'to'>>(bars: T[]): T[][] {
  const lines: Array<{ end: string; bars: T[] }> = [];
  for (const bar of [...bars].sort(
    (x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to),
  )) {
    const line = lines.find((l) => l.end <= bar.from);
    if (line) {
      line.bars.push(bar);
      line.end = bar.to;
    } else lines.push({ end: bar.to, bars: [bar] });
  }
  return lines.map((l) => l.bars);
}

/** Which night a pointer is over, from its x offset inside a room strip. */
export function dayAt(offsetX: number, colW: number, days: number): number {
  return Math.max(0, Math.min(days - 1, Math.floor(offsetX / colW)));
}

export interface RoomGroup {
  key: string;
  name: string;
  /** The sellable room type, when grouped by category (drives the availability line). */
  roomType?: StayRoomType;
  units: StayUnit[];
}

/** Rooms grouped by category (the booked room type) or by floor, in the hotel's own order. */
export function groupRooms(roomTypes: StayRoomType[], by: 'category' | 'floor'): RoomGroup[] {
  if (by === 'category')
    return roomTypes.map((rt) => ({
      key: rt.roomId,
      name: rt.name,
      roomType: rt,
      units: rt.units,
    }));
  const floors = new Map<string, RoomGroup>();
  for (const rt of roomTypes)
    for (const unit of rt.units) {
      const floor = unit.floor?.trim() || '';
      const key = `floor:${floor || 'none'}`;
      let group = floors.get(key);
      if (!group) {
        group = { key, name: floor ? `Floor ${floor}` : 'No floor set', units: [] };
        floors.set(key, group);
      }
      group.units.push(unit);
    }
  return [...floors.values()].sort((a, b) =>
    a.key === 'floor:none'
      ? 1
      : b.key === 'floor:none'
        ? -1
        : a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/** How much a bar can say at its width — progressive disclosure, never overflow. */
export type BarTier = 'icon' | 'name' | 'status' | 'detail' | 'full';
export function barTier(widthPx: number): BarTier {
  if (widthPx < 40) return 'icon';
  if (widthPx < 104) return 'name';
  if (widthPx < 168) return 'status';
  if (widthPx < 252) return 'detail';
  return 'full';
}
