import { asc, eq } from 'drizzle-orm';
import { businessDates, properties, type Tx } from '@yohobed/db';

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

/**
 * The calendar today of a property — or, when no property is named, of the tenant's oldest one
 * (the tenant-wide screens have no better anchor). Must run inside a tenant transaction.
 */
export async function propertyToday(tx: Tx, propertyId?: string | null): Promise<string> {
  const q = tx.select({ timezone: properties.timezone }).from(properties);
  const [p] = await (propertyId
    ? q.where(eq(properties.id, propertyId))
    : q.orderBy(asc(properties.createdAt)).limit(1));
  return localToday(p?.timezone);
}

/**
 * The hotel's operating date: the night-audit business date when the property runs night audit,
 * otherwise its calendar today. Read-only — it never creates the business-date row (only night
 * audit does), so a Starter property simply follows the calendar.
 */
export async function propertyBusinessDate(
  tx: Tx,
  propertyId: string,
  timezone: string | null | undefined,
): Promise<{ date: string; source: 'night_audit' | 'calendar' }> {
  const [bd] = await tx
    .select({ currentDate: businessDates.currentDate })
    .from(businessDates)
    .where(eq(businessDates.propertyId, propertyId));
  if (bd) return { date: bd.currentDate, source: 'night_audit' };
  return { date: localToday(timezone), source: 'calendar' };
}
