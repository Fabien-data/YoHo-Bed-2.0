import { describe, expect, it } from 'vitest';
import { accessRule } from '../src/tenancy/hotel-access';

describe('custom hotel role route policy', () => {
  it('keeps financial rate paths more restrictive than room paths', () => {
    expect(accessRule('GET', '/rooms/00000000-0000-0000-0000-000000000001/rates')?.any).toContain(
      'financial_read',
    );
    expect(accessRule('POST', '/rooms/00000000-0000-0000-0000-000000000001/rates')?.any).toContain(
      'price_change',
    );
    expect(
      accessRule('GET', '/rooms/00000000-0000-0000-0000-000000000001/availability')?.any,
    ).toContain('reservation_read');
  });

  it('requires a property target on reservations and the timeline', () => {
    expect(accessRule('GET', '/reservations')?.resource).toBe('property');
    expect(accessRule('GET', '/reservation-groups')?.resource).toBe('property');
    expect(accessRule('GET', '/stayview')?.resource).toBe('property');
  });

  it('keeps unknown financial and owner recovery endpoints closed', () => {
    expect(accessRule('GET', '/folios')).toBeNull();
    expect(accessRule('GET', '/hotel-roles')).toBeNull();
    expect(accessRule('POST', '/properties')).toBeNull();
    expect(accessRule('POST', '/bookings/00000000-0000-0000-0000-000000000001/void')).toBeNull();
  });

  it('requires financial visibility for booking details and changed dates', () => {
    const id = '00000000-0000-0000-0000-000000000001';
    expect(accessRule('GET', `/bookings/${id}`)?.all).toContain('financial_read');
    expect(accessRule('POST', `/bookings/${id}/stay-change`)?.all).toContain('financial_read');
  });
});
