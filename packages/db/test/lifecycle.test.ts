import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  availabilityCalendar,
  bookingRooms,
  bookings,
  createDb,
  customers,
  dueLifecycleTenants,
  noShowReleaseFrom,
  occupancies,
  properties,
  rateCodes,
  ratePlans,
  rooms,
  stayNights,
  sweepReservationLifecycle,
  tenants,
  withTenant,
  type DbHandle,
} from '../src/index';
import { appUrlFrom } from './app-url';

/**
 * The reservation lifecycle (Development Phase 02): holds release on time, exactly once, from the
 * restricted app role the worker runs as — and the database itself refuses a booking whose kind,
 * status and inventory disagree.
 */
const superUrl = process.env.DATABASE_URL;
if (!superUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: these integration tests must never be skipped.');
}
const run = superUrl ? describe : describe.skip;

describe('lifecycle dates', () => {
  it('lists the nights of a half-open stay', () => {
    expect(stayNights('2028-02-27', '2028-03-01')).toEqual([
      '2028-02-27',
      '2028-02-28',
      '2028-02-29',
    ]);
    expect(stayNights('2028-03-01', '2028-03-01')).toEqual([]);
  });

  it('keeps a no-show’s missed night and frees the rest', () => {
    expect(noShowReleaseFrom('2028-03-02', '2028-03-06', '2028-03-01')).toBe('2028-03-03');
    expect(noShowReleaseFrom('2028-03-02', '2028-03-06', '2028-03-04')).toBe('2028-03-05');
    expect(noShowReleaseFrom('2028-03-02', '2028-03-03', '2028-03-02')).toBeNull();
  });
});

run('the hold sweep', () => {
  let sup: DbHandle;
  let app: DbHandle;
  let tenantId = '';
  let propertyId = '';
  let roomId = '';
  let occupancyId = '';
  let customerId = '';
  const stamp = Date.now();

  beforeAll(async () => {
    sup = createDb(superUrl as string);
    app = createDb(appUrlFrom(superUrl as string));
    const [t] = await sup.db
      .insert(tenants)
      .values({ name: 'Lifecycle', email: `lifecycle+${stamp}@yohobed.test` })
      .returning();
    tenantId = t!.id;
    const [p] = await sup.db
      .insert(properties)
      .values({ tenantId, name: 'Hold Hotel' })
      .returning();
    propertyId = p!.id;
    const [r] = await sup.db
      .insert(rooms)
      .values({ tenantId, propertyId, name: 'Double', quantity: 5 })
      .returning();
    roomId = r!.id;
    let [bb] = await sup.db.select().from(rateCodes).where(eq(rateCodes.code, 'BB'));
    if (!bb) [bb] = await sup.db.insert(rateCodes).values({ code: 'BB', name: 'BB' }).returning();
    const [plan] = await sup.db
      .insert(ratePlans)
      .values({ tenantId, propertyId, roomId, rateCodeId: bb!.id })
      .returning();
    const [occ] = await sup.db
      .insert(occupancies)
      .values({ tenantId, ratePlanId: plan!.id, label: 'Double' })
      .returning();
    occupancyId = occ!.id;
    const [c] = await sup.db.insert(customers).values({ tenantId, name: 'Held Guest' }).returning();
    customerId = c!.id;
  });

  afterAll(async () => {
    if (tenantId) await sup.db.delete(tenants).where(eq(tenants.id, tenantId));
    await sup?.close();
    await app?.close();
  });

  async function heldBooking(ref: string, holdUntil: Date) {
    for (const date of stayNights('2028-05-01', '2028-05-03')) {
      await sup.db
        .insert(availabilityCalendar)
        .values({ tenantId, propertyId, roomId, date, physicalQuantity: 5, roomsToSell: 4 })
        .onConflictDoUpdate({
          target: [availabilityCalendar.roomId, availabilityCalendar.date],
          set: { roomsToSell: sql`${availabilityCalendar.roomsToSell} - 1` },
        });
    }
    const [b] = await sup.db
      .insert(bookings)
      .values({
        tenantId,
        propertyId,
        roomId,
        occupancyId,
        customerId,
        reference: `${ref}-${stamp}`,
        checkin: '2028-05-01',
        checkout: '2028-05-03',
        nights: 2,
        amount: '200.00',
        totalBasePrice: '150.00',
        status: 'Approved',
        reservationKind: 'hold_confirm',
        holdUntil,
      })
      .returning();
    await sup.db.insert(bookingRooms).values({
      tenantId,
      bookingId: b!.id,
      checkin: '2028-05-01',
      checkout: '2028-05-03',
    });
    return b!;
  }

  it('releases a due hold exactly once, even with two sweepers, as the app role', async () => {
    const b = await heldBooking('HOLD', new Date(Date.now() - 60_000));

    // Without a tenant the app role sees no bookings at all — only which tenants have work.
    const visible = await app.db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(visible).toHaveLength(0);
    expect(await dueLifecycleTenants(app.db)).toContain(tenantId);

    const sweep = () =>
      withTenant(app.db, tenantId, (tx) => sweepReservationLifecycle(tx, tenantId));
    const [one, two] = await Promise.all([sweep(), sweep()]);
    expect(one.released.length + two.released.length).toBe(1);

    const [after] = await sup.db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(after).toMatchObject({ status: 'Cancelled', inventoryHeld: false });
    const [day] = await sup.db
      .select()
      .from(availabilityCalendar)
      .where(eq(availabilityCalendar.roomId, roomId));
    expect(day!.roomsToSell).toBe(5);
    const [leg] = await sup.db.select().from(bookingRooms).where(eq(bookingRooms.bookingId, b.id));
    expect(leg!.releasedAt).not.toBeNull();
    expect(await dueLifecycleTenants(app.db)).not.toContain(tenantId);
  });

  it('never releases a hold before its time', async () => {
    const b = await heldBooking('LATER', new Date(Date.now() + 3_600_000));
    const r = await withTenant(app.db, tenantId, (tx) => sweepReservationLifecycle(tx, tenantId));
    expect(r.released).toHaveLength(0);
    const [still] = await sup.db.select().from(bookings).where(eq(bookings.id, b.id));
    expect(still!.status).toBe('Approved');
  });

  it('derives inventory_held — it cannot be written, and cannot disagree with the kind', async () => {
    await expect(
      sup.db.execute(sql`update bookings set inventory_held = true where tenant_id = ${tenantId}`),
    ).rejects.toThrow();
    // A pending booking must be one of the unconfirmed kinds.
    await expect(
      sup.db.insert(bookings).values({
        tenantId,
        propertyId,
        roomId,
        occupancyId,
        customerId,
        reference: `BAD-${stamp}`,
        checkin: '2028-05-01',
        checkout: '2028-05-02',
        nights: 1,
        amount: '100.00',
        totalBasePrice: '80.00',
        status: 'Pending',
        reservationKind: 'confirm',
      }),
    ).rejects.toThrow();
    // Only a hold has a release time.
    await expect(
      sup.db.insert(bookings).values({
        tenantId,
        propertyId,
        roomId,
        occupancyId,
        customerId,
        reference: `BAD2-${stamp}`,
        checkin: '2028-05-01',
        checkout: '2028-05-02',
        nights: 1,
        amount: '100.00',
        totalBasePrice: '80.00',
        status: 'Approved',
        reservationKind: 'confirm',
        holdUntil: new Date(),
      }),
    ).rejects.toThrow();
  });
});
