import bcrypt from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import {
  priceDay,
  computeCommission,
  sellingPrice,
  sellingFromCommissionable,
  taxFromSelling,
  applyLastMinuteDrop,
} from '@yohobed/domain';
import { createDb } from './client';
import { seedDefaultTemplates } from './default-templates';
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
  taxTypes,
  taxDurations,
  propertyTaxTypes,
  commissionSlabs,
  languages,
  templates,
  cmRoomMappings,
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
  for (
    let d = new Date(`${start}T00:00:00Z`), i = 0;
    i < days;
    i++, d.setUTCDate(d.getUTCDate() + 1)
  ) {
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

  // Reset the demo tenant's inventory so the seed is deterministic even after ad-hoc test data.
  // (Dev seed only — cascades to rooms, rate plans, availability, bookings, etc. for this tenant.)
  await db.delete(properties).where(eq(properties.tenantId, tenantId));

  // Property (selected by name so stray properties never shadow it)
  let [property] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), eq(properties.name, 'Cinnamon Lakeside')));
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

  // --- A tax + slab-commission property (Compartment A parity demo) ----------------
  // "Ceylon Tax Villa" exercises the two new pricing paths together: slab-based Yoho commission
  // plus a 10% service charge (priority 1) and 15% VAT (priority 3). Its selling prices are the
  // tax-inclusive charged prices; a booking decomposes the tax back out and reconciles exactly.
  const taxRates = { serviceCharge: 0.1, nbt: 0, vat: 0.15 };
  const slabStructure = {
    type: 'slab' as const,
    slabs: [
      { slabStart: 0, slabEnd: 20000, commission: 2500 },
      { slabStart: 20000.01, slabEnd: 100000, commission: 4000 },
    ],
  };

  let [taxProp] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.tenantId, tenantId), eq(properties.name, 'Ceylon Tax Villa')));
  if (!taxProp) {
    [taxProp] = await db
      .insert(properties)
      .values({ tenantId, name: 'Ceylon Tax Villa', commissionType: 'slab' })
      .returning();
  }
  const taxPropId = taxProp!.id;

  // Commission slabs (reset deterministically).
  await db.delete(commissionSlabs).where(eq(commissionSlabs.propertyId, taxPropId));
  await db.insert(commissionSlabs).values([
    {
      tenantId,
      propertyId: taxPropId,
      slabStart: '0.00',
      slabEnd: '20000.00',
      commission: '2500.00',
    },
    {
      tenantId,
      propertyId: taxPropId,
      slabStart: '20000.01',
      slabEnd: '100000.00',
      commission: '4000.00',
    },
  ]);

  // Tax config: Service Charge (priority 1, 10%) + VAT (priority 3, 15%), for all of 2026.
  await db.delete(propertyTaxTypes).where(eq(propertyTaxTypes.propertyId, taxPropId));
  await db.delete(taxTypes).where(eq(taxTypes.tenantId, tenantId)); // cascades tax_durations
  const [scType] = await db
    .insert(taxTypes)
    .values({ tenantId, name: 'Service Charge' })
    .returning();
  const [vatType] = await db.insert(taxTypes).values({ tenantId, name: 'VAT' }).returning();
  await db.insert(taxDurations).values([
    {
      tenantId,
      taxTypeId: scType!.id,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      ratePercent: '10.0000',
    },
    {
      tenantId,
      taxTypeId: vatType!.id,
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      ratePercent: '15.0000',
    },
  ]);
  await db.insert(propertyTaxTypes).values([
    { tenantId, propertyId: taxPropId, taxTypeId: scType!.id, priority: 1 },
    { tenantId, propertyId: taxPropId, taxTypeId: vatType!.id, priority: 3 },
  ]);

  // Room + availability for the taxed property.
  let [taxRoom] = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.tenantId, tenantId), eq(rooms.name, 'Ocean Suite')));
  if (!taxRoom) {
    [taxRoom] = await db
      .insert(rooms)
      .values({ tenantId, propertyId: taxPropId, name: 'Ocean Suite', quantity: 3 })
      .returning();
  }
  const taxRoomId = taxRoom!.id;
  await db.delete(availabilityCalendar).where(eq(availabilityCalendar.roomId, taxRoomId));
  await db.insert(availabilityCalendar).values(
    dateRange(START, 14).map((date) => ({
      tenantId,
      propertyId: taxPropId,
      roomId: taxRoomId,
      date,
      physicalQuantity: 3,
      roomsToSell: 3,
      status: 'Open' as const,
    })),
  );

  // BB rate plan + Double occupancy, priced tax-awarely: base → slab commission → OTA → tax.
  let [taxRatePlan] = await db
    .select()
    .from(ratePlans)
    .where(and(eq(ratePlans.roomId, taxRoomId), eq(ratePlans.rateCodeId, bb!.id)));
  if (!taxRatePlan) {
    [taxRatePlan] = await db
      .insert(ratePlans)
      .values({ tenantId, propertyId: taxPropId, roomId: taxRoomId, rateCodeId: bb!.id })
      .returning();
  }
  let [taxOcc] = await db
    .select()
    .from(occupancies)
    .where(eq(occupancies.ratePlanId, taxRatePlan!.id));
  if (!taxOcc) {
    [taxOcc] = await db
      .insert(occupancies)
      .values({ tenantId, ratePlanId: taxRatePlan!.id, label: 'Double', accommodates: 2 })
      .returning();
  }
  await db.delete(rateCalendar).where(eq(rateCalendar.occupancyId, taxOcc!.id));
  await db.insert(rateCalendar).values(
    dateRange(START, 14).map((date) => {
      const base = isWeekend(date) ? 25000 : 18000;
      const commission = computeCommission(base, slabStructure);
      const commissionable = sellingPrice(base, commission, 18);
      const selling = sellingFromCommissionable(commissionable, taxRates);
      return {
        tenantId,
        occupancyId: taxOcc!.id,
        date,
        basePrice: base.toFixed(2),
        commission: commission.toFixed(2),
        sellingPrice: selling.toFixed(2),
      };
    }),
  );

  // Demo: a 15% last-minute drop on the first 3 nights of the taxed occupancy (Compartment B).
  const dropDates = dateRange(START, 3);
  await db
    .update(rateCalendar)
    .set({ lastMinuteDropPct: '15.00' })
    .where(and(eq(rateCalendar.occupancyId, taxOcc!.id), inArray(rateCalendar.date, dropDates)));

  // Live reconciliation proof for one weekday night (printed below).
  const demoBase = 18000;
  const demoCommission = computeCommission(demoBase, slabStructure); // slab → 2500
  const demoCommissionable = sellingPrice(demoBase, demoCommission, 18); // ÷0.82 → 25000
  const demoSelling = sellingFromCommissionable(demoCommissionable, taxRates); // ×1.265 → 31625
  const demoTaxes = taxFromSelling(demoSelling, taxRates); // → 6625
  const demoOta = demoCommissionable - demoBase - demoCommission; // 4500
  const demoEffective = applyLastMinuteDrop(demoSelling, 15); // 31625 → 26881.25

  // Languages (global) + message templates (Compartment E).
  for (const l of [
    { code: 'en', name: 'English', isDefault: true },
    { code: 'si', name: 'Sinhala', isDefault: false },
    { code: 'ta', name: 'Tamil', isDefault: false },
  ]) {
    await db.insert(languages).values(l).onConflictDoNothing({ target: languages.code });
  }
  // Message templates: the SAME set new tenants get at registration (single source of truth).
  await db.delete(templates).where(eq(templates.tenantId, tenantId));
  await seedDefaultTemplates(db, tenantId);

  // Channel-manager room-code mappings (Compartment F) — routes webhook pushes to our rooms.
  await db.delete(cmRoomMappings).where(eq(cmRoomMappings.tenantId, tenantId));
  await db.insert(cmRoomMappings).values([
    { tenantId, propertyId, roomId, code: 'CM-DLX-001' },
    { tenantId, propertyId: taxPropId, roomId: taxRoomId, code: 'CM-OCN-101' },
  ]);

  // Cross-tenant YoHo staff user (tenantId null) for the staff console.
  const STAFF_EMAIL = 'staff@yohobed.test';
  let [staff] = await db.select().from(users).where(eq(users.email, STAFF_EMAIL));
  if (!staff) {
    const staffHash = await bcrypt.hash(OWNER_PASSWORD, 10);
    [staff] = await db
      .insert(users)
      .values({ email: STAFF_EMAIL, name: 'YoHo Staff', passwordHash: staffHash })
      .returning();
    await db.insert(memberships).values({ userId: staff!.id, tenantId: null, role: 'YOHO_STAFF' });
  }

  console.log('✓ Seed ready');
  console.log(`  Owner login : ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`  Staff login : ${STAFF_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`  tenantId    : ${tenantId}`);
  console.log(`  roomId      : ${roomId}`);
  console.log(`  last-room   : ${LAST_ROOM_DATE} (rooms_to_sell = 1)`);
  console.log(`  occupancyId : ${occ!.id} (BB / Double, priced via @yohobed/domain)`);
  console.log(`  taxed occ   : ${taxOcc!.id} (Ceylon Tax Villa · slab + 10% SC + 15% VAT)`);
  console.log(
    `    reconcile : base ${demoBase} + yoho ${demoCommission} + ota ${demoOta} + taxes ${demoTaxes} = ` +
      `${demoBase + demoCommission + demoOta + demoTaxes} (selling ${demoSelling})`,
  );
  console.log(
    `    last-min  : 15% drop on ${dropDates[0]}–${dropDates[2]} → weekday selling ${demoSelling} charged as ${demoEffective}`,
  );
} finally {
  await close();
}
