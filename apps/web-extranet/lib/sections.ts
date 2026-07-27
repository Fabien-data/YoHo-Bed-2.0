/**
 * Single source of truth for the PMS sections: sidebar navigation + per-section
 * feature-guide links. Each section gets its own public Notion page describing the
 * feature and collecting tester feedback; the footer link stays hidden while a
 * docsUrl still carries the PLACEHOLDER marker, so this ships before the pages exist.
 */
export interface Section {
  href: string;
  label: string;
  docsUrl: string;
}

export const SECTIONS: Section[] = [
  { href: '/app', label: 'Dashboard', docsUrl: 'https://app.notion.com/p/3aa8dc2224558106b47ee600d03086db' },
  {
    href: '/app/calendar',
    label: 'Calendar',
    docsUrl: 'https://app.notion.com/p/3aa8dc222455810c944bcefa0e3ef17c',
  },
  {
    href: '/app/bookings',
    label: 'Bookings',
    docsUrl: 'https://app.notion.com/p/3aa8dc222455817c99a4feb8f4ad73c3',
  },
  { href: '/app/inbox', label: 'Inbox', docsUrl: 'https://app.notion.com/p/3aa8dc222455811d89e8cc29ab9a0711' },
  {
    href: '/app/customers',
    label: 'Customers',
    docsUrl: 'https://app.notion.com/p/3aa8dc22245581968e81c5fadc812ce5',
  },
  { href: '/app/deals', label: 'Deals', docsUrl: 'https://app.notion.com/p/3aa8dc22245581a8bda7dcda160d7c28' },
  { href: '/app/finance', label: 'Finance', docsUrl: 'https://app.notion.com/p/3aa8dc22245581b5a2b0d23d4607e6ef' },
  { href: '/app/reviews', label: 'Reviews', docsUrl: 'https://app.notion.com/p/3aa8dc2224558175a2f7f96874432400' },
  { href: '/app/comms', label: 'Comms', docsUrl: 'https://app.notion.com/p/3aa8dc22245581b683afe00bfef09b52' },
  { href: '/app/setup', label: 'Setup', docsUrl: 'https://app.notion.com/p/3aa8dc222455815c978eecf181bd1b52' },
  { href: '/app/profile', label: 'Profile', docsUrl: 'https://app.notion.com/p/3aa8dc222455817c95fef79a2ef42304' },
];

/** The section a pathname belongs to — same match rule the sidebar uses. */
export function activeSection(pathname: string): Section | undefined {
  return SECTIONS.find((s) =>
    s.href === '/app' ? pathname === '/app' : pathname.startsWith(s.href),
  );
}
