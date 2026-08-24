import {
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Coins,
  Gauge,
  Gift,
  Inbox,
  LayoutGrid,
  MessageSquare,
  Grid3x3,
  Receipt,
  Banknote,
  Moon,
  Settings,
  Star,
  Tag,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * The product navigation, grouped the way Yanolja Cloud Solution groups it.
 *
 * The grouping is deliberate, not cosmetic: staff migrating from Yanolja look for "Rates &
 * Availability" and "Cashiering", not for our internal route names. Later sprints slot their
 * screens into these same groups (Stay View and Room View into Front Desk, Housekeeping and
 * Night Audit as new groups) without the shell changing shape.
 *
 * Only routes that actually exist are listed — a nav item that leads nowhere is worse than a
 * missing one. `feature` gates an item behind a subscription entitlement.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Public feature-guide page. Hidden while it still carries the PLACEHOLDER marker. */
  docsUrl: string;
  /** Subscription feature key from @yohobed/domain. Omit for always-available items. */
  feature?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Front desk',
    items: [
      {
        href: '/app',
        label: 'Dashboard',
        icon: Gauge,
        docsUrl: 'https://app.notion.com/p/3aa8dc2224558106b47ee600d03086db',
      },
      {
        href: '/app/stayview',
        label: 'Stay view',
        icon: LayoutGrid,
        docsUrl: 'PLACEHOLDER',
        feature: 'stay_view',
      },
      {
        href: '/app/roomview',
        label: 'Room view',
        icon: Grid3x3,
        docsUrl: 'PLACEHOLDER',
        feature: 'room_view',
      },
      // Two screens on purpose: this one searches, groups and prints; the next one is where a
      // booking is actually created and moved through its lifecycle.
      {
        href: '/app/reservations',
        label: 'Reservations',
        icon: CalendarRange,
        docsUrl: 'PLACEHOLDER',
      },
      {
        href: '/app/bookings',
        label: 'Check-in & walk-ins',
        icon: ClipboardList,
        docsUrl: 'https://app.notion.com/p/3aa8dc222455817c99a4feb8f4ad73c3',
      },
    ],
  },
  {
    label: 'Rates & availability',
    items: [
      {
        href: '/app/calendar',
        label: 'Rates & inventory',
        icon: CalendarDays,
        docsUrl: 'https://app.notion.com/p/3aa8dc222455810c944bcefa0e3ef17c',
      },
      {
        href: '/app/deals',
        label: 'Promotions',
        icon: Tag,
        docsUrl: 'https://app.notion.com/p/3aa8dc22245581b683afe00bfef09b52',
      },
    ],
  },
  {
    label: 'Distribution',
    items: [
      {
        href: '/app/inbox',
        label: 'Channel inbox',
        icon: Inbox,
        docsUrl: 'https://app.notion.com/p/3aa8dc222455811d89e8cc29ab9a0711',
      },
      {
        href: '/app/comms',
        label: 'Guest messages',
        icon: MessageSquare,
        docsUrl: 'https://app.notion.com/p/3aa8dc2224558169bb2ef8e2b0e5cb62',
      },
    ],
  },
  {
    label: 'Guest',
    items: [
      {
        href: '/app/customers',
        label: 'Guest database',
        icon: Users,
        docsUrl: 'https://app.notion.com/p/3aa8dc22245581968e81c5fadc812ce5',
      },
      {
        href: '/app/reviews',
        label: 'Reviews',
        icon: Star,
        docsUrl: 'https://app.notion.com/p/3aa8dc2224558140a3b2c1d6a4e5f708',
      },
    ],
  },
  {
    label: 'Cashiering',
    items: [
      {
        href: '/app/cashiering',
        label: 'Cashiering centre',
        icon: Banknote,
        docsUrl: 'PLACEHOLDER',
        feature: 'cashiering',
      },
      {
        href: '/app/night-audit',
        label: 'Night audit',
        icon: Moon,
        docsUrl: 'PLACEHOLDER',
        feature: 'night_audit',
      },
      {
        href: '/app/folios',
        label: 'Unsettled folios',
        icon: Receipt,
        docsUrl: 'PLACEHOLDER',
        feature: 'folio',
      },
      {
        href: '/app/finance',
        label: 'Finance & payouts',
        icon: Wallet,
        docsUrl: 'https://app.notion.com/p/3aa8dc222455814ab3d9e0f1a2b3c4d5',
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        href: '/app/setup',
        label: 'Property setup',
        icon: Settings,
        docsUrl: 'https://app.notion.com/p/3aa8dc222455815c978eecf181bd1b52',
      },
      {
        href: '/app/profile',
        label: 'Profile',
        icon: UserRound,
        docsUrl: 'https://app.notion.com/p/3aa8dc222455817c95fef79a2ef42304',
      },
      {
        href: '/app/plan',
        label: 'Your plan',
        icon: Receipt,
        docsUrl: 'PLACEHOLDER',
      },
    ],
  },
];

/** Flattened, for lookups. */
export const NAV_ITEMS: NavItem[] = NAV.flatMap((g) => g.items);

/**
 * The nav item a pathname belongs to. Longest-prefix wins so `/app/bookings/123` resolves to
 * Reservations rather than to Dashboard, and exact-matching `/app` stops it swallowing everything.
 */
export function activeNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.filter((i) =>
    i.href === '/app' ? pathname === '/app' : pathname.startsWith(i.href),
  ).sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * Yanolja's Quick Menu grid — the shortcuts that are not part of the main tree.
 * Kept small and honest: only destinations that exist today.
 */
export const QUICK_MENU: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/app', label: 'Dashboard', icon: Gauge },
  { href: '/app/finance', label: 'Revenue', icon: Coins },
  { href: '/app/customers', label: 'Guest statistics', icon: Users },
  { href: '/app/deals', label: 'Promotions', icon: Gift },
  { href: '/app/inbox', label: 'Channel inbox', icon: Inbox },
  { href: '/app/plan', label: 'Know your plan', icon: ClipboardList },
];
