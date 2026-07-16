import { afterAll, describe, expect, it } from 'vitest';
import { makeTenant, openAndPrice, book, request, stopApp } from './harness';

afterAll(stopApp);

/** The money must reconcile to the cent — the Phase 7 exit criterion, guarded permanently. */
describe('finance & settlement', () => {
  it('splits an approved booking into base + yoho + ota that sums back to gross', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2029-01-01', '2029-01-10', { base: 18000 });
    const b = await book(fx, { checkin: '2029-01-02', checkout: '2029-01-04' }); // 2 nights
    await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token });

    const st = await request(
      'GET',
      `/finance/payout-statement?propertyId=${fx.propertyId}&from=2029-01-01&to=2029-01-31`,
      { token: fx.token },
    );
    expect(st.status).toBe(200);

    const { grossSelling, propertyBase, yohoCommission, otaCommission, taxes } = st.body;
    expect(grossSelling).toBeCloseTo(48780.5, 2);
    expect(propertyBase).toBeCloseTo(36000, 2); // 2 × 18000
    // The invariant: nothing appears or disappears in the split.
    expect(propertyBase + yohoCommission + otaCommission + taxes).toBeCloseTo(grossSelling, 2);
  });

  it('excludes cancelled bookings from revenue but counts checked-out ones', async () => {
    const fx = await makeTenant({ roomQuantity: 5 });
    await openAndPrice(fx, '2029-02-01', '2029-02-15', { base: 18000, roomsToSell: 5 });

    const kept = await book(fx, { checkin: '2029-02-02', checkout: '2029-02-03' });
    await request('POST', `/bookings/${kept.body.id}/approve`, { token: fx.token });
    await request('POST', `/bookings/${kept.body.id}/check-in`, { token: fx.token });
    await request('POST', `/bookings/${kept.body.id}/check-out`, { token: fx.token });

    const dropped = await book(fx, { checkin: '2029-02-05', checkout: '2029-02-06' });
    await request('POST', `/bookings/${dropped.body.id}/cancel`, { token: fx.token });

    const rev = await request('GET', '/finance/revenue?from=2029-02-01&to=2029-02-28', {
      token: fx.token,
    });
    expect(rev.status).toBe(200);
    // One night of confirmed revenue; the cancelled stay contributes nothing.
    expect(rev.body.approvedGross).toBeCloseTo(24390.25, 2);
    expect(rev.body.byStatus.Cancelled?.count ?? 0).toBe(1);
  });

  it('invoices a booking idempotently and marks it paid on full payment', async () => {
    const fx = await makeTenant();
    await openAndPrice(fx, '2029-03-01', '2029-03-10', { base: 18000 });
    const b = await book(fx, { checkin: '2029-03-02', checkout: '2029-03-03' });
    await request('POST', `/bookings/${b.body.id}/approve`, { token: fx.token });

    const inv1 = await request('POST', `/bookings/${b.body.id}/invoice`, { token: fx.token });
    const inv2 = await request('POST', `/bookings/${b.body.id}/invoice`, { token: fx.token });
    expect(inv1.body.id).toBe(inv2.body.id); // idempotent, not a second invoice
    expect(inv1.body.number).toBe(`INV-${b.body.reference}`);

    await request('POST', `/bookings/${b.body.id}/payments`, {
      token: fx.token,
      body: { amount: Number(b.body.amount), direction: 'received', method: 'card' },
    });
    const after = await request('GET', `/invoices/${inv1.body.id}`, { token: fx.token });
    expect(after.body.status).toBe('paid');
  });
});
