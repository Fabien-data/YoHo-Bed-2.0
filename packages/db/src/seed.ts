import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { priceDay } from '@yohobed/domain';
import { createDb } from './client';
import {
  tenants,
  users,
  memberships,
  properties,
  rooms,
  availabilityCalendar,
  rateCodes,
  ratePlans,
  occupancies,
  rateCalendar,
} from './schema';

/**
 * Dev seed: one demo owner, a property, a room, and a bookable availability calendar — so the
 * API auth + inventory flow can be exercised end-to-end. Idempotent (safe to re-run). Runs as
 * the superuser (DATABASE_URL) so it bypasses RLS.
 */
const url = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/yohobed';

const OWNER_EMAIL = 'owner@demo.yohobed.test';
const OWNER_PASSWORD = 'password123';
const TENANT_EMAIL = 'tenant@demo.yohobed.test';
const ROOM_NAME = 'Deluxe Room';
const QUANTITY = 5;
const START = '2026-08-01';
const LAST_ROOM_DATE = '2026-08-10'; // deliberately set to 1 room, for the concurrency demo

function dateRange(start: string, days: number): string[] {
  const out: string[] = [];
  for (let d = new Date(`${start}T00:00:00Z`), i = 0; i < days; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

const { db, close } = createDb(url, { max: 1 });

try {
  // Tenant
  let [tenant] = await db.select().from(tenants).where(eq(tenants.email, TENANT_EMAIL));
  if (!tenant) {
    [tenant] = await db
      .insert(tenants)
      .values({ name: 'Cinnamon Lakeside Group', email: TENANT_EMAIL })
      .returning();
  }
  const tenantId = tenant!.id;

  // Owner user + membership
  let [user] = await db.select().from(users).where(eq(users.email, OWNER_EMAIL));
  if (!user) {
    const passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    [user] = await db
      .insert(users)
      .values({ tenantId, email: OWNER_EMAIL, name: 'Demo Owner', passwordHash })
      .returning();
    await db.insert(memberships).values({ userId: user!.id, tenantId, role: 'OWNER' });
  }

  // Property
  let [property] = await db.select().from(properties).where(eq(properties.tenantId, tenantId));
  if (!property) {
    [property] = await db
      .insert(properties)
      .values({ tenantId, name: 'Cinnamon Lakeside' })
      .returning();
  }
  const propertyId = property!.id;

  // Room
  let [room] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.name, ROOM_NAME)));
  if (!room) {
    [room] = await db
      .insert(rooms)
      .values({ tenantId, propertyId, name: ROOM_NAME, quantity: QUANTITY })
      .returning();
  }
  const roomId = room!.id;

  // Availability calendar (reset deterministically): 14 days, 5 rooms/night, except the demo date.
  await db.delete(availabilityCalendar).where(eq(availabilityCalendar.roomId, roomId));
  await db.insert(availabilityCalendar).values(
    dateRange(START, 14).map((date) => ({
      tenantId,
      propertyId,
      roomId,
      date,
      physicalQuantity: QUANTITY,
      roomsToSell: date === LAST_ROOM_DATE ? 1 : QUANTITY,
      status: 'Open' as const,
    })),
  );

  // Rate codes (global meal-plan lookup)
  const codes = [
    { code: 'RO', name: 'Room Only', sortOrder: 1 },
    { code: 'BB', name: 'Bed & Breakfast', sortOrder: 2 },
    { code: 'HB', name: 'Half Board', sortOrder: 3 },
    { code: 'FB', name: 'Full Board', sortOrder: 4 },
    { code: 'AI', name: 'All Inclusive', sortOrder: 5 },
  ];
  for (const c of codes) {
    await db.insert(rateCodes).values(c).onConflictDoNothing({ target: rateCodes.code });
  }
  const [bb] = await db.select().from(rateCodes).where(eq(rateCodes.code, 'BB'));

  // A BB rate plan for the Deluxe room + a Double occupancy
  let [ratePlan] = await db
    .select()
    .from(ratePlans)
    .where(and(eq(ratePlans.roomId, roomId), eq(ratePlans.rateCodeId, bb!.id)));
  if (!ratePlan) {
    [ratePlan] = await db
      .insert(ratePlans)
      .values({ tenantId, propertyId, roomId, rateCodeId: bb!.id })
      .returning();
  }
  let [occ] = await db.select().from(occupancies).where(eq(occupancies.ratePlanId, ratePlan!.id));
  if (!occ) {
    [occ] = await db
      .insert(occupancies)
      .values({ tenantId, ratePlanId: ratePlan!.id, label: 'Double', accommodates: 2 })
      .returning();
  }

  // Prices: base Rs 120 weekday / 150 weekend; selling computed by the parity-tested domain engine.
  const structure = { type: 'percentage' as const, percentage: 10 };
  await db.delete(rateCalendar).where(eq(rateCalendar.occupancyId, occ!.id));
  await db.insert(rateCalendar).values(
    dateRange(START, 14).map((date) => {
      const base = isWeekend(date) ? 25000 : 18000; // realistic LKR nightly base
      const priced = priceDay(base, structure, 18);
      return {
        tenantId,
        occupancyId: occ!.id,
        date,
        basePrice: base.toFixed(2),
        commission: priced.commission.toFixed(2),
        sellingPrice: priced.selling.toFixed(2),
      };
    }),
  );

  console.log('✓ Seed ready');
  console.log(`  Owner login : ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`  tenantId    : ${tenantId}`);
  console.log(`  roomId      : ${roomId}`);
  console.log(`  last-room   : ${LAST_ROOM_DATE} (rooms_to_sell = 1)`);
  console.log(`  occupancyId : ${occ!.id} (BB / Double, priced via @yohobed/domain)`);
} finally {
  await close();
}
