'use client';

import { useQueryClient } from '@tanstack/react-query';

/**
 * Every screen a front-desk action shows on. A check-in changes the tape chart, the room cards,
 * the lists, the dashboard and the bill at once — refresh them together, so no screen is left
 * telling a different story (UX-STANDARD principle 3).
 */
const DESK_KEYS = [
  'reservations',
  'reservation-groups',
  'stayview',
  'dashboard',
  'booking-extras',
  'folio',
  'folios',
  'room-view',
  'house-summary',
  'check-in-preview',
  'check-out-preview',
  'invoices',
  'drawer-sessions',
];

export function useRefreshDesk() {
  const qc = useQueryClient();
  return () => {
    for (const key of DESK_KEYS) qc.invalidateQueries({ queryKey: [key] });
  };
}
