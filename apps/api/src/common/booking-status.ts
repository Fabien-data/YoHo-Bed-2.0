/**
 * Statuses that count as confirmed revenue. Compartment G added CheckedIn/CheckedOut — a guest
 * who has arrived is more confirmed than one who merely holds an approved booking, so every
 * revenue path (settlement, dashboard, customer spend) must treat all three alike.
 *
 * Shared because it was drifting across finance/dashboard/customers; adding a status should be a
 * one-line change here, not a hunt.
 */
export const CONFIRMED_STATUSES = ['Approved', 'CheckedIn', 'CheckedOut'] as const;

export type ConfirmedStatus = (typeof CONFIRMED_STATUSES)[number];

export function isConfirmedStatus(status: string): boolean {
  return (CONFIRMED_STATUSES as readonly string[]).includes(status);
}
