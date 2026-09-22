import { describe, it, expect, afterAll } from 'vitest';
import { addDeskUser, makeTenant, request, stopApp } from './harness';

/**
 * Where the hotel's money goes is the owner's decision alone. Desk staff once could read and
 * replace the payout bank account and accept the platform agreement on the owner's behalf.
 */

afterAll(stopApp);

const account = {
  bankName: 'Commercial Bank of Ceylon',
  accountName: 'Owner Holdings',
  accountNumber: '8001234567',
};

describe('profile — owner-only money settings', () => {
  it('lets the owner set the payout account and read it back', async () => {
    const fx = await makeTenant();
    const put = await request('PUT', '/profile/payout-account', { token: fx.token, body: account });
    expect(put.status).toBe(200);

    const me = await request('GET', '/profile', { token: fx.token });
    expect(me.status).toBe(200);
    expect(me.body.payoutAccount.accountNumber).toBe(account.accountNumber);
  });

  it('refuses desk staff who try to change the payout account or accept the agreement', async () => {
    const fx = await makeTenant();
    await request('PUT', '/profile/payout-account', { token: fx.token, body: account });
    const desk = await addDeskUser(fx);

    const put = await request('PUT', '/profile/payout-account', {
      token: desk.token,
      body: { ...account, accountNumber: '9999999999' },
    });
    expect(put.status).toBe(403);

    const accept = await request('POST', '/profile/agreement/accept', { token: desk.token });
    expect(accept.status).toBe(403);

    const owner = await request('GET', '/profile', { token: fx.token });
    expect(owner.body.payoutAccount.accountNumber).toBe(account.accountNumber);
  });

  it('never shows the bank details to desk staff', async () => {
    const fx = await makeTenant();
    await request('PUT', '/profile/payout-account', { token: fx.token, body: account });
    const desk = await addDeskUser(fx);

    const me = await request('GET', '/profile', { token: desk.token });
    expect(me.status).toBe(200);
    expect(me.body.payoutAccount).toBeNull();
    expect(me.body.tenant.id).toBe(fx.tenantId);
  });
});
