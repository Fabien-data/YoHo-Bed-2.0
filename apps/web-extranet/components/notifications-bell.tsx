'use client';

import { useEffect, useRef, useState } from 'react';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from '@/lib/api';

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function refresh() {
    const [c, list] = await Promise.all([
      getUnreadCount().catch(() => ({ count: 0 })),
      listNotifications().catch(() => [] as AppNotification[]),
    ]);
    setCount(c.count);
    setItems(list);
  }

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      getUnreadCount()
        .then((c) => setCount(c.count))
        .catch(() => {});
    }, 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await refresh();
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-ink-2 transition hover:bg-[var(--surface-2)] hover:text-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.6rem] font-bold text-white"
            style={{ background: 'var(--closed)' }}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_8px_30px_rgba(20,22,31,0.18)]">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-bold text-ink">Notifications</span>
            {count > 0 && (
              <button
                onClick={async () => {
                  await markAllNotificationsRead().catch(() => {});
                  await refresh();
                }}
                className="text-xs font-semibold text-brand-ink hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-3">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={async () => {
                    if (!n.read) await markNotificationRead(n.id).catch(() => {});
                    await refresh();
                  }}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-line px-4 py-3 text-left transition last:border-0 hover:bg-[var(--surface-2)]"
                  style={n.read ? undefined : { background: 'var(--brand-soft)' }}
                >
                  <div className="flex w-full items-center gap-2">
                    {!n.read && <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: 'var(--brand)' }} />}
                    <span className="text-sm font-semibold text-ink">{n.title}</span>
                    <span className="flex-1" />
                    <span className="font-mono text-[0.65rem] text-ink-3">{ago(n.createdAt)}</span>
                  </div>
                  {n.body && <span className="text-xs text-ink-2">{n.body}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
