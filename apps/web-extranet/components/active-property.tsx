'use client';

import * as React from 'react';
import { useProperties } from '@/lib/queries';

const PROPERTY_KEY = 'yhb_property_id';

interface ActivePropertyState {
  storedId: string | null;
  switchProperty: (id: string) => void;
}

const ActivePropertyContext = React.createContext<ActivePropertyState | null>(null);

/**
 * The single source of truth for "which property is the user working on". The header switcher
 * writes here, and every property-scoped screen reads here — a switcher that only changes its own
 * label while Stay View, Cashiering and Night Audit keep operating on the first property is silent
 * cross-property corruption, not a cosmetic bug.
 */
export function ActivePropertyProvider({ children }: { children: React.ReactNode }) {
  const [storedId, setStoredId] = React.useState<string | null>(null);

  // Restore the persisted choice after mount (SSR renders the default).
  React.useEffect(() => {
    try {
      setStoredId(localStorage.getItem(PROPERTY_KEY));
    } catch {
      // storage unavailable — the first property stands
    }
  }, []);

  const switchProperty = React.useCallback((id: string) => {
    setStoredId(id);
    try {
      localStorage.setItem(PROPERTY_KEY, id);
    } catch {
      // choice just won't persist
    }
  }, []);

  const value = React.useMemo(() => ({ storedId, switchProperty }), [storedId, switchProperty]);
  return <ActivePropertyContext.Provider value={value}>{children}</ActivePropertyContext.Provider>;
}

/**
 * The active property, validated against the tenant's list (a stale stored id — e.g. a deleted
 * property — falls back to the first property rather than scoping every query to nothing).
 */
export function useActiveProperty() {
  const ctx = React.useContext(ActivePropertyContext);
  const { data: properties } = useProperties();
  const property = properties?.find((p) => p.id === ctx?.storedId) ?? properties?.[0];
  return {
    property,
    propertyId: property?.id,
    properties,
    switchProperty: ctx?.switchProperty ?? (() => undefined),
  };
}
