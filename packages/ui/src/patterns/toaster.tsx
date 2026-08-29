'use client';

import { Toaster as SonnerToaster } from 'sonner';

export { toast } from 'sonner';

/**
 * The app-wide toast outlet, styled on the token system. Mount once near the root;
 * fire notifications from anywhere with `toast(...)` / `toast.success(...)` / `toast.error(...)`.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      gap={8}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group pointer-events-auto flex w-full items-center gap-2.5 rounded-xl border border-line ' +
            'bg-surface px-4 py-3 text-sm text-ink shadow-overlay',
          title: 'font-semibold',
          description: 'text-xs text-ink-2',
          actionButton:
            'ml-auto shrink-0 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-white',
          cancelButton:
            'ml-auto shrink-0 rounded-lg border border-line-strong px-2.5 py-1 text-xs font-semibold text-ink-2',
          success: '[&_[data-icon]]:text-avail-ink',
          error: '[&_[data-icon]]:text-closed-ink',
          warning: '[&_[data-icon]]:text-low-ink',
          info: '[&_[data-icon]]:text-info-ink',
        },
      }}
    />
  );
}
