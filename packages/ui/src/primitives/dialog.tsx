'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

/**
 * The centered modal — the command palette, confirmations, anything that should interrupt
 * rather than slide in from an edge (that is `Sheet`'s job).
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /** Accessible name. Rendered as a visible header unless `hideTitle`. */
  title: string;
  description?: string;
  hideTitle?: boolean;
  /** Hide the corner close button — for surfaces with their own dismissal, like the palette. */
  hideClose?: boolean;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  { title, description, hideTitle, hideClose, className, children, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'duration-2',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-1/2 top-[18vh] z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden',
          'rounded-2xl border border-line bg-surface shadow-overlay outline-none',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          'duration-2 ease-smooth',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title
          className={cn(
            'border-b border-line px-5 py-4 text-base font-semibold tracking-tight text-ink',
            hideTitle && 'sr-only border-0 p-0',
          )}
        >
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          {description ?? title}
        </DialogPrimitive.Description>
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-3 transition duration-1 hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            <X size={16} />
          </DialogPrimitive.Close>
        )}
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
