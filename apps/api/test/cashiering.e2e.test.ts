import { describe, it, expect, afterAll } from 'vitest';
import { makeTenant, request, openAndPrice, book, stopApp, type TenantFixture } from './harness';

afterAll(stopApp);

async function billedStay(fx: TenantFixture, from: string, to: string) {
  const created = await book(fx, { checkin: from, checkout: to });
  const posted = await request('POST', `/bookings/${created.body.id}/folio/post-room-charges`, {
    token: fx.token,
  });
  const folio = await request('GET', `/bookings/${created.body.id}/folio`, { token: fx.token });
  return { booking: created.body, folioId: posted.body.folioId, folio: folio.body };
}

describe('city ledger', () => {
  it('keeps a running balance without ever storing one', async () => {
    const fx = await makeTenant();
    const acc = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { type: 'travel_agent', code: 'AGT-1', name: 'Serendib Travel' },
    });
    expect(acc.status).toBe(201);

    await request('POST', `/ledger-accounts/${acc.body.id}/settle`, {
      token: fx.token,
      body: { amount: 500, description: 'Advance' },
    });

    const list = await request('GET', '/ledger-accounts', { token: fx.token });
    const row = list.body.find((a: any) => a.id === acc.body.id);
    // A credit with no debits leaves the account in advance — a negative balance.
    expect(Number(row.balance)).toBe(-500);
  });

  it('refuses a duplicate account code', async () => {
    const fx = await makeTenant();
    const body = { code: 'DUP', name: 'Acme Ltd' };
    await request('POST', '/ledger-accounts', { token: fx.token, body });
    const dup = await request('POST', '/ledger-accounts', { token: fx.token, body });
    expect(dup.status).toBe(409);
  });

  it('charges a folio to a company: the guest owes nothing, the company owes it all', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2032-01-01', '2032-01-31', { roomsToSell: 4 });
    const { booking, folioId, folio } = await billedStay(fx, '2032-01-10', '2032-01-13');
    const balance = Number(folio.totals.balance);
    expect(balance).toBeGreaterThan(0);

    const acc = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { type: 'company', code: 'CO-1', name: 'Ceylon Mills' },
    });

    const charged = await request('POST', `/folios/${folioId}/charge-to-ledger`, {
      token: fx.token,
      body: { ledgerAccountId: acc.body.id, amount: balance, reference: 'PO-4471' },
    });
    expect(charged.status).toBe(201);

    // The guest's bill is clear...
    const after = await request('GET', `/bookings/${booking.id}/folio`, { token: fx.token });
    expect(Number(after.body.totals.balance)).toBe(0);

    // ...and exactly the same money now sits on the company.
    const stmt = await request('GET', `/ledger-accounts/${acc.body.id}/statement`, {
      token: fx.token,
    });
    expect(Number(stmt.body.balance)).toBeCloseTo(balance, 2);
    expect(stmt.body.entries[0]).toMatchObject({ direction: 'debit', reference: 'PO-4471' });
  });

  it('enforces a credit limit, and treats zero as no limit', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2032-02-01', '2032-02-28', { roomsToSell: 4 });
    const { folioId, folio } = await billedStay(fx, '2032-02-10', '2032-02-13');
    const balance = Number(folio.totals.balance);

    const capped = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { code: 'CAP', name: 'Small Co', creditLimit: 100 },
    });
    const refused = await request('POST', `/folios/${folioId}/charge-to-ledger`, {
      token: fx.token,
      body: { ledgerAccountId: capped.body.id, amount: balance },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/credit limit/i);

    const uncapped = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { code: 'NOCAP', name: 'Big Co', creditLimit: 0 },
    });
    const allowed = await request('POST', `/folios/${folioId}/charge-to-ledger`, {
      token: fx.token,
      body: { ledgerAccountId: uncapped.body.id, amount: balance },
    });
    expect(allowed.status).toBe(201);
  });

  it('settles the account and brings the balance back to zero', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2032-03-01', '2032-03-28', { roomsToSell: 4 });
    const { folioId, folio } = await billedStay(fx, '2032-03-10', '2032-03-13');
    const balance = Number(folio.totals.balance);

    const acc = await request('POST', '/ledger-accounts', {
      token: fx.token,
      body: { code: 'SETTLE', name: 'Pays Up Ltd' },
    });
    await request('POST', `/folios/${folioId}/charge-to-ledger`, {
      token: fx.token,
      body: { ledgerAccountId: acc.body.id, amount: balance },
    });
    await request('POST', `/ledger-accounts/${acc.body.id}/settle`, {
      token: fx.token,
      body: { amount: balance, reference: 'BANK-991' },
    });

    const stmt = await request('GET', `/ledger-accounts/${acc.body.id}/statement`, {
      token: fx.token,
    });
    expect(Number(stmt.body.balance)).toBe(0);
    expect(stmt.body.entries).toHaveLength(2);
  });
});

describe('business sources', () => {
  // Every tenant is seeded with its country's sources (BDC, AGD …), so these use a code no preset
  // carries. The full behaviour lives in configuration.e2e.test.ts.
  it('creates a colour-coded source and refuses a duplicate code', async () => {
    const fx = await makeTenant();
    const created = await request('POST', '/business-sources', {
      token: fx.token,
      body: { shortCode: 'HBD', name: 'Hotelbeds', color: '#003580' },
    });
    expect(created.status).toBe(201);
    expect(created.body.color).toBe('#003580');

    const dup = await request('POST', '/business-sources', {
      token: fx.token,
      body: { shortCode: 'hbd', name: 'Something else' },
    });
    expect(dup.status).toBe(409);
  });

  it('rejects a colour that is not a hex value', async () => {
    const fx = await makeTenant();
    const res = await request('POST', '/business-sources', {
      token: fx.token,
      body: { shortCode: 'X', name: 'Bad colour', color: 'blue' },
    });
    expect(res.status).toBe(400);
  });
});

describe('cash drawers', () => {
  async function drawer(fx: TenantFixture) {
    const d = await request('POST', `/properties/${fx.propertyId}/drawers`, {
      token: fx.token,
      body: { name: 'Front desk' },
    });
    return d.body.id as string;
  }

  it('allows only one open shift per till', async () => {
    const fx = await makeTenant();
    const id = await drawer(fx);

    const first = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 5000 },
    });
    expect(first.status).toBe(201);

    const second = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 5000 },
    });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/open shift/i);
  });

  it('reports which till currently has an open shift', async () => {
    // Regression: this and the ledger balance are correlated subqueries in the projection of a
    // single-table select, where Drizzle renders the outer column UNQUALIFIED. Postgres then
    // resolves it against the inner table, so the subquery silently returns nothing — no error,
    // just a permanently empty answer.
    const fx = await makeTenant();
    const id = await drawer(fx);

    const before = await request('GET', `/properties/${fx.propertyId}/drawers`, {
      token: fx.token,
    });
    expect(before.body.find((d: any) => d.id === id).openSessionId).toBeNull();

    const session = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 0 },
    });

    const during = await request('GET', `/properties/${fx.propertyId}/drawers`, {
      token: fx.token,
    });
    expect(during.body.find((d: any) => d.id === id).openSessionId).toBe(session.body.id);

    await request('POST', `/drawer-sessions/${session.body.id}/close`, {
      token: fx.token,
      body: { declaredTotal: 0 },
    });
    const after = await request('GET', `/properties/${fx.propertyId}/drawers`, {
      token: fx.token,
    });
    expect(after.body.find((d: any) => d.id === id).openSessionId).toBeNull();
  });

  it('counts cash into the expected total but not card payments', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2032-04-01', '2032-04-28', { roomsToSell: 4 });
    const id = await drawer(fx);
    const session = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 5000 },
    });

    const { folioId } = await billedStay(fx, '2032-04-10', '2032-04-12');
    // Two payments on the same shift: one cash, one card.
    await request('POST', `/folios/${folioId}/payments`, {
      token: fx.token,
      body: { amount: 3000, method: 'cash', drawerSessionId: session.body.id },
    });
    await request('POST', `/folios/${folioId}/payments`, {
      token: fx.token,
      body: { amount: 9000, method: 'card', drawerSessionId: session.body.id },
    });

    const report = await request('GET', `/drawer-sessions/${session.body.id}/report`, {
      token: fx.token,
    });
    expect(report.status).toBe(200);
    // A card payment never entered the till, so only the cash counts toward what should be in it.
    expect(Number(report.body.totals.cashTaken)).toBe(3000);
    expect(Number(report.body.totals.expected)).toBe(8000);
    expect(Number(report.body.totals.allPaymentsTaken)).toBe(12000);
  });

  it('takes expenses out of the till and reports the variance at close', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2032-05-01', '2032-05-28', { roomsToSell: 4 });
    const id = await drawer(fx);
    const session = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 5000 },
    });

    const { folioId } = await billedStay(fx, '2032-05-10', '2032-05-12');
    await request('POST', `/folios/${folioId}/payments`, {
      token: fx.token,
      body: { amount: 4000, method: 'cash', drawerSessionId: session.body.id },
    });
    const expense = await request('POST', `/properties/${fx.propertyId}/expenses`, {
      token: fx.token,
      body: {
        drawerSessionId: session.body.id,
        category: 'supplies',
        payee: 'Corner shop',
        amount: 1500,
      },
    });
    expect(expense.status).toBe(201);
    expect(expense.body.voucherNo).toBe('EV-00001');

    // 5000 float + 4000 cash − 1500 spent = 7500 expected.
    const closed = await request('POST', `/drawer-sessions/${session.body.id}/close`, {
      token: fx.token,
      body: { declaredTotal: 7400, notes: 'Counted twice' },
    });
    expect(closed.status).toBe(200);
    expect(Number(closed.body.expectedTotal)).toBe(7500);
    expect(Number(closed.body.declaredTotal)).toBe(7400);
    expect(Number(closed.body.variance)).toBe(-100);
  });

  it('freezes the closed figures instead of recomputing them later', async () => {
    const fx = await makeTenant({ roomQuantity: 4 });
    await openAndPrice(fx, '2032-06-01', '2032-06-28', { roomsToSell: 4 });
    const id = await drawer(fx);
    const session = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 1000 },
    });
    const closed = await request('POST', `/drawer-sessions/${session.body.id}/close`, {
      token: fx.token,
      body: { declaredTotal: 1000 },
    });
    expect(Number(closed.body.variance)).toBe(0);

    const report = await request('GET', `/drawer-sessions/${session.body.id}/report`, {
      token: fx.token,
    });
    expect(Number(report.body.totals.declared)).toBe(1000);
    expect(Number(report.body.totals.variance)).toBe(0);

    const again = await request('POST', `/drawer-sessions/${session.body.id}/close`, {
      token: fx.token,
      body: { declaredTotal: 999 },
    });
    expect(again.status).toBe(400);
  });

  it('refuses an expense against a closed shift', async () => {
    const fx = await makeTenant();
    const id = await drawer(fx);
    const session = await request('POST', `/drawers/${id}/open`, {
      token: fx.token,
      body: { openingFloat: 0 },
    });
    await request('POST', `/drawer-sessions/${session.body.id}/close`, {
      token: fx.token,
      body: { declaredTotal: 0 },
    });

    const res = await request('POST', `/properties/${fx.propertyId}/expenses`, {
      token: fx.token,
      body: { drawerSessionId: session.body.id, payee: 'Too late', amount: 10 },
    });
    expect(res.status).toBe(400);
  });
});

describe('cashiering entitlement', () => {
  it('is withheld from Starter but not from Pro', async () => {
    const starter = await makeTenant({ plan: 'starter' });
    const denied = await request('GET', '/ledger-accounts', { token: starter.token });
    expect(denied.status).toBe(403);

    const pro = await makeTenant({ plan: 'pro' });
    const allowed = await request('GET', '/ledger-accounts', { token: pro.token });
    expect(allowed.status).toBe(200);
  });
});
