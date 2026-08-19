'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  Building2,
  ChevronDown,
  LayoutGrid,
  LogOut,
  Menu as MenuIcon,
  Search,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  cn,
} from '@yohobed/ui';
import { clearSession, type SessionUser } from '@/lib/api';
import { NAV, QUICK_MENU, activeNavItem } from '@/lib/nav';
import { useEntitlements, useProperties } from '@/lib/queries';
import { NotificationsBell } from '@/components/notifications-bell';
import { ThemeToggle } from '@/components/theme';
import { CurrencyPicker } from '@/components/currency';
import { CommandPalette } from '@/components/command-palette';

/**
 * The application shell, laid out the way Yanolja Cloud Solution lays it out: a slide-out drawer
 * for the module tree, a slim top bar carrying the property identity, an omni-search, quick
 * actions and the notification centre.
 *
 * The drawer is a drawer (not a permanently pinned sidebar) for the reason Yanolja does it —
 * Stay View and the ARI grid are horizontally scrolling tables that want every pixel of width.
 * It stays pinned on wide screens where there is room for both.
 */
export function AppShell({
  user,
  pending,
  children,
}: {
  user: SessionUser | null;
  pending: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const { data: properties } = useProperties();
  const { data: entitlements } = useEntitlements();
  const active = activeNavItem(pathname);
  const property = properties?.[0];

  // Close the drawer on navigation — on a phone it covers the page you just asked for.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  function signOut() {
    clearSession();
    router.replace('/');
  }

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => !i.feature || entitlements?.features[i.feature] !== false),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="min-h-screen bg-bg">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={drawerOpen}
          className="xl:hidden"
        >
          {drawerOpen ? <X size={18} /> : <MenuIcon size={18} />}
        </Button>

        {/* Property identity — name over code, exactly as Yanolja's header reads. */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight text-ink">
              {property?.name ?? 'YoHoBed'}
            </div>
            <div className="font-mono text-[11px] leading-tight text-ink-3">
              {property?.id ? property.id.slice(0, 8) : 'Extranet'}
            </div>
          </div>
          {properties && properties.length > 1 && (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Switch property">
                  <ChevronDown size={14} />
                </Button>
              </MenuTrigger>
              <MenuContent align="start">
                <MenuLabel>Properties</MenuLabel>
                {properties.map((p) => (
                  <MenuItem key={p.id}>
                    <Building2 size={14} className="text-ink-3" />
                    {p.name}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>

        {/* Omni-search */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            'mx-auto hidden h-9 w-full max-w-md items-center gap-2 rounded-lg border border-line-strong',
            'bg-surface-2 px-3 text-sm text-ink-3 transition hover:border-ink-3 md:flex',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
          )}
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search reservations, guests and more</span>
          <kbd className="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[10px]">
            Ctrl K
          </kbd>
        </button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="md:hidden"
          >
            <Search size={18} />
          </Button>

          {/* Quick Menu grid */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Quick menu">
                <LayoutGrid size={18} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2">
              <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
                Quick menu
              </p>
              <div className="grid grid-cols-3 gap-1">
                {QUICK_MENU.map((q) => (
                  <Link
                    key={q.label}
                    href={q.href}
                    className="flex flex-col items-center gap-1.5 rounded-lg p-3 text-center text-xs text-ink-2 transition hover:bg-surface-2 hover:text-ink"
                  >
                    <q.icon size={18} />
                    {q.label}
                  </Link>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <NotificationsBell placement="header" />
          <ThemeToggle />

          {/* Profile */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Account">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                  {(user?.name ?? user?.email ?? '?').slice(0, 1).toUpperCase()}
                </span>
              </Button>
            </MenuTrigger>
            <MenuContent className="w-56">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                <p className="truncate text-xs text-ink-3">{user?.email}</p>
              </div>
              <MenuSeparator />
              <MenuItem asChild>
                <Link href="/app/profile">Profile & bank details</Link>
              </MenuItem>
              <MenuItem asChild>
                <Link href="/app/plan">Know your plan</Link>
              </MenuItem>
              <MenuItem asChild>
                <Link href="/app/setup">Configuration</Link>
              </MenuItem>
              <MenuSeparator />
              <div className="px-2.5 py-2">
                <CurrencyPicker />
              </div>
              <MenuSeparator />
              <MenuItem destructive onSelect={signOut}>
                <LogOut size={14} />
                Sign out
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </header>

      <div className="flex">
        {/* ---- Drawer nav ---- */}
        {drawerOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 top-14 z-20 bg-black/40 xl:hidden"
          />
        )}
        <nav
          aria-label="Main"
          className={cn(
            'fixed inset-y-0 top-14 z-20 w-64 shrink-0 overflow-y-auto border-r border-line bg-surface px-3 py-4 transition-transform xl:sticky xl:translate-x-0',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          style={{ height: 'calc(100vh - 3.5rem)' }}
        >
          {visibleGroups.map((group) => (
            <div key={group.label} className="mb-5">
              <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive = active?.href === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                          isActive
                            ? 'bg-[var(--brand-soft)] text-brand-ink'
                            : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                        )}
                      >
                        <item.icon size={16} className="shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* ---- Page ---- */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
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
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

/** Re-exported so pages can show a "not on your plan" state consistently. */
export function FeatureLocked({ feature }: { feature: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-8 text-center">
      <Badge tone="low">Not in your plan</Badge>
      <p className="mt-3 text-sm text-ink-2">
        <span className="font-semibold text-ink">{feature}</span> is not included in your current
        subscription.
      </p>
      <Button asChild variant="secondary" className="mt-4">
        <Link href="/app/plan">See plans</Link>
      </Button>
    </div>
  );
}

export { Tooltip };
