import { ConflictException } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { exchangeRates, type Tx } from '@yohobed/db';

/**
 * The LKR-conversion rate to freeze onto a booking: 1 for LKR, else the newest exchange_rates
 * row for `currency`→LKR. Returns a numeric string for the column.
 *
 * A missing rate REFUSES the booking rather than freezing 1:1 — a USD 250 booking recorded as
 * LKR 250 poisons every downstream aggregate, invoice and payout, silently and permanently.
 * The rate table can be empty any time the worker is down or its provider keeps failing, not
 * just "before the FX job first runs", so the loud failure is the only safe behaviour. A staff
 * override via POST /fx/override unblocks bookings immediately if the feed is down.
 */
export async function resolveFxRateToLkr(tx: Tx, currency: string): Promise<string> {
  if (currency === 'LKR') return '1';
  const [row] = await tx
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.base, currency), eq(exchangeRates.quote, 'LKR')))
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1);
  if (!row) {
    throw new ConflictException({
      error: 'fx_rate_unavailable',
      message: `No ${currency}→LKR exchange rate is loaded; cannot record a ${currency} booking. Check the worker's FX job, or set a manual override.`,
    });
  }
  return row.rate;
}
