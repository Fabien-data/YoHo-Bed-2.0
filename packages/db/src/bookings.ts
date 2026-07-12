import { sql } from 'drizzle-orm';
import type { Tx } from './scope';

/**
 * Race-free booking reference (fixes BUG #4). The legacy `MAX(reference)+1` could hand two
 * concurrent bookings the same number. Here an atomic `INSERT ... ON CONFLICT DO UPDATE`
 * increments a per-day counter under a row lock, so every reference is distinct.
 *
 * Format mirrors the legacy scheme: `yymmdd` + a zero-padded 4-digit counter (e.g. 2608010001).
 */
export async function nextBookingReference(tx: Tx, day: string): Promise<string> {
  const res = await tx.execute(sql`
    INSERT INTO booking_counters (day, counter) VALUES (${day}, 1)
    ON CONFLICT (day) DO UPDATE SET counter = booking_counters.counter + 1
    RETURNING counter
  `);
  const rows = res as unknown as Array<{ counter: number }>;
  const counter = Number(rows[0]!.counter);
  const yymmdd = day.slice(2).replace(/-/g, '');
  return `${yymmdd}${String(counter).padStart(4, '0')}`;
}
