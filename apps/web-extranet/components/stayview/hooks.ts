'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHotelAccess, getUser, type HotelPermission } from '@/lib/api';
import {
  DEFAULT_PREFERENCES,
  legacyPreferencesKey,
  parsePreferences,
  preferencesKey,
  type CalendarPreferences,
} from './model/prefs';

/**
 * What the signed-in person may do. `null` permissions is an owner or legacy staff member (the
 * server allows them everything the screen offers); a hotel-created role gets its list. Hiding a
 * control is only a courtesy — the server refuses anything a role may not do.
 */
export function useCalendarAccess() {
  const access = useQuery({
    queryKey: ['hotel-access'],
    queryFn: getHotelAccess,
    staleTime: 30_000,
  });
  const permissions = access.data ? access.data.permissions : undefined;
  const can = React.useCallback(
    (...need: HotelPermission[]) =>
      permissions !== undefined &&
      (permissions === null || need.every((p) => permissions.includes(p))),
    [permissions],
  );
  return { ready: permissions !== undefined, permissions: permissions ?? null, can };
}

function read(key: string): unknown {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

/**
 * The person's calendar settings for this property, on this browser. `loaded` turns true once
 * storage has been read, so the first request already uses their window size.
 */
export function useCalendarPreferences(propertyId?: string) {
  const [preferences, setPreferences] = React.useState<CalendarPreferences>(DEFAULT_PREFERENCES);
  const [key, setKey] = React.useState('');
  const [loaded, setLoaded] = React.useState(false);
  const [storageError, setStorageError] = React.useState(false);

  React.useEffect(() => {
    const user = getUser();
    if (!propertyId || !user) return;
    const k = preferencesKey(user.id, propertyId);
    setKey(k);
    try {
      const stored = read(k) ?? read(legacyPreferencesKey(user.id, propertyId));
      setPreferences(parsePreferences(stored));
    } catch {
      setStorageError(true);
      setPreferences(DEFAULT_PREFERENCES);
    }
    setLoaded(true);
  }, [propertyId]);

  const update = React.useCallback(
    (patch: Partial<CalendarPreferences>) => {
      setPreferences((previous) => {
        const next = { ...previous, ...patch };
        try {
          if (key) localStorage.setItem(key, JSON.stringify(next));
          setStorageError(false);
        } catch {
          setStorageError(true);
        }
        return next;
      });
    },
    [key],
  );
  const reset = React.useCallback(() => update(DEFAULT_PREFERENCES), [update]);
  return { preferences, update, reset, loaded, storageError, storageKey: key };
}

/** Folded room groups, remembered for the session. */
export function useCollapsedGroups(storageKey: string) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());
  React.useEffect(() => {
    if (!storageKey) return;
    try {
      setCollapsed(new Set(JSON.parse(sessionStorage.getItem(`${storageKey}:groups`) ?? '[]')));
    } catch {
      setCollapsed(new Set());
    }
  }, [storageKey]);
  const save = React.useCallback(
    (next: ReadonlySet<string>) => {
      setCollapsed(next);
      try {
        if (storageKey) sessionStorage.setItem(`${storageKey}:groups`, JSON.stringify([...next]));
      } catch {
        /* Folding still works for this visit without storage. */
      }
    },
    [storageKey],
  );
  return { collapsed, setCollapsed: save };
}
