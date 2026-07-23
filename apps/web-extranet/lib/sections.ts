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
  { href: '/app', label: 'Dashboard', docsUrl: 'https://www.notion.so/PLACEHOLDER-dashboard' },
  {
    href: '/app/calendar',
    label: 'Calendar',
    docsUrl: 'https://www.notion.so/PLACEHOLDER-calendar',
  },
  {
    href: '/app/bookings',
    label: 'Bookings',
    docsUrl: 'https://www.notion.so/PLACEHOLDER-bookings',
  },
  { href: '/app/inbox', label: 'Inbox', docsUrl: 'https://www.notion.so/PLACEHOLDER-inbox' },
  {
    href: '/app/customers',
    label: 'Customers',
    docsUrl: 'https://www.notion.so/PLACEHOLDER-customers',
  },
  { href: '/app/deals', label: 'Deals', docsUrl: 'https://www.notion.so/PLACEHOLDER-deals' },
  { href: '/app/finance', label: 'Finance', docsUrl: 'https://www.notion.so/PLACEHOLDER-finance' },
  { href: '/app/reviews', label: 'Reviews', docsUrl: 'https://www.notion.so/PLACEHOLDER-reviews' },
  { href: '/app/comms', label: 'Comms', docsUrl: 'https://www.notion.so/PLACEHOLDER-comms' },
  { href: '/app/setup', label: 'Setup', docsUrl: 'https://www.notion.so/PLACEHOLDER-setup' },
  { href: '/app/profile', label: 'Profile', docsUrl: 'https://www.notion.so/PLACEHOLDER-profile' },
];

/** The section a pathname belongs to — same match rule the sidebar uses. */
export function activeSection(pathname: string): Section | undefined {
  return SECTIONS.find((s) =>
    s.href === '/app' ? pathname === '/app' : pathname.startsWith(s.href),
  );
}
