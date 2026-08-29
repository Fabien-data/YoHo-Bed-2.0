'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@yohobed/ui';

/**
 * Client-side providers for the authenticated app.
 *
 * The QueryClient is created inside a `useState` initialiser rather than at module scope so it
 * is never shared between users during SSR, and so a hot reload does not leave two caches racing.
 *
 * Defaults are tuned for a PMS: front-desk data goes stale in seconds (someone else at the desk
 * just checked a guest in), so `staleTime` is short and refetch-on-focus is on — switching back
 * to the tab should show the truth, not what was true ten minutes ago.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) => {
              // Never retry an auth/permission failure — it will not succeed and it delays the
              // redirect to the login screen.
              const status = (error as { status?: number })?.status;
              if (status === 401 || status === 403 || status === 404) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={200}>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
