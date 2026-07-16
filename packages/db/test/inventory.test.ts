import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createDb,
  withTenant,
  reserveStay,
  releaseStay,
  InsufficientAvailabilityError,
  tenants,
  properties,
  rooms,
  availabilityCalendar,
  type DbHandle,
} from '../src/index';

/**
 * Proves the overbooking race (BUG #1) is fixed: many concurrent reservations for the last
 * room result in exactly ONE success and the count never goes negative.
 *
 * Requires a running, migrated database. Skips without DATABASE_URL.
 */
const superUrl = process.env.DATABASE_URL;
// Skipping silently is fine locally, but in CI a skipped integration suite is a green build that
// proved nothing — fail loudly instead.
if (!superUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: these integration tests must never be skipped.');
}
const run = superUrl ? describe : describe.skip;

function appUrlFrom(url: string): string {
  const u = new URL(url);
  u.username = 'yoho_app';
  u.password = 'yoho_app_pw';
  return u.toString();
}

run('inventory — atomic decrement under concurrency', () => {
  let sup: DbHandle;
  let app: DbHandle;
  let tenantId = '';
  let roomId = '';
  const date = '2026-08-01';
  const stamp = Date.now();

  async function currentRoomsToSell(): Promise<number> {
    const [row] = await sup.db
      .select()
      .from(availabilityCalendar)
      .where(eq(availabilityCalendar.roomId, roomId));
    return row!.roomsToSell;
  }

  beforeAll(async () => {
    sup = createDb(superUrl as string);
    app = createDb(appUrlFrom(superUrl as string));

    const [tenant] = await sup.db
      .insert(tenants)
      .values({ name: 'Inv Tenant', email: `inv+${stamp}@yohobed.test` })
      .returning();
    tenantId = tenant!.id;
    const [property] = await sup.db
      .insert(properties)
      .values({ tenantId, name: 'Inv Property' })
      .returning();
    const [room] = await sup.db
      .insert(rooms)
      .values({ tenantId, propertyId: property!.id, name: 'Deluxe', quantity: 1 })
      .returning();
    roomId = room!.id;
    await sup.db.insert(availabilityCalendar).values({
      tenantId,
      propertyId: property!.id,
      roomId,
      date,
      physicalQuantity: 1,
      roomsToSell: 1,
      status: 'Open',
    });
  });

  afterAll(async () => {
    if (tenantId) await sup.db.delete(tenants).where(eq(tenants.id, tenantId));
    await sup?.close();
    await app?.close();
  });

  it('with one room left, 12 concurrent reservations → exactly one succeeds', async () => {
    const N = 12;
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        withTenant(app.db, tenantId, (tx) => reserveStay(tx, roomId, [date], 1)),
      ),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(N - 1);
    expect(lost.every((r) => r.reason instanceof InsufficientAvailabilityError)).toBe(true);
    expect(await currentRoomsToSell()).toBe(0); // never negative
  });

  it('releaseStay restores inventory, capped at the physical quantity', async () => {
    await withTenant(app.db, tenantId, (tx) => releaseStay(tx, roomId, [date], 1));
    expect(await currentRoomsToSell()).toBe(1);
    // releasing again must not exceed physical_quantity (1)
    await withTenant(app.db, tenantId, (tx) => releaseStay(tx, roomId, [date], 1));
    expect(await currentRoomsToSell()).toBe(1);
  });

  it('reserving more than available fails and leaves the count unchanged', async () => {
    await expect(
      withTenant(app.db, tenantId, (tx) => reserveStay(tx, roomId, [date], 2)),
    ).rejects.toBeInstanceOf(InsufficientAvailabilityError);
    expect(await currentRoomsToSell()).toBe(1);
  });
});
