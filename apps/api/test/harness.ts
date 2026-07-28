import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import {
  createDb,
  tenants,
  users,
  memberships,
  properties,
  rooms,
  rateCodes,
  ratePlans,
  occupancies,
  exchangeRates,
  seedDefaultTemplates,
  type Database,
} from '@yohobed/db';
import { AppModule } from '../src/app.module';

/**
 * e2e harness. Every suite gets its OWN tenant with a unique email, so suites are isolated from
 * each other and from the dev seed, and the file can be re-run without cleanup. Fixtures are
 * inserted as `postgres` (bypasses RLS, like the seed); everything under test goes through HTTP,
 * where the app connects as `yoho_app` and RLS is in force.
 */

let app: INestApplication | undefined;
let adminDb: { db: Database; close: () => Promise<void> } | undefined;

export async function startApp(): Promise<INestApplication> {
  if (app) return app;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // No global pipe: this app validates with per-route zod pipes, exactly as main.ts boots it.
  app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

export async function stopApp(): Promise<void> {
  await app?.close();
  app = undefined;
  await adminDb?.close();
  adminDb = undefined;
}

/** Privileged handle for fixtures only (never for assertions about what a tenant may see). */
export function admin(): Database {
  adminDb ??= createDb(process.env.TEST_DATABASE_URL!, { max: 2 });
  return adminDb.db;
}

export const PASSWORD = 'password123';

export interface TenantFixture {
  tenantId: string;
  userId: string;
  email: string;
  propertyId: string;
  roomId: string;
  occupancyId: string;
  token: string;
}

let seq = 0;
/** A unique-per-call identity so parallel/repeat runs never collide on the unique email. */
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${seq}`;
}

/**
 * Provision a ready-to-book tenant: owner user, property, room (with inventory), BB rate plan +
 * occupancy. Availability/prices are left to the caller (via the API) so tests exercise the real
 * endpoints. Returns a logged-in bearer token.
 */
export async function makeTenant(
  opts: {
    status?: 'pending' | 'active' | 'inactive' | 'suspended';
    roomQuantity?: number;
    commissionPercentage?: number;
  } = {},
): Promise<TenantFixture> {
  const db = admin();
  const email = `${uniq('e2e')}@test.yohobed.local`;

  const [tenant] = await db
    .insert(tenants)
    .values({ name: `E2E ${email}`, email, status: opts.status ?? 'active' })
    .returning();
  const [user] = await db
    .insert(users)
    .values({
      tenantId: tenant!.id,
      email,
      name: 'E2E Owner',
      passwordHash: await bcrypt.hash(PASSWORD, 10),
    })
    .returning();
  await db.insert(memberships).values({ userId: user!.id, tenantId: tenant!.id, role: 'OWNER' });
  // Mirror what /auth/register provisions, so fixtures behave like real tenants.
  await seedDefaultTemplates(db, tenant!.id);

  const [property] = await db
    .insert(properties)
    .values({
      tenantId: tenant!.id,
      name: 'E2E Property',
      commissionType: 'percentage',
      commissionPercentage: String(opts.commissionPercentage ?? 10),
    })
    .returning();
  const [room] = await db
    .insert(rooms)
    .values({
      tenantId: tenant!.id,
      propertyId: property!.id,
      name: 'E2E Room',
      quantity: opts.roomQuantity ?? 5,
    })
    .returning();

  // Rate codes are a global lookup seeded by db:seed; fall back to creating BB if absent.
  let [bb] = await db.select().from(rateCodes).where(eq(rateCodes.code, 'BB'));
  if (!bb) {
    [bb] = await db
      .insert(rateCodes)
      .values({ code: 'BB', name: 'Bed & Breakfast', sortOrder: 1 })
      .returning();
  }
  const [plan] = await db
    .insert(ratePlans)
    .values({
      tenantId: tenant!.id,
      propertyId: property!.id,
      roomId: room!.id,
      rateCodeId: bb!.id,
    })
    .returning();
  const [occ] = await db
    .insert(occupancies)
    .values({ tenantId: tenant!.id, ratePlanId: plan!.id, label: 'Double', accommodates: 2 })
    .returning();

  // Suspended/inactive tenants are refused at login by design — don't fight it here; the auth
  // suite asserts that behaviour explicitly.
  const canLogin = (opts.status ?? 'active') === 'active' || opts.status === 'pending';
  const token = canLogin ? await login(email, PASSWORD) : '';
  return {
    tenantId: tenant!.id,
    userId: user!.id,
    email,
    propertyId: property!.id,
    roomId: room!.id,
    occupancyId: occ!.id,
    token,
  };
}

export interface PropertyFixture {
  propertyId: string;
  roomId: string;
  occupancyId: string;
}

/**
 * Add a SECOND property to an existing tenant, optionally in a different base currency — the
 * fixture behind the multi-currency aggregation tests. Mirrors what makeTenant builds (room +
 * BB rate plan + occupancy) so the property is immediately bookable.
 */
export async function addProperty(
  fx: TenantFixture,
  opts: { currency?: 'LKR' | 'USD'; name?: string; roomQuantity?: number } = {},
): Promise<PropertyFixture> {
  const db = admin();
  const [property] = await db
    .insert(properties)
    .values({
      tenantId: fx.tenantId,
      name: opts.name ?? 'E2E Property 2',
      currency: opts.currency ?? 'LKR',
      commissionType: 'percentage',
      commissionPercentage: '10',
    })
    .returning();
  const [room] = await db
    .insert(rooms)
    .values({
      tenantId: fx.tenantId,
      propertyId: property!.id,
      name: 'E2E Room 2',
      quantity: opts.roomQuantity ?? 5,
    })
    .returning();
  const [bb] = await db.select().from(rateCodes).where(eq(rateCodes.code, 'BB'));
  const [plan] = await db
    .insert(ratePlans)
    .values({
      tenantId: fx.tenantId,
      propertyId: property!.id,
      roomId: room!.id,
      rateCodeId: bb!.id,
    })
    .returning();
  const [occ] = await db
    .insert(occupancies)
    .values({ tenantId: fx.tenantId, ratePlanId: plan!.id, label: 'Double', accommodates: 2 })
    .returning();
  return { propertyId: property!.id, roomId: room!.id, occupancyId: occ!.id };
}

/**
 * Publish an FX rate (1 `base` = `rate` LKR). Without one, BookingService falls back to 1 and a
 * USD booking would snapshot a meaningless rate, so currency tests must set this before booking.
 */
export async function setFxRate(base: string, rate: number): Promise<void> {
  await admin()
    .insert(exchangeRates)
    .values({ base, quote: 'LKR', rate: rate.toFixed(8), source: 'e2e' });
}

/** Open inventory + price a specific room/occupancy (the multi-property variant of openAndPrice). */
export async function openAndPriceProperty(
  fx: TenantFixture,
  p: PropertyFixture,
  from: string,
  to: string,
  opts: { roomsToSell?: number; base?: number } = {},
): Promise<void> {
  const avail = await request('POST', `/rooms/${p.roomId}/availability`, {
    token: fx.token,
    body: { from, to, roomsToSell: opts.roomsToSell ?? 5, status: 'Open' },
  });
  if (avail.status !== 200)
    throw new Error(`openAvailability failed: ${JSON.stringify(avail.body)}`);
  const price = await request('POST', `/occupancies/${p.occupancyId}/price`, {
    token: fx.token,
    body: { from, to, base: opts.base ?? 100 },
  });
  if (price.status !== 200) throw new Error(`setPrice failed: ${JSON.stringify(price.body)}`);
}

/** A cross-tenant YoHo staff user (tenantId null), for RBAC tests. */
export async function makeStaff(role: 'YOHO_STAFF' | 'YOHO_ADMIN' = 'YOHO_STAFF') {
  const db = admin();
  const email = `${uniq('staff')}@test.yohobed.local`;
  const [user] = await db
    .insert(users)
    .values({ email, name: 'E2E Staff', passwordHash: await bcrypt.hash(PASSWORD, 10) })
    .returning();
  await db.insert(memberships).values({ userId: user!.id, tenantId: null, role });
  return { userId: user!.id, email, token: await login(email, PASSWORD) };
}

export async function login(email: string, password = PASSWORD): Promise<string> {
  const res = await request('POST', '/auth/login', { body: { email, password } });
  if (res.status !== 200)
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  return (res.body as { accessToken: string }).accessToken;
}

export interface Res<T = any> {
  status: number;
  body: T;
}

/** Minimal HTTP client against the in-process app (supertest without the chaining ceremony). */
export async function request<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res<T>> {
  const server = (await startApp()).getHttpServer();
  const supertest = (await import('supertest')).default;
  let req = supertest(server)[method.toLowerCase() as 'get'](path);
  if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
  for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
  if (opts.body !== undefined) req = req.send(opts.body as object);
  const res = await req;
  return { status: res.status, body: res.body as T };
}

/** Open inventory + set a base price for a range — the usual precondition for booking tests. */
export async function openAndPrice(
  fx: TenantFixture,
  from: string,
  to: string,
  opts: { roomsToSell?: number; base?: number } = {},
): Promise<void> {
  const avail = await request('POST', `/rooms/${fx.roomId}/availability`, {
    token: fx.token,
    body: { from, to, roomsToSell: opts.roomsToSell ?? 5, status: 'Open' },
  });
  if (avail.status !== 200)
    throw new Error(`openAvailability failed: ${JSON.stringify(avail.body)}`);
  const price = await request('POST', `/occupancies/${fx.occupancyId}/price`, {
    token: fx.token,
    body: { from, to, base: opts.base ?? 18000 },
  });
  if (price.status !== 200) throw new Error(`setPrice failed: ${JSON.stringify(price.body)}`);
}

/**
 * Book a stay through the real endpoint. Defaults to the tenant's primary room/occupancy; pass
 * `roomId`/`occupancyId` to book a second property (see `addProperty`).
 */
export function book(
  fx: TenantFixture,
  body: Partial<{
    customerName: string;
    customerEmail: string;
    checkin: string;
    checkout: string;
    rooms: number;
    roomId: string;
    occupancyId: string;
  }> & { checkin: string; checkout: string },
) {
  return request('POST', '/bookings', {
    token: fx.token,
    body: {
      roomId: fx.roomId,
      occupancyId: fx.occupancyId,
      customerName: body.customerName ?? 'E2E Guest',
      ...body,
    },
  });
}
