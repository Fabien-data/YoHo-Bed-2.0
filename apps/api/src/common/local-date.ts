/**
 * Today as 'YYYY-MM-DD' in a property's own timezone.
 *
 * `new Date().toISOString()` is UTC — for an Asia/Colombo (UTC+5:30) property that is *yesterday*
 * between 00:00 and 05:30 local, which is exactly the night-audit window. Business dates, posting
 * defaults and anything else that means "the hotel's today" must go through this instead.
 */
export function localToday(timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'UTC' }).format(new Date());
  } catch {
    // An invalid stored timezone must not take the endpoint down; UTC is the least-wrong fallback.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
  }
}
