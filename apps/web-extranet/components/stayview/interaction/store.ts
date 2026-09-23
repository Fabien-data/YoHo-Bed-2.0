'use client';

import * as React from 'react';
import type { StayBar } from '@/lib/api';

/**
 * Everything that changes as the pointer moves — hover, a range being selected, a drag — lives
 * here, outside React props. Only the overlay components subscribe, each to the one field it
 * draws, so moving the mouse across a 200-room house re-renders a ghost, never a row.
 */

/** Empty nights selected on one room: columns `start`..`end`, inclusive, either order. */
export interface RangeSelection {
  unitId: string;
  start: number;
  end: number;
  /** True once the pointer is released: the action bar may open. */
  done: boolean;
}

export interface DragState {
  bar: StayBar;
  mode: 'move' | 'resize';
  /** The axis the gesture committed to: rooms (y) or dates (x). */
  axis: 'x' | 'y' | null;
  originUnitId: string | null;
  /** Where the bar would land. */
  unitId: string | null;
  from: string;
  to: string;
  /** Why it cannot land there, or null. */
  issue: string | null;
}

export interface HoverState {
  bar: StayBar;
  rect: { left: number; top: number; width: number; height: number };
}

export interface InteractionState {
  hover: HoverState | null;
  range: RangeSelection | null;
  drag: DragState | null;
}

type Listener = () => void;

export function createInteractionStore() {
  let state: InteractionState = { hover: null, range: null, drag: null };
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<InteractionState>) {
      const next = { ...state, ...patch };
      if (next.hover === state.hover && next.range === state.range && next.drag === state.drag)
        return;
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type InteractionStore = ReturnType<typeof createInteractionStore>;

export const InteractionContext = React.createContext<InteractionStore | null>(null);

export function useInteractionStore(): InteractionStore {
  const store = React.useContext(InteractionContext);
  if (!store) throw new Error('useInteractionStore needs <InteractionContext.Provider>');
  return store;
}

/** Subscribe to one slice. The selector must return a stable value (a field, not a new object). */
export function useInteraction<T>(selector: (s: InteractionState) => T): T {
  const store = useInteractionStore();
  return React.useSyncExternalStore(
    store.subscribe,
    () => selector(store.get()),
    () => selector(store.get()),
  );
}
