/**
 * The old Configuration tabs (`/app/configuration?tab=`) mapped to their sections, so every
 * bookmark, help link and test that used them still lands in the right place. Kept free of any
 * component import so the server-side redirect can use it.
 */
export const LEGACY_TABS: Record<string, string> = {
  property: 'profile',
  reservations: 'reservation-settings',
  taxes: 'taxes',
  charges: 'extra-charges',
  sources: 'business-sources',
  segments: 'market-segments',
  payments: 'payment-methods',
  sales: 'sales-persons',
  transport: 'transport',
};
