'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell } from '@phosphor-icons/react';
import { Button, EmptyState, Popover, PopoverContent, PopoverTrigger, cn } from '@yohobed/ui';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '@/lib/api';
import { queryKeys, useUnreadCount } from '@/lib/queries';

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * The notification centre — a badge-counted bell whose panel lists the feed, Yanolja-style.
 * The unread count polls through `useUnreadCount` (every 20s, paused while the tab is hidden —
 * the reason the hook exists; the old hand-rolled setInterval polled idle tabs forever).
 * The list itself refreshes when the panel opens.
 */
export function NotificationsBell() {
  const qc = useQueryClient();
  const [items, setItems] = useState<AppNotification[]>([]);
  const { data: unread } = useUnreadCount();
  const count = unread?.count ?? 0;

  async function refresh() {
    setItems(await listNotifications().catch(() => [] as AppNotification[]));
    await qc.invalidateQueries({ queryKey: queryKeys.unreadCount });
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell size={18} />
          {count > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-closed px-1 text-[10px] font-bold leading-none text-white">
              {count > 9 ? '9+' : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96 max-w-[calc(100vw-1.5rem)] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold text-ink">Notifications</span>
          {count > 0 && (
            <button
              type="button"
              onClick={async () => {
                await markAllNotificationsRead().catch(() => {});
                await refresh();
              }}
              className="text-xs font-semibold text-brand-ink transition duration-1 hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <EmptyState
              title="Nothing yet"
              description="Reservation and channel events will appear here."
              className="py-10"
            />
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={async () => {
                  if (!n.read) await markNotificationRead(n.id).catch(() => {});
                  await refresh();
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 border-b border-line px-4 py-3 text-left transition duration-1 last:border-0 hover:bg-surface-2',
                  !n.read && 'bg-brand-soft',
                )}
              >
                <div className="flex w-full items-center gap-2">
                  {!n.read && (
                    <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
                  )}
                  <span className="truncate text-sm font-semibold text-ink">{n.title}</span>
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] text-ink-3">{ago(n.createdAt)}</span>
                </div>
                {n.body && <span className="text-xs text-ink-2">{n.body}</span>}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
