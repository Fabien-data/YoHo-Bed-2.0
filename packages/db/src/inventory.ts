import { sql } from 'drizzle-orm';
import type { Tx } from './scope';

/** Raised (rolling back the surrounding transaction) when a night cannot be reserved. */
export class InsufficientAvailabilityError extends Error {
  constructor(
    public readonly roomId: string,
    public readonly date: string,
    public readonly requested: number,
  ) {
    super(`Insufficient availability for room ${roomId} on ${date} (requested ${requested})`);
    this.name = 'InsufficientAvailabilityError';
  }
}

/**
 * Atomically reserve `rooms` for every night of a stay — the fix for the legacy overbooking race
 * (BUG #1). The legacy code read `rooms_to_sell`, subtracted in PHP, and wrote it back with no
 * lock, transaction, or floor, so two concurrent bookings could both "succeed" and drive the
 * count negative.
 *
 * Here each night is a single conditional UPDATE: it only decrements when enough inventory is
 * still open, and Postgres re-evaluates that predicate against the row it just locked. Under
 * contention exactly one writer can take the last room; the rest match zero rows and we throw,
 * rolling back any nights already taken in this transaction. The `rooms_to_sell >= 0` check
 * constraint is the final backstop. Call inside `withTenant(...)` so RLS is in force.
 */
export async function reserveStay(
  tx: Tx,
  roomId: string,
  nights: string[],
  rooms: number,
): Promise<void> {
  for (const date of nights) {
    const result = await tx.execute(sql`
      UPDATE availability_calendar
         SET rooms_to_sell = rooms_to_sell - ${rooms}, updated_at = now()
       WHERE room_id = ${roomId}
         AND date = ${date}
         AND status = 'Open'
         AND rooms_to_sell >= ${rooms}
      RETURNING id
    `);
    if ((result as unknown as unknown[]).length === 0) {
      throw new InsufficientAvailabilityError(roomId, date, rooms);
    }
  }
}

/** Return reserved rooms on cancel/reject, capped at the room's physical quantity. */
export async function releaseStay(
  tx: Tx,
  roomId: string,
  nights: string[],
  rooms: number,
): Promise<void> {
  for (const date of nights) {
    await tx.execute(sql`
      UPDATE availability_calendar
         SET rooms_to_sell = LEAST(rooms_to_sell + ${rooms}, physical_quantity), updated_at = now()
       WHERE room_id = ${roomId}
         AND date = ${date}
    `);
  }
}
