'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { clearSession, getToken, getUser, isStaff, type SessionUser } from '@/lib/api';
import { Logo, Button } from '@/components/ui';
import { NotificationsBell } from '@/components/notifications-bell';

const TABS = [
  { href: '/app', label: 'Calendar' },
  { href: '/app/bookings', label: 'Bookings' },
  { href: '/app/deals', label: 'Deals' },
  { href: '/app/finance', label: 'Finance' },
  { href: '/app/comms', label: 'Comms' },
  { href: '/app/setup', label: 'Setup' },
];

/** The owner PMS shell: auth guard + product navigation. Staff are routed to their own console. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

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
  }, [router]);

  if (!ready) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-5 px-6 py-3">
          <Logo />
          <nav className="flex items-center gap-1">
            {TABS.map((t) => {
              const active = t.href === '/app' ? pathname === '/app' : pathname.startsWith(t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    active ? 'text-brand-ink' : 'text-ink-2 hover:text-ink'
                  }`}
                  style={active ? { background: 'var(--brand-soft)' } : undefined}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1" />
          <NotificationsBell />
          {user && <span className="hidden text-sm text-ink-2 sm:inline">{user.email}</span>}
          <Button
            variant="secondary"
            onClick={() => {
              clearSession();
              router.replace('/');
            }}
          >
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
