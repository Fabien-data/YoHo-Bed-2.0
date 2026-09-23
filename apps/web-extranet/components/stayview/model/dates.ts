/**
 * Date-only arithmetic for the calendar. Every date is an ISO `YYYY-MM-DD` string handled in UTC,
 * so no browser timezone or daylight-saving shift can move a night to another column. "Today"
 * comes from the property (its own timezone), never from the browser's clock.
 */

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Whole nights from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** The nights of a window: `days` dates starting at `from`. */
export function windowDates(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}

export function isIsoDate(value: string | null | undefined): value is string {
  return (
    !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}

/** Today in a timezone, as the calendar's fallback until the server's `today` arrives. */
export function todayIn(timezone = 'UTC'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  }
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);
// Fixed names, not Intl: runtimes disagree ("Sep" vs "Sept"), and a label must not change
// between the server render, the browser and a test.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const weekday = (date: string) => WEEKDAYS[utc(date).getUTCDay()]!;
export const dayOfMonth = (date: string) => utc(date).getUTCDate();
export const monthShort = (date: string) => MONTHS[utc(date).getUTCMonth()]!;
export const isWeekend = (date: string) => [0, 6].includes(utc(date).getUTCDay());

/** "23 Sep" — the compact form used on bars, cards and reviews. */
export function shortDate(date: string): string {
  return `${dayOfMonth(date)} ${monthShort(date)}`;
}

/** "23–26 Sep" or "30 Sep – 2 Oct": a stay's dates, read at a glance. */
export function stayRange(from: string, to: string): string {
  if (monthShort(from) === monthShort(to) && from.slice(0, 4) === to.slice(0, 4))
    return `${dayOfMonth(from)}–${dayOfMonth(to)} ${monthShort(to)}`;
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/** "23 Sep – 6 Oct 2026": the toolbar's window label (the last night shown, not the end). */
export function windowLabel(from: string, days: number): string {
  const last = addDays(from, days - 1);
  const year = last.slice(0, 4);
  return `${stayRange(from, last)} ${year}`;
}

export const nightsLabel = (n: number) => `${n} night${n === 1 ? '' : 's'}`;
