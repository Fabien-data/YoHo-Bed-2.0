import type { Density } from './layout';

/**
 * Each person's calendar, remembered on this browser for their user and this property (owner
 * decision 2026-09-23). A garbled or older stored value never breaks the screen: anything
 * unrecognised falls back to the default for that one setting.
 */
export const DAY_WINDOWS = [4, 7, 14, 21, 30] as const;
export type DayWindow = (typeof DAY_WINDOWS)[number];

export interface CalendarPreferences {
  // Appearance
  days: DayWindow;
  density: Density;
  groupBy: 'category' | 'floor';
  colorBy: 'status' | 'source';
  panelWidth: 'normal' | 'wide';
  // Display
  headerStats: boolean;
  availability: boolean;
  housekeeping: boolean;
  barDetails: boolean;
  sources: boolean;
  // Behaviour
  selectionActions: boolean;
  dragWarnings: boolean;
  snapToNights: boolean;
  shortcuts: boolean;
}

export const DEFAULT_PREFERENCES: CalendarPreferences = {
  days: 14,
  density: 'comfortable',
  groupBy: 'category',
  colorBy: 'status',
  panelWidth: 'normal',
  headerStats: true,
  availability: true,
  housekeeping: true,
  barDetails: true,
  sources: true,
  selectionActions: true,
  dragWarnings: true,
  snapToNights: true,
  shortcuts: true,
};

const BOOLEAN_KEYS = (Object.keys(DEFAULT_PREFERENCES) as Array<keyof CalendarPreferences>).filter(
  (k) => typeof DEFAULT_PREFERENCES[k] === 'boolean',
);

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export function parsePreferences(value: unknown): CalendarPreferences {
  const result: CalendarPreferences = { ...DEFAULT_PREFERENCES };
  if (!value || typeof value !== 'object') return result;
  const v = value as Record<string, unknown>;
  for (const key of BOOLEAN_KEYS)
    if (typeof v[key] === 'boolean') Object.assign(result, { [key]: v[key] });
  // Settings saved by the first calendar release (v1) under older names.
  if (typeof v.statistics === 'boolean' && v.headerStats === undefined)
    result.headerStats = v.statistics;
  if (typeof v.metadata === 'boolean' && v.barDetails === undefined) result.barDetails = v.metadata;
  if (typeof v.dragHints === 'boolean' && v.dragWarnings === undefined)
    result.dragWarnings = v.dragHints;
  if (v.widePanel === true && v.panelWidth === undefined) result.panelWidth = 'wide';
  result.days = DAY_WINDOWS.includes(v.days as DayWindow)
    ? (v.days as DayWindow)
    : v.days === 28
      ? 30
      : DEFAULT_PREFERENCES.days;
  result.density = oneOf(v.density, ['comfortable', 'compact'], result.density);
  result.groupBy = oneOf(v.groupBy, ['category', 'floor'], result.groupBy);
  result.colorBy = oneOf(v.colorBy, ['status', 'source'], result.colorBy);
  result.panelWidth = oneOf(v.panelWidth, ['normal', 'wide'], result.panelWidth);
  return result;
}

/** Where a person's settings live: per user, per property, versioned. */
export const preferencesKey = (userId: string, propertyId: string) =>
  `yoho-calendar:v2:${userId}:${propertyId}`;
export const legacyPreferencesKey = (userId: string, propertyId: string) =>
  `yoho-calendar:v1:${userId}:${propertyId}`;
