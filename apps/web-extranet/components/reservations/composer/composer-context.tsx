'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import type { ReservationCreated } from '@/lib/api';
import type { Draft, Prefill } from './draft';
import { QuickReservationSheet } from './quick-reservation';

interface ComposerApi {
  /** Open the Quick Reservation, optionally with a date, room type or room already chosen. */
  openComposer: (prefill?: Prefill) => void;
  /** Open the full Add Reservation page, optionally prefilled the same way. */
  openFullPage: (prefill?: Prefill) => void;
  /** Be told whenever a reservation is saved — for screens that keep their own lists. */
  onReservationCreated: (fn: (r: ReservationCreated) => void) => () => void;
  /**
   * The Quick Reservation draft "More Options" handed over, once. The full page takes it on
   * mount; a reload of the page starts fresh.
   */
  takeHandoff: () => Draft | null;
}

const ComposerContext = React.createContext<ComposerApi | null>(null);

function fullPageHref(prefill?: Prefill) {
  const q = new URLSearchParams();
  if (prefill?.checkin) q.set('checkin', prefill.checkin);
  if (prefill?.nights) q.set('nights', String(prefill.nights));
  if (prefill?.roomId) q.set('roomId', prefill.roomId);
  if (prefill?.roomUnitId) q.set('roomUnitId', prefill.roomUnitId);
  const qs = q.toString();
  return `/app/reservations/new${qs ? `?${qs}` : ''}`;
}

/**
 * One Quick Reservation for the whole app (Development Phase 02). Mounted once inside the shell,
 * so the header's quick action, the command palette, a double-click on Stay View and a vacant
 * room in Room View all open the same sheet — and nothing is lost by navigating while it is open.
 * "More Options" carries the sheet's draft to the full page through here.
 */
export function ReservationComposerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<Prefill | null>(null);
  const listeners = React.useRef(new Set<(r: ReservationCreated) => void>());
  const handoff = React.useRef<Draft | null>(null);

  const api = React.useMemo<ComposerApi>(
    () => ({
      openComposer: (p) => {
        setPrefill(p ?? null);
        setOpen(true);
      },
      openFullPage: (p) => router.push(fullPageHref(p)),
      onReservationCreated: (fn) => {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
      takeHandoff: () => {
        const d = handoff.current;
        // Cleared on the next tick, not now: React's development double-run of the full page's
        // mount effect must see the same draft twice, or the second mount starts blank.
        if (d) setTimeout(() => (handoff.current = null), 0);
        return d;
      },
    }),
    [router],
  );

  return (
    <ComposerContext.Provider value={api}>
      {children}
      <QuickReservationSheet
        open={open}
        prefill={prefill}
        onOpenChange={setOpen}
        onCreated={(r) => listeners.current.forEach((fn) => fn(r))}
        onMoreOptions={(draft) => {
          handoff.current = draft;
          router.push('/app/reservations/new');
        }}
      />
    </ComposerContext.Provider>
  );
}

export function useReservationComposer(): ComposerApi {
  const ctx = React.useContext(ComposerContext);
  if (!ctx)
    throw new Error('useReservationComposer must be used inside ReservationComposerProvider');
  return ctx;
}

/** Run `fn` whenever a reservation is saved from the composer. */
export function useOnReservationCreated(fn: (r: ReservationCreated) => void) {
  const { onReservationCreated } = useReservationComposer();
  const latest = React.useRef(fn);
  latest.current = fn;
  React.useEffect(() => onReservationCreated((r) => latest.current(r)), [onReservationCreated]);
}
