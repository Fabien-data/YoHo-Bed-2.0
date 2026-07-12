import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, nextBookingReference, type DbHandle } from '../src/index';

/**
 * Proves the booking-reference race (BUG #4) is fixed: many concurrent reference generations for
 * the same day are all unique. Requires a running, migrated database; skips without DATABASE_URL.
 */
const superUrl = process.env.DATABASE_URL;
const run = superUrl ? describe : describe.skip;

function appUrlFrom(url: string): string {
  const u = new URL(url);
  u.username = 'yoho_app';
  u.password = 'yoho_app_pw';
  return u.toString();
}

run('booking reference — race-free (BUG #4)', () => {
  let sup: DbHandle;
  let app: DbHandle;
  const day = '2026-08-01';

  beforeAll(async () => {
    sup = createDb(superUrl as string);
    app = createDb(appUrlFrom(superUrl as string));
    await sup.sql`DELETE FROM booking_counters WHERE day = ${day}`;
  });

  afterAll(async () => {
    await sup.sql`DELETE FROM booking_counters WHERE day = ${day}`;
    await sup?.close();
    await app?.close();
  });

  it('20 concurrent reference generations are all unique', async () => {
    const N = 20;
    const refs = await Promise.all(
      Array.from({ length: N }, () => app.db.transaction((tx) => nextBookingReference(tx, day))),
    );
    expect(new Set(refs).size).toBe(N);
    expect(refs.every((r) => r.startsWith('2608') && r.length === 10)).toBe(true);
  });
});
