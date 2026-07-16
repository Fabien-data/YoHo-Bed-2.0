/** Shared display + date helpers for the extranet (all dates are UTC 'YYYY-MM-DD'). */

/** Full LKR money: "Rs 24,390.24". */
export function money(v?: string | number | null): string {
  if (v === undefined || v === null || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return '—';
  return 'Rs ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Compact LKR for tight grid cells: "Rs 24,390" (no decimals). */
export function moneyShort(v?: string | number | null): string {
  if (v === undefined || v === null || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (Number.isNaN(n)) return '—';
  return 'Rs ' + Math.round(n).toLocaleString('en-US');
}

export function dow(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'UTC',
  });
}
export function dom(d: string): number {
  return new Date(`${d}T00:00:00Z`).getUTCDate();
}
export function monthLabel(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
}
export function longDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export function isWeekend(d: string): boolean {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
export function addDays(d: string, n: number): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export function dateWindow(from: string, days: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) out.push(addDays(from, i));
  return out;
}

/** The first day of the month a date falls in, as 'YYYY-MM-01'. */
export function firstOfMonth(d: string): string {
  return d.slice(0, 7) + '-01';
}
/** Every date in the month, given its first day. */
export function monthDays(first: string): string[] {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7)); // 1..12
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
  const ym = first.slice(0, 7);
  const out: string[] = [];
  for (let i = 1; i <= count; i++) out.push(`${ym}-${String(i).padStart(2, '0')}`);
  return out;
}
/** Shift a first-of-month date by n months (returns the 1st of the target month). */
export function addMonths(first: string, n: number): string {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7)) - 1; // 0..11
  return new Date(Date.UTC(y, m + n, 1)).toISOString().slice(0, 10);
}
export function monthYear(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export function isMonday(d: string): boolean {
  return new Date(`${d}T00:00:00Z`).getUTCDay() === 1;
}
