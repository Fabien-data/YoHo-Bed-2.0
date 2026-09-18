'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { CalendarPlus, MagnifyingGlass } from '@phosphor-icons/react';
import { Dialog, DialogContent, Kbd } from '@yohobed/ui';
import { NAV } from '@/lib/nav';
import { useEntitlements } from '@/lib/queries';
import { useReservationComposer } from '@/components/reservations/composer/composer-context';

/**
 * The omni-search — Yanolja's "Search reservations, guests and more".
 *
 * Today it navigates the module tree. Reservation and guest lookup land when there is a search
 * endpoint to call; the shape is already right for it, because cmdk filters whatever items it
 * is given.
 *
 * Ctrl/Cmd-K is bound globally, which is the whole point: a front-desk agent should never have to
 * reach for the mouse to get somewhere.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { openComposer } = useReservationComposer();

  // Same entitlement filter as the sidebar — the palette must not be a back door into modules
  // the tenant's plan hides (the backend 403s anyway; a raw error beats no gate, but not by much).
  const { data: entitlements } = useEntitlements();
  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => !i.feature || entitlements?.features[i.feature] !== false),
  })).filter((g) => g.items.length > 0);

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
      // Alt+N: a new reservation from anywhere. `code`, not `key`: on a Mac, Option+N types "˜".
      if (e.code === 'KeyN' && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onOpenChange(false);
        openComposer();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange, openComposer]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Search" hideTitle hideClose className="max-w-xl p-0">
        <Command
          loop
          className="flex flex-col"
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <MagnifyingGlass size={16} className="shrink-0 text-ink-3" />
            <Command.Input
              autoFocus
              placeholder="Search reservations, guests and more"
              className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
            <Kbd>Esc</Kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-2 py-8 text-center text-sm text-ink-3">
              Nothing matches that.
            </Command.Empty>

            <Command.Group
              heading="Actions"
              className="pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-3"
            >
              <Command.Item
                value="New reservation booking walk-in quick"
                onSelect={() => {
                  onOpenChange(false);
                  openComposer();
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-2 outline-none transition duration-1 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink"
              >
                <CalendarPlus size={16} className="shrink-0 text-ink-3" />
                New reservation
                <span className="ml-auto flex gap-1">
                  <Kbd>Alt</Kbd>
                  <Kbd>N</Kbd>
                </span>
              </Command.Item>
            </Command.Group>
            {visibleGroups.map((group) => (
              <Command.Group
                key={group.label}
                heading={group.label}
                className="pb-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-3"
              >
                {group.items.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`${group.label} ${item.label}`}
                    onSelect={() => go(item.href)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink-2 outline-none transition duration-1 data-[selected=true]:bg-surface-2 data-[selected=true]:text-ink"
                  >
                    <item.icon size={16} className="shrink-0 text-ink-3" />
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>

          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2.5 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd> open
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd> close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
