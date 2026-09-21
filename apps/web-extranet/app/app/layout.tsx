'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { getProfile, getToken, getUser, isStaff, type SessionUser } from '@/lib/api';
import { CurrencyProvider } from '@/components/currency';
import { Providers } from '@/components/providers';
import { ActivePropertyProvider } from '@/components/active-property';
import { AppShell } from '@/components/app-shell';
import { ReservationComposerProvider } from '@/components/reservations/composer/composer-context';
import { FeatureDocsLink } from '@/components/feature-docs-link';

/** The owner PMS shell: auth guard + product navigation. Staff are routed to their own console. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const u = getUser();
    if (isStaff(u)) {
      router.replace('/staff');
      return;
    }
    setUser(u);
    setReady(true);
    getProfile()
      .then((p) => setPending(p.tenant.status === 'pending'))
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    const role = user?.memberships.find(membership => membership.tenantId !== null)?.role;
    if ((role === 'HOUSEKEEPING_ATTENDANT' || role === 'HOUSEKEEPING_SUPERVISOR') &&
      pathname !== '/app/roomview' && pathname !== '/app/profile') {
      router.replace('/app/roomview');
    }
  }, [pathname, router, user]);

  if (!ready) return null;

  return (
    <Providers>
      <CurrencyProvider>
        <ActivePropertyProvider>
          <ReservationComposerProvider>
            <AppShell user={user} pending={pending}>
              {children}
              <FeatureDocsLink />
            </AppShell>
          </ReservationComposerProvider>
        </ActivePropertyProvider>
      </CurrencyProvider>
    </Providers>
  );
}
