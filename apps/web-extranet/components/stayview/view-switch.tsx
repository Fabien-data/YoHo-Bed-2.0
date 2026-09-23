'use client';

import Link from 'next/link';
import { CalendarBlank, SquaresFour } from '@phosphor-icons/react';
import { cn } from '@yohobed/ui';

/**
 * Room View ⇄ Stay View: two views of the same house, one switch apart, in the same place on
 * both screens so the header stays still while the content changes under it.
 */
export function ViewSwitch({ current }: { current: 'room' | 'stay' }) {
  const item = (key: 'room' | 'stay', href: string, label: string, Icon: typeof SquaresFour) => (
    <Link
      href={href}
      aria-current={current === key ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition duration-1 ease-smooth',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass',
        current === key ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink',
      )}
    >
      <Icon size={14} weight={current === key ? 'duotone' : 'regular'} aria-hidden />
      {label}
    </Link>
  );
  return (
    <nav
      aria-label="Front desk views"
      className="inline-flex items-center gap-0.5 rounded-lg border border-line-strong bg-surface-2 p-0.5"
    >
      {item('room', '/app/roomview', 'Room view', SquaresFour)}
      {item('stay', '/app/stayview', 'Stay view', CalendarBlank)}
    </nav>
  );
}
