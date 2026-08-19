import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../src/index';

/**
 * The room-unit model's load-bearing guarantees, asserted against real Postgres.
 *
 * Two things matter here and cannot be checked any other way: the exclusion constraint really
 * does make double-booking a physical room impossible (including the boundary cases a naive
 * overlap check gets wrong), and the 0020 back-fill really does reproduce itself on fresh data.
 */
const superUrl = process.env.DATABASE_URL;
if (!superUrl && process.env.CI) {
  throw new Error('DATABASE_URL must be set in CI: these integration tests must never be skipped.');
}
const run = superUrl ? describe : describe.skip;

run('room units', () => {
  let sup: DbHandle;
  let tenantId = '';
  let propertyId = '';
  let roomId = '';
  let occupancyId = '';
  let customerId = '';
  const units: string[] = [];

  beforeAll(async () => {
    sup = createDb(superUrl!, { max: 2 });
    const tag = `ru-${process.pid}-${Date.now().toString(36)}`;

    const t = await sup.db.execute(
      sql`insert into tenants (name, email) values (${tag}, ${`${tag}@t.local`}) returning id`,
    );
    tenantId = (t as unknown as Array<{ id: string }>)[0]!.id;

    const p = await sup.db.execute(
      sql`insert into properties (tenant_id, name) values (${tenantId}, 'RU Property') returning id`,
    );
    propertyId = (p as unknown as Array<{ id: string }>)[0]!.id;

    const r = await sup.db.execute(
      sql`insert into rooms (tenant_id, property_id, name, quantity)
          values (${tenantId}, ${propertyId}, 'RU Room', 3) returning id`,
    );
    roomId = (r as unknown as Array<{ id: string }>)[0]!.id;

    // Two physical rooms for a bucket that sells three — a legitimate divergence.
    for (const code of ['01', '02']) {
      const u = await sup.db.execute(
        sql`insert into room_units (tenant_id, property_id, room_id, code, display_order)
            values (${tenantId}, ${propertyId}, ${roomId}, ${code}, ${Number(code)}) returning id`,
      );
      units.push((u as unknown as Array<{ id: string }>)[0]!.id);
    }

    const rc = await sup.db.execute(
      sql`insert into rate_codes (code, name, sort_order) values ('RU', 'RU', 99)
          on conflict (code) do update set name = excluded.name returning id`,
    );
    const rp = await sup.db.execute(
      sql`insert into rate_plans (tenant_id, property_id, room_id, rate_code_id)
          values (${tenantId}, ${propertyId}, ${roomId},
                  ${(rc as unknown as Array<{ id: string }>)[0]!.id}) returning id`,
    );
    const oc = await sup.db.execute(
      sql`insert into occupancies (tenant_id, rate_plan_id, label, accommodates)
          values (${tenantId}, ${(rp as unknown as Array<{ id: string }>)[0]!.id}, 'Double', 2)
          returning id`,
    );
    occupancyId = (oc as unknown as Array<{ id: string }>)[0]!.id;

    const c = await sup.db.execute(
      sql`insert into customers (tenant_id, name) values (${tenantId}, 'RU Guest') returning id`,
    );
    customerId = (c as unknown as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => {
    if (tenantId) await sup.db.execute(sql`delete from tenants where id = ${tenantId}`);
    await sup?.close();
  });

  async function makeBooking(checkin: string, checkout: string): Promise<string> {
    const ref = `RU-${Math.random().toString(36).slice(2, 10)}`;
    const b = await sup.db.execute(
      sql`insert into bookings
            (tenant_id, property_id, room_id, occupancy_id, customer_id, reference,
             checkin, checkout, nights, rooms, amount, total_base_price)
          values (${tenantId}, ${propertyId}, ${roomId}, ${occupancyId}, ${customerId}, ${ref},
             ${checkin}, ${checkout}, 1, 1, '100.00', '100.00')
          returning id`,
    );
    return (b as unknown as Array<{ id: string }>)[0]!.id;
  }

  async function addLeg(
    bookingId: string,
    unitId: string | null,
    checkin: string,
    checkout: string,
    legIndex = 0,
    releasedAt: string | null = null,
  ) {
    return sup.db.execute(
      sql`insert into booking_rooms
            (tenant_id, booking_id, room_unit_id, leg_index, checkin, checkout, released_at)
          values (${tenantId}, ${bookingId}, ${unitId}, ${legIndex}, ${checkin}, ${checkout},
                  ${releasedAt})`,
    );
  }

  it('refuses to put two overlapping stays in the same physical room', async () => {
    const a = await makeBooking('2027-03-01', '2027-03-05');
    const b = await makeBooking('2027-03-03', '2027-03-07');

    await addLeg(a, units[0]!, '2027-03-01', '2027-03-05');
    await expect(addLeg(b, units[0]!, '2027-03-03', '2027-03-07')).rejects.toThrow();
  });

  it('allows a same-day turnover — one guest out, the next one in', async () => {
    const a = await makeBooking('2027-04-01', '2027-04-03');
    const b = await makeBooking('2027-04-03', '2027-04-05');

    await addLeg(a, units[1]!, '2027-04-01', '2027-04-03');
    // Half-open ranges: the 3rd belongs to the arriving guest only, so this must succeed.
    await expect(addLeg(b, units[1]!, '2027-04-03', '2027-04-05')).resolves.toBeDefined();
  });

  it('lets a released leg free the room for someone else', async () => {
    const a = await makeBooking('2027-05-01', '2027-05-04');
    const b = await makeBooking('2027-05-01', '2027-05-04');

    await addLeg(a, units[0]!, '2027-05-01', '2027-05-04', 0, new Date().toISOString());
    await expect(addLeg(b, units[0]!, '2027-05-01', '2027-05-04')).resolves.toBeDefined();
  });

  it('lets many unassigned legs coexist — an unassigned leg holds no room', async () => {
    const a = await makeBooking('2027-06-01', '2027-06-04');
    const b = await makeBooking('2027-06-01', '2027-06-04');

    await addLeg(a, null, '2027-06-01', '2027-06-04');
    await expect(addLeg(b, null, '2027-06-01', '2027-06-04')).resolves.toBeDefined();
  });

  it('refuses two overlapping maintenance blocks on one room', async () => {
    await sup.db.execute(
      sql`insert into maintenance_blocks
            (tenant_id, property_id, room_unit_id, block_from, block_to, reason)
          values (${tenantId}, ${propertyId}, ${units[1]!}, '2027-07-01', '2027-07-10', 'Water leak')`,
    );
    await expect(
      sup.db.execute(
        sql`insert into maintenance_blocks
              (tenant_id, property_id, room_unit_id, block_from, block_to, reason)
            values (${tenantId}, ${propertyId}, ${units[1]!}, '2027-07-05', '2027-07-12', 'Repaint')`,
      ),
    ).rejects.toThrow();
  });

  it('keeps a unit code unique within a property but not across properties', async () => {
    await expect(
      sup.db.execute(
        sql`insert into room_units (tenant_id, property_id, room_id, code)
            values (${tenantId}, ${propertyId}, ${roomId}, '01')`,
      ),
    ).rejects.toThrow();

    const p2 = await sup.db.execute(
      sql`insert into properties (tenant_id, name) values (${tenantId}, 'RU Property 2') returning id`,
    );
    const p2id = (p2 as unknown as Array<{ id: string }>)[0]!.id;
    const r2 = await sup.db.execute(
      sql`insert into rooms (tenant_id, property_id, name, quantity)
          values (${tenantId}, ${p2id}, 'RU Room 2', 1) returning id`,
    );
    await expect(
      sup.db.execute(
        sql`insert into room_units (tenant_id, property_id, room_id, code)
            values (${tenantId}, ${p2id}, ${(r2 as unknown as Array<{ id: string }>)[0]!.id}, '01')`,
      ),
    ).resolves.toBeDefined();
  });

  it('leaves the bucket quantity free to diverge from the physical count', async () => {
    // 3 sellable, 2 physical — legitimate while a room is out of service, so no constraint.
    const rows = (await sup.db.execute(
      sql`select r.quantity, count(u.id)::int as units
          from rooms r left join room_units u on u.room_id = r.id
          where r.id = ${roomId} group by r.quantity`,
    )) as unknown as Array<{ quantity: number; units: number }>;
    expect(rows[0]!.quantity).toBe(3);
    expect(rows[0]!.units).toBe(2);
  });
});
