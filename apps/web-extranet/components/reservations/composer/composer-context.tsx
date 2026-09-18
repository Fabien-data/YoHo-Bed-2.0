'use client';

import * as React from 'react';
import type { ReservationCreated } from '@/lib/api';
import type { Prefill } from './draft';
import { QuickReservationSheet } from './quick-reservation';

interface ComposerApi {
  /** Open the Quick Reservation, optionally with a date, room type or room already chosen. */
  openComposer: (prefill?: Prefill) => void;
  /** Be told whenever a reservation is saved — for screens that keep their own lists. */
  onReservationCreated: (fn: (r: ReservationCreated) => void) => () => void;
}

const ComposerContext = React.createContext<ComposerApi | null>(null);

/**
 * One Quick Reservation for the whole app (Development Phase 02). Mounted once inside the shell,
 * so the header's quick action, the command palette, a double-click on Stay View and a vacant
 * room in Room View all open the same sheet — and nothing is lost by navigating while it is open.
 */
export function ReservationComposerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<Prefill | null>(null);
  const listeners = React.useRef(new Set<(r: ReservationCreated) => void>());

  const api = React.useMemo<ComposerApi>(
    () => ({
      openComposer: (p) => {
        setPrefill(p ?? null);
        setOpen(true);
      },
      onReservationCreated: (fn) => {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
    }),
    [],
  );

  return (
    <ComposerContext.Provider value={api}>
      {children}
      <QuickReservationSheet
        open={open}
        prefill={prefill}
        onOpenChange={setOpen}
        onCreated={(r) => listeners.current.forEach((fn) => fn(r))}
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
