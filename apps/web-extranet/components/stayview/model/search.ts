import type { StayBar, StayUnit } from '@/lib/api';

/** Case- and accent-insensitive, so "jose" finds "José". */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase();
}

export function barMatches(bar: StayBar, term: string): boolean {
  if (!term) return true;
  const needle = fold(term);
  return [bar.guestName, bar.reference, bar.groupCode, bar.reason]
    .filter(Boolean)
    .some((v) => fold(v!).includes(needle));
}

export function unitMatches(unit: StayUnit, term: string): boolean {
  if (!term) return true;
  const needle = fold(term);
  return [unit.code, unit.displayName].filter(Boolean).some((v) => fold(v!).includes(needle));
}

export type LocalHit =
  | { kind: 'stay'; key: string; bar: StayBar; unit: StayUnit | null }
  | { kind: 'room'; key: string; unit: StayUnit };

/**
 * Matches inside the loaded window, best first: stays whose guest name starts with the term,
 * then any stay, then rooms. One hit per reservation — a stay split across two rooms is found
 * once, at the segment that is on screen first.
 */
export function searchWindow(
  units: StayUnit[],
  lanes: StayBar[],
  term: string,
  limit = 8,
): LocalHit[] {
  const needle = fold(term.trim());
  if (needle.length < 2) return [];
  const seen = new Set<string>();
  const stays: Array<{ hit: LocalHit; rank: number }> = [];
  const visit = (bar: StayBar, unit: StayUnit | null) => {
    if (bar.kind !== 'booking' || !barMatches(bar, needle)) return;
    const key = bar.bookingId ?? bar.id;
    if (seen.has(key)) return;
    seen.add(key);
    const rank = fold(bar.guestName ?? '').startsWith(needle) ? 0 : 1;
    stays.push({ hit: { kind: 'stay', key, bar, unit }, rank });
  };
  for (const unit of units) for (const bar of unit.bars) visit(bar, unit);
  for (const bar of lanes) visit(bar, null);
  const rooms: LocalHit[] = units
    .filter((u) => unitMatches(u, needle))
    .map((unit) => ({ kind: 'room', key: `room:${unit.id}`, unit }));
  return [
    ...stays
      .sort((a, b) => a.rank - b.rank || a.hit.key.localeCompare(b.hit.key))
      .map((s) => s.hit),
    ...rooms,
  ].slice(0, limit);
}
