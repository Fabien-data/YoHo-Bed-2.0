'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Buildings,
  CalendarBlank,
  CalendarCheck,
  CalendarPlus,
  CaretDown,
  CreditCard,
  CurrencyCircleDollar,
  DotsNine,
  GearSix,
  List,
  MagnifyingGlass,
  SignOut,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  Kbd,
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
import { useEntitlements } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';
import { NotificationsBell } from '@/components/notifications-bell';
import { ThemeToggle } from '@/components/theme';
import { CurrencyPicker } from '@/components/currency';
import { CommandPalette } from '@/components/command-palette';
import { Logo } from '@/components/logo';

const NAV_COLLAPSED_KEY = 'yhb_nav_collapsed';

/** The header quick-action strip — Yanolja's five icons, mapped to our routes. */
const QUICK_ACTIONS = [
  { href: '/app/bookings', label: 'Add booking', icon: CalendarPlus, feature: undefined },
  { href: '/app/stayview', label: 'Stay view', icon: CalendarCheck, feature: 'stay_view' },
  { href: '/app/reservations', label: 'Reservations', icon: CalendarBlank, feature: undefined },
  {
    href: '/app/calendar',
    label: 'Rates & inventory',
    icon: CurrencyCircleDollar,
    feature: undefined,
  },
] as const;

/**
 * The application shell, laid out the way Yanolja Cloud Solution lays it out: the module tree on
 * the left, a slim top bar carrying the property identity, an omni-search, quick actions and the
 * notification centre.
 *
 * On wide screens the tree is a pinned sidebar the hamburger can collapse — Stay View and the ARI
 * grid are horizontally scrolling tables that want every pixel of width. Below `xl` it becomes an
 * overlay drawer, exactly like Yanolja's.
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
  const [collapsed, setCollapsed] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  // The active property is shared app-wide (see components/active-property.tsx) — the switcher
  // must re-scope every screen, not just this header's label.
  const { property, properties, switchProperty } = useActiveProperty();
  const { data: entitlements } = useEntitlements();
  const active = activeNavItem(pathname);

  // Restore persisted UI state after mount (SSR renders the default).
  React.useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === '1');
    } catch {
      // storage unavailable — defaults stand
    }
  }, []);

  // Close the drawer on navigation — on a phone it covers the page you just asked for.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  function toggleNav() {
    // One button, two meanings: below xl it opens the overlay drawer; at xl+ it pins/unpins.
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches) {
      setCollapsed((c) => {
        try {
          localStorage.setItem(NAV_COLLAPSED_KEY, c ? '0' : '1');
        } catch {
          // fine
        }
        return !c;
      });
    } else {
      setDrawerOpen((o) => !o);
    }
  }

  function signOut() {
    clearSession();
    router.replace('/');
  }

  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => !i.feature || entitlements?.features[i.feature] !== false),
  })).filter((g) => g.items.length > 0);

  const propertyIdentity = (
    <div className="min-w-0 text-left">
      <div className="truncate text-sm font-semibold leading-tight tracking-tight text-ink">
        {property?.name ?? 'YoHoBed'}
      </div>
      <div className="font-mono text-[10px] uppercase leading-tight tracking-wider text-ink-3">
        {property?.id ? property.id.slice(0, 8) : 'Extranet'}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      {/* ---- Top bar ---- */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleNav}
          aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={drawerOpen || !collapsed}
        >
          {drawerOpen ? <X size={18} /> : <List size={18} />}
        </Button>

        {/* Property identity — name over code, exactly as Yanolja's header reads. */}
        {properties && properties.length > 1 ? (
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                aria-label="Switch property"
                className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 transition duration-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
              >
                {propertyIdentity}
                <CaretDown size={12} className="shrink-0 text-ink-3" />
              </button>
            </MenuTrigger>
            <MenuContent align="start" className="w-64">
              <MenuLabel>Properties</MenuLabel>
              {properties.map((p) => (
                <MenuItem
                  key={p.id}
                  onSelect={() => switchProperty(p.id)}
                  className={cn(p.id === property?.id && 'bg-brand-soft text-brand-ink')}
                >
                  <Buildings size={15} className="shrink-0 text-ink-3" />
                  <span className="truncate">{p.name}</span>
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        ) : (
          <div className="px-2">{propertyIdentity}</div>
        )}

        {/* Omni-search */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className={cn(
            'mx-auto hidden h-9 w-full max-w-md items-center gap-2 rounded-full border border-line',
            'bg-surface-2 px-3.5 text-sm text-ink-3 transition duration-1 hover:border-ink-3 md:flex',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass',
          )}
        >
          <MagnifyingGlass size={14} />
          <span className="flex-1 truncate text-left">Search reservations, guests and more</span>
          <Kbd>Ctrl K</Kbd>
        </button>

        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            className="md:hidden"
          >
            <MagnifyingGlass size={18} />
          </Button>

          {/* Quick actions — the Yanolja icon strip, entitlement-filtered like the sidebar. */}
          <div className="hidden items-center gap-0.5 lg:flex">
            {QUICK_ACTIONS.filter(
              (qa) => !qa.feature || entitlements?.features[qa.feature] !== false,
            ).map((qa) => (
              <Tooltip key={qa.href} label={qa.label}>
                <Button asChild variant="ghost" size="icon" aria-label={qa.label}>
                  <Link href={qa.href}>
                    <qa.icon size={18} />
                  </Link>
                </Button>
              </Tooltip>
            ))}
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          </div>

          {/* Quick Menu grid */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Quick menu">
                <DotsNine size={18} weight="bold" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2">
              <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                Quick menu
              </p>
              <div className="grid grid-cols-3 gap-1">
                {QUICK_MENU.map((q) => (
                  <Link
                    key={q.label}
                    href={q.href}
                    className="flex flex-col items-center gap-1.5 rounded-lg p-3 text-center text-xs font-medium text-ink-2 transition duration-1 hover:bg-surface-2 hover:text-ink"
                  >
                    <q.icon size={20} weight="duotone" />
                    {q.label}
                  </Link>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <NotificationsBell />
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
            <MenuContent className="w-60">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-semibold text-ink">{user?.name}</p>
                <p className="truncate text-xs text-ink-3">{user?.email}</p>
              </div>
              <MenuSeparator />
              <MenuItem asChild>
                <Link href="/app/profile">
                  <UserCircle size={15} className="text-ink-3" />
                  Profile &amp; bank details
                </Link>
              </MenuItem>
              <MenuItem asChild>
                <Link href="/app/plan">
                  <CreditCard size={15} className="text-ink-3" />
                  Know your plan
                </Link>
              </MenuItem>
              <MenuItem asChild>
                <Link href="/app/setup">
                  <GearSix size={15} className="text-ink-3" />
                  Configuration
                </Link>
              </MenuItem>
              <MenuSeparator />
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="text-xs font-medium text-ink-2">Display currency</span>
                <CurrencyPicker />
              </div>
              <MenuSeparator />
              <MenuItem destructive onSelect={signOut}>
                <SignOut size={15} />
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
            'fixed inset-y-0 top-14 z-20 flex w-64 shrink-0 flex-col border-r border-line bg-surface',
            'transition-transform duration-2 ease-smooth',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
            !collapsed && 'xl:sticky xl:translate-x-0',
          )}
          style={{ height: 'calc(100vh - 3.5rem)' }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
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
                            'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition duration-1',
                            isActive
                              ? 'bg-brand-soft text-brand-ink'
                              : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                          )}
                        >
                          {isActive && (
                            <span
                              aria-hidden
                              className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-brass"
                            />
                          )}
                          <item.icon
                            size={17}
                            weight={isActive ? 'duotone' : 'regular'}
                            className="shrink-0"
                          />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* Brand footer — the product identity lives at the foot of the tree, as Yanolja's does. */}
          <div className="border-t border-line px-5 py-3.5">
            <Logo size={22} suffix="PMS" />
            <p className="mt-2 text-[10px] text-ink-3">
              © {new Date().getFullYear()} YoHoBed · Terms · Privacy
            </p>
          </div>
        </nav>

        {/* ---- Page ---- */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
          <div className="mx-auto max-w-7xl">
            {pending && (
              <div className="mb-6 rounded-lg bg-low-soft px-4 py-3 text-sm font-semibold text-low-ink">
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
    <Card className="p-8 text-center">
      <Badge tone="low">Not in your plan</Badge>
      <p className="mt-3 text-sm text-ink-2">
        <span className="font-semibold text-ink">{feature}</span> is not included in your current
        subscription.
      </p>
      <Button asChild variant="secondary" className="mt-4">
        <Link href="/app/plan">See plans</Link>
      </Button>
    </Card>
  );
}

export { Tooltip };
