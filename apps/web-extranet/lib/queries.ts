'use client';

import * as React from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import {
  getEntitlements,
  getTenantPlan,
  getUser,
  listPlans,
  listProperties,
  getProfile,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  getReservationConfig,
  getPropertySettings,
  listBusinessSources,
  listMarketSegments,
  listPaymentMethods,
  listSalesPersons,
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
  // Reservation configuration: one family, so any master-list edit refreshes the desk's view.
  config: ['config'] as const,
  reservationConfig: (propertyId: string) => ['config', 'reservation', propertyId] as const,
  propertySettings: (propertyId: string) => ['config', 'settings', propertyId] as const,
  businessSources: ['config', 'business-sources'] as const,
  marketSegments: ['config', 'market-segments'] as const,
  paymentMethods: ['config', 'payment-methods'] as const,
  salesPersons: ['config', 'sales-persons'] as const,
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

// --- Reservation configuration -------------------------------------------------

/** Everything the reservation screens need for one property, in one request. */
export function useReservationConfig(propertyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reservationConfig(propertyId ?? ''),
    queryFn: () => getReservationConfig(propertyId!),
    enabled: Boolean(propertyId),
    staleTime: 60_000,
  });
}

export function usePropertySettings(propertyId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.propertySettings(propertyId ?? ''),
    queryFn: () => getPropertySettings(propertyId!),
    enabled: Boolean(propertyId),
  });
}

export function useBusinessSources() {
  return useQuery({ queryKey: queryKeys.businessSources, queryFn: listBusinessSources });
}

export function useMarketSegments() {
  return useQuery({ queryKey: queryKeys.marketSegments, queryFn: listMarketSegments });
}

export function usePaymentMethods() {
  return useQuery({ queryKey: queryKeys.paymentMethods, queryFn: listPaymentMethods });
}

export function useSalesPersons() {
  return useQuery({ queryKey: queryKeys.salesPersons, queryFn: listSalesPersons });
}

/**
 * The signed-in user's role in the active tenant ('OWNER' | 'OWNER_STAFF'), read after mount
 * because the session lives in localStorage. Screens use it to hide controls the API would refuse.
 */
export function useTenantRole(): string | null {
  const [role, setRole] = React.useState<string | null>(null);
  React.useEffect(() => {
    setRole(getUser()?.memberships.find((m) => m.tenantId !== null)?.role ?? null);
  }, []);
  return role;
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
