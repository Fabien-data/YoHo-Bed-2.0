import { afterAll, describe, expect, it } from 'vitest';
import { media } from '@yohobed/db';
import { admin, makeTenant, openAndPrice, book, request, stopApp } from './harness';

afterAll(stopApp);

/**
 * Tenant isolation over the real HTTP surface. `packages/db` proves RLS at the database level;
 * this proves the API can't leak across tenants either — including by explicit id lookup.
 */
describe('tenant isolation (API surface)', () => {
  it('never shows one tenant another tenant’s properties, rooms or bookings', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await openAndPrice(a, '2027-03-01', '2027-03-10');
    const created = await book(a, { checkin: '2027-03-02', checkout: '2027-03-04' });
    expect(created.status).toBe(201);

    const aProps = await request('GET', '/properties', { token: a.token });
    expect(aProps.body.map((p: any) => p.id)).toEqual([a.propertyId]);

    const bProps = await request('GET', '/properties', { token: b.token });
    expect(bProps.body.map((p: any) => p.id)).toEqual([b.propertyId]);

    const bRooms = await request('GET', '/rooms', { token: b.token });
    expect(bRooms.body.some((r: any) => r.id === a.roomId)).toBe(false);

    const bBookings = await request('GET', '/bookings', { token: b.token });
    expect(bBookings.body.some((x: any) => x.id === created.body.id)).toBe(false);
  });

  it('404s when a tenant fetches another tenant’s booking by id', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await openAndPrice(a, '2027-03-01', '2027-03-10');
    const created = await book(a, { checkin: '2027-03-05', checkout: '2027-03-06' });

    expect((await request('GET', `/bookings/${created.body.id}`, { token: a.token })).status).toBe(
      200,
    );
    expect((await request('GET', `/bookings/${created.body.id}`, { token: b.token })).status).toBe(
      404,
    );
  });

  it('refuses to book another tenant’s room', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    await openAndPrice(a, '2027-03-01', '2027-03-10');

    const res = await request('POST', '/bookings', {
      token: b.token,
      body: {
        roomId: a.roomId,
        occupancyId: a.occupancyId,
        customerName: 'Cross Tenant',
        checkin: '2027-03-02',
        checkout: '2027-03-03',
      },
    });
    expect(res.status).toBe(404); // RLS hides the occupancy entirely
  });

  /**
   * 2026-08-28 audit: `media` carries a permissive public-read policy (for <img> serving), and
   * Postgres ORs permissive policies — so unlike every other table, SELECTs on media are NOT
   * fenced by RLS. The service must therefore filter on tenant_id explicitly; without that,
   * DELETE /photos/:id found another tenant's row and destroyed their file on disk.
   */
  it('cannot read or delete another tenant’s photos by id', async () => {
    const a = await makeTenant();
    const b = await makeTenant();

    const [bPhoto] = await admin()
      .insert(media)
      .values({
        tenantId: b.tenantId,
        propertyId: b.propertyId,
        storageKey: `e2e-cross-tenant-${Date.now()}.jpg`,
        originalName: 'pool.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        sortOrder: 0,
      })
      .returning();

    // Listing another tenant's property photos returns nothing.
    const listed = await request('GET', `/properties/${b.propertyId}/photos`, { token: a.token });
    expect(listed.body.some?.((p: any) => p.id === bPhoto!.id)).not.toBe(true);

    // Deleting by id 404s, and the row survives.
    const del = await request('DELETE', `/photos/${bPhoto!.id}`, { token: a.token });
    expect(del.status).toBe(404);
    const owner = await request('GET', `/properties/${b.propertyId}/photos`, { token: b.token });
    expect(owner.body.map((p: any) => p.id)).toContain(bPhoto!.id);
  });
});
