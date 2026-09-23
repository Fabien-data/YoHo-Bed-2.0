'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getHotelAccess, getUser, type HotelPermission } from '@/lib/api';
import { DEFAULT_PREFERENCES, parsePreferences, type CalendarPreferences } from './calendar-model';

export function useCalendarAccess() {
  const access = useQuery({
    queryKey: ['hotel-access'],
    queryFn: getHotelAccess,
    staleTime: 15000,
    refetchInterval: 30000,
  });
  const can = (...permissions: HotelPermission[]) =>
    !!access.data &&
    permissions.every(
      (permission) =>
        access.data.permissions === null || access.data.permissions.includes(permission),
    );
  return { can, legacy: !!access.data && access.data.permissions === null };
}
export function useCalendarPreferences(propertyId?: string) {
  const [preferences, setPreferences] = React.useState(DEFAULT_PREFERENCES);
  const [key, setKey] = React.useState('');
  const [storageError, setStorageError] = React.useState(false);
  React.useEffect(() => {
    const user = getUser();
    if (!propertyId || !user) return;
    const storageKey = `yoho-calendar:v1:${user.id}:${propertyId}`;
    setKey(storageKey);
    try {
      setPreferences(parsePreferences(JSON.parse(localStorage.getItem(storageKey) ?? 'null')));
    } catch {
      setStorageError(true);
      setPreferences(DEFAULT_PREFERENCES);
    }
  }, [propertyId]);
  const update = React.useCallback(
    (patch: Partial<CalendarPreferences>) => {
      setPreferences((previous) => {
        const next = { ...previous, ...patch };
        try {
          if (key) localStorage.setItem(key, JSON.stringify(next));
        } catch {
          setStorageError(true);
        }
        return next;
      });
    },
    [key],
  );
  return { preferences, update, storageKey: key, storageError };
}
