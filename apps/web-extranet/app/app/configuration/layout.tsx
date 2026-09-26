'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTenantRole } from '@/lib/queries';
import { CUSTOM_ROLE_SECTIONS, ConfigNav } from '@/components/configuration/config-frame';

/**
 * Configuration, Yanolja style (owner brief, 2026-09-26): one place for the property and every
 * list the desk picks from, each a section of its own beside a grouped navigation.
 */
export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const role = useTenantRole();
  const current = usePathname().split('/')[3] ?? '';
  // A hotel role with the setup permission looks after the room types only: any other section
  // (the Hotel profile the index opens on, an old link) takes it there.
  const outOfBounds = role === 'CUSTOM' && !CUSTOM_ROLE_SECTIONS.has(current);
  React.useEffect(() => {
    if (outOfBounds) router.replace('/app/configuration/room-types');
  }, [outOfBounds, router]);
  return (
    <div className="grid gap-4 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-6">
      <ConfigNav current={current} />
      <div className="min-w-0">{outOfBounds ? null : children}</div>
    </div>
  );
}
