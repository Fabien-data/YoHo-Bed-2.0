'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { clearSession, getProfile, getToken, getUser, isStaff, type SessionUser } from '@/lib/api';
import { SECTIONS } from '@/lib/sections';
import { Logo, Button } from '@/components/ui';
import { NotificationsBell } from '@/components/notifications-bell';
import { ThemeToggle } from '@/components/theme';
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

  if (!ready) return null;

  return (
    <div className="min-h-screen">
      {/* Persistent left sidebar: full-height, fixed, never scrolls away. */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-line bg-surface">
        <div className="flex items-center justify-between px-5 py-5">
          <Logo />
          <NotificationsBell placement="sidebar" />
        </div>
        <nav className="flex flex-col gap-1 overflow-y-auto px-3 pb-3">
          {SECTIONS.map((t) => {
            const active = t.href === '/app' ? pathname === '/app' : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'text-brand-ink'
                    : 'text-ink-2 hover:bg-[var(--surface-2)] hover:text-ink'
                }`}
                style={active ? { background: 'var(--brand-soft)' } : undefined}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <div className="border-t border-line px-5 py-4">
          {user && (
            <p className="mb-3 truncate text-xs text-ink-3" title={user.email}>
              {user.email}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                clearSession();
                router.replace('/');
              }}
            >
              Sign out
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="ml-64 px-8 py-8">
        <div className="mx-auto max-w-7xl">
          {pending && (
            <div
              className="mb-6 rounded-lg px-4 py-3 text-sm font-semibold"
              style={{ color: 'var(--low-ink)', background: 'var(--low-soft)' }}
            >
              Your account is awaiting approval — you can set everything up now; taking bookings
              unlocks once our team activates you. You&rsquo;ll get an email when it&rsquo;s done.
            </div>
          )}
          {children}
          <FeatureDocsLink />
        </div>
      </main>
    </div>
  );
}
