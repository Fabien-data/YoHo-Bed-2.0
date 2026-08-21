'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { Sheet, SheetContent } from '@yohobed/ui';
import { NAV } from '@/lib/nav';

/**
 * The omni-search — Yanolja's "Search reservations, guests and more".
 *
 * Today it navigates the module tree. Reservation and guest lookup land in Sprint 4, when there
 * is a search endpoint to call; the shape is already right for it, because cmdk filters whatever
 * items it is given.
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

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" title="Search" hideTitle className="mx-auto sm:max-w-2xl">
        <Command
          loop
          className="flex flex-col"
          filter={(value, search) =>
            value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
          }
        >
          <div className="flex items-center gap-2 border-b border-line pb-3">
            <Search size={16} className="text-ink-3" />
            <Command.Input
              autoFocus
              placeholder="Search reservations, guests and more"
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          <Command.List className="max-h-80 overflow-y-auto pt-2">
            <Command.Empty className="px-2 py-6 text-center text-sm text-ink-3">
              Nothing matches that.
            </Command.Empty>

            {NAV.map((group) => (
              <Command.Group
                key={group.label}
                heading={group.label}
                className="px-1 pb-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-ink-3"
              >
                {group.items.map((item) => (
                  <Command.Item
                    key={item.href}
                    value={`${group.label} ${item.label}`}
                    onSelect={() => go(item.href)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-ink outline-none data-[selected=true]:bg-surface-2"
                  >
                    <item.icon size={15} className="text-ink-3" />
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </SheetContent>
    </Sheet>
  );
}
