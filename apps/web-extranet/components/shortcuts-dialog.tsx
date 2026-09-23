'use client';

import * as React from 'react';
import { Dialog, DialogContent, Kbd } from '@yohobed/ui';

/** The keys the desk can use, and what each one does. */
const SHORTCUTS: Array<{ keys: string[]; what: string }> = [
  {
    keys: ['Ctrl', 'K'],
    what: 'Search reservations, guests and rooms — and check in or out from the result',
  },
  { keys: ['Alt', 'N'], what: 'Start a new reservation' },
  { keys: ['?'], what: 'This list' },
  { keys: ['↑', '↓'], what: 'Move through a list' },
  { keys: ['↵'], what: 'Open what is highlighted' },
  { keys: ['Esc'], what: 'Close the dialog, or cancel what you were typing' },
];

/**
 * The keyboard cheat-sheet (UX-2), opened with `?`.
 *
 * A front-desk agent with a queue should never have to reach for the mouse, but only if they know
 * the keys. This is where they find out, without leaving the screen they are on.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts" className="max-w-md">
        <ul className="flex flex-col divide-y divide-line px-5 py-2">
          {SHORTCUTS.map((s) => (
            <li key={s.keys.join('+')} className="flex items-start gap-4 py-2.5">
              <span className="flex shrink-0 gap-1 pt-0.5">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
              <span className="text-sm text-ink-2">{s.what}</span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Open the cheat-sheet on `?`, unless the person is typing — a guest called "Who?" must be
 * typeable into the name field without the help opening over it.
 */
export function useShortcutsKey(onOpen: () => void) {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable)
        return;
      e.preventDefault();
      onOpen();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);
}
