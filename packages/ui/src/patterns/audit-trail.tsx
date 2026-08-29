'use client';

import * as React from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { Button } from '../primitives/button';
import { Sheet, SheetContent, SheetTrigger } from '../primitives/sheet';
import { Input } from '../primitives/form';
import { EmptyState, Skeleton } from '../primitives/surfaces';

export interface AuditEntry {
  id: string;
  /** ISO timestamp. */
  at: string;
  /** What happened, e.g. "Night Audit — Old: 06/08/2026 New: 07/08/2026". */
  log: string;
  user: string | null;
  ip?: string | null;
}

/**
 * The per-module audit trail Yanolja hangs off nearly every screen.
 *
 * Two details are deliberate. It records the **IP** alongside the user, because the question
 * these screens actually answer during a dispute is "who did this, from where". And it is a
 * slide-over, not a page — you check the trail while looking at the thing it explains.
 */
export function AuditTrailDrawer({
  title = 'Audit trail',
  entries,
  loading,
  onOpen,
  triggerLabel = 'Audit Trail',
}: {
  title?: string;
  entries: AuditEntry[];
  loading?: boolean;
  /** Called when the drawer opens, so the caller can fetch lazily. */
  onOpen?: () => void;
  triggerLabel?: string;
}) {
  const [query, setQuery] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.log, e.user, e.ip, e.at].some((f) => f?.toLowerCase().includes(q)),
    );
  }, [entries, query]);

  return (
    <Sheet
      onOpenChange={(open) => {
        if (open) onOpen?.();
      }}
    >
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm">
          <ClockCounterClockwise size={14} />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent title={title}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by date, log, user, IP"
          aria-label="Search the audit trail"
        />

        {loading ? (
          <div className="mt-4 flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={entries.length === 0 ? 'Nothing recorded yet' : 'No matching entries'}
            description={
              entries.length === 0
                ? 'Actions on this screen will appear here.'
                : 'Try a different search.'
            }
          />
        ) : (
          <ul className="mt-4 flex flex-col">
            {filtered.map((e) => (
              <li key={e.id} className="border-b border-line py-3 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-mono text-xs text-ink-3">
                    {e.at.replace('T', ' ').slice(0, 19)}
                  </span>
                  <span className="text-sm font-medium text-ink">{e.user ?? 'system'}</span>
                  {e.ip && <span className="ml-auto font-mono text-xs text-ink-3">{e.ip}</span>}
                </div>
                <p className="mt-1 text-sm text-ink-2">{e.log}</p>
              </li>
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  );
}
