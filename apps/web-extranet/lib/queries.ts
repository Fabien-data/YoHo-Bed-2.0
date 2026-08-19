'use client';

import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import {
  getEntitlements,
  getTenantPlan,
  listPlans,
  listProperties,
  getProfile,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  type Entitlements,
} from './api';

/**
 * Typed React Query hooks over `lib/api.ts`.
 *
 * `lib/api.ts` stays the single transport — this layer only adds caching, deduplication and
 * invalidation. Keeping the two separate means the fetch functions remain callable from
 * anywhere (tests, event handlers, non-React code) rather than being trapped behind hooks.
 *
 * Query keys are arrays with a stable first segment, so a whole family can be invalidated at
 * once: `qc.invalidateQueries({ queryKey: ['notifications'] })`.
 */

export const queryKeys = {
  entitlements: ['billing', 'entitlements'] as const,
  plan: ['billing', 'plan'] as const,
  plans: ['billing', 'plans'] as const,
  properties: ['properties'] as const,
  profile: ['profile'] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
};

// --- Entitlements ------------------------------------------------------------

/**
 * What the tenant's subscription allows. Cached for five minutes: a plan change is rare and
 * staff-initiated, and re-fetching it on every navigation would triple the shell's requests.
 */
export function useEntitlements(options?: Partial<UseQueryOptions<Entitlements>>) {
  return useQuery({
    queryKey: queryKeys.entitlements,
    queryFn: getEntitlements,
    staleTime: 5 * 60_000,
    ...options,
  });
}

/** Convenience: is one feature on? Returns `false` while loading, so UI never flashes on then off. */
export function useHasFeature(feature: string): boolean {
  const { data } = useEntitlements();
  return data?.features[feature] ?? false;
}

export function useTenantPlan() {
  return useQuery({ queryKey: queryKeys.plan, queryFn: getTenantPlan, staleTime: 5 * 60_000 });
}

export function usePlanCatalogue() {
  return useQuery({ queryKey: queryKeys.plans, queryFn: listPlans, staleTime: 30 * 60_000 });
}

// --- Shell data --------------------------------------------------------------

export function useProperties() {
  return useQuery({ queryKey: queryKeys.properties, queryFn: listProperties, staleTime: 60_000 });
}

export function useProfile() {
  return useQuery({ queryKey: queryKeys.profile, queryFn: getProfile, staleTime: 60_000 });
}

/**
 * The notification badge. Polls every 20s — the same cadence the hand-rolled bell used, but now
 * paused automatically when the tab is hidden, which the old `setInterval` did not do.
 */
export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: getUnreadCount,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: listNotifications,
    enabled,
    staleTime: 10_000,
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });
}
