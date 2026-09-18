import { describe, expect, it } from 'vitest';
import { holdKindFor, kindAfterApproval } from '../src/reservation-kinds';
import { audienceAllows, residencyFor } from '../src/residency';
import { resolveReservationOptions } from '../src/reservation-options';

describe('kind transitions', () => {
  it('approves an unconfirmed booking into the right kind', () => {
    expect(kindAfterApproval('hold_unconfirm', true)).toBe('hold_confirm');
    expect(kindAfterApproval('hold_unconfirm', false)).toBe('confirm');
    expect(kindAfterApproval('inquiry', false)).toBe('confirm');
    expect(kindAfterApproval('online_failed', true)).toBe('confirm');
    expect(kindAfterApproval('confirm', false)).toBe('confirm');
  });

  it('never un-confirms a booking by putting it on hold', () => {
    expect(holdKindFor('confirm', undefined)).toBe('hold_confirm');
    expect(holdKindFor('confirm', 'hold_unconfirm')).toBeNull();
    expect(holdKindFor('hold_confirm', 'hold_confirm')).toBe('hold_confirm');
    expect(holdKindFor('inquiry', undefined)).toBe('hold_unconfirm');
    expect(holdKindFor('inquiry', 'hold_confirm')).toBe('hold_confirm');
    expect(holdKindFor('hold_unconfirm', undefined)).toBe('hold_unconfirm');
  });
});

describe('residency', () => {
  it('suggests local for a citizen of the property country', () => {
    expect(residencyFor('lk', 'LK')).toBe('local');
    expect(residencyFor('GB', 'LK')).toBe('foreign');
    expect(residencyFor(null, 'LK')).toBeNull();
    expect(residencyFor('IN', null)).toBeNull();
  });

  it('opens local and foreign rates only to a matching, known residency', () => {
    expect(audienceAllows('all', null)).toBe(true);
    expect(audienceAllows('local', 'local')).toBe(true);
    expect(audienceAllows('local', 'foreign')).toBe(false);
    expect(audienceAllows('foreign', null)).toBe(false);
  });
});

describe('resolveReservationOptions', () => {
  it('fills defaults and cleans the voucher addresses', () => {
    const o = resolveReservationOptions({
      emailVoucher: true,
      voucherEmails: ['Agent@Example.com', 'agent@example.com', 'not-an-email', 42],
      guestPortalAccess: 'yes',
      checkoutTemplate: '  checkout_thank_you ',
    });
    expect(o.emailVoucher).toBe(true);
    expect(o.voucherEmails).toEqual(['agent@example.com']);
    expect(o.guestPortalAccess).toBe(false);
    expect(o.checkoutTemplate).toBe('checkout_thank_you');
    expect(o.suppressRateOnGrCard).toBe(false);
  });

  it('survives garbage', () => {
    expect(resolveReservationOptions(null).voucherEmails).toEqual([]);
    expect(resolveReservationOptions('x').emailVoucher).toBe(false);
  });
});
