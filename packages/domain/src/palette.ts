/**
 * The fixed categorical palette for things a hotel colours by hand — business sources, market
 * segments, reservation types.
 *
 * Yanolja moved from a free-form colour picker to a fixed set of predefined colours (June 2026
 * StayView redesign), and so do we: a free hex value can be unreadable in one theme and invisible
 * in the other. Each key resolves to three CSS tokens per theme (`--tag-<key>`, `-soft`, `-ink`),
 * so a source chip or a Stay View bar stays legible in light and dark alike.
 */
export const TAG_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'pink',
  'rose',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(v: unknown): v is TagColor {
  return typeof v === 'string' && (TAG_COLORS as readonly string[]).includes(v);
}
