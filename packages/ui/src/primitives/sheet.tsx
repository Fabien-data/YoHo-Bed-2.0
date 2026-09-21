'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

/**
 * The right-hand slide-over.
 *
 * This is the single most-used pattern in the target UX: Yanolja opens reservation detail, rate
 * thresholds, channel passwords, auto-stopsell and every audit trail in one, rather than
 * navigating away. Built on Radix Dialog so focus trapping, scroll locking, Escape and
 * `aria-modal` are handled rather than reimplemented.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export type SheetSide = 'right' | 'left' | 'bottom';

const SIDES: Record<SheetSide, string> = {
  right:
    'inset-y-0 right-0 h-full w-full border-l sm:max-w-xl sm:rounded-l-2xl ' +
    'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  left:
    'inset-y-0 left-0 h-full w-full border-r sm:max-w-xl sm:rounded-r-2xl ' +
    'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
  bottom:
    'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t ' +
    'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
};

export interface SheetContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  side?: SheetSide;
  /** Accessible name. Rendered as the visible header unless `hideTitle`. */
  title: string;
  description?: string;
  hideTitle?: boolean;
  /** Pinned to the bottom, outside the scroll area — for Save/Cancel or a money summary. */
  footer?: React.ReactNode;
  /** Rendered on the header row, right of the title — for actions like Export or Audit Trail. */
  headerActions?: React.ReactNode;
  /** Keep the workspace usable behind a non-modal sheet. */
  showOverlay?: boolean;
  wide?: boolean;
  /**
   * `half`: half the screen on a desktop — Yanolja's Quick Reservation, wide enough for a room
   * grid while the tape chart behind it stays in view. Full width on a phone.
   */
  size?: 'default' | 'wide' | 'half';
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    side = 'right',
    title,
    description,
    hideTitle,
    footer,
    headerActions,
    showOverlay = true,
    wide,
    size = 'default',
    className,
    children,
    ...props
  },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      {showOverlay && (
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'data-[state=open]:duration-3 data-[state=closed]:duration-2',
          )}
        />
      )}
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col border-line bg-surface shadow-overlay outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=open]:duration-3 data-[state=closed]:duration-2 ease-smooth',
          SIDES[side],
          (wide || size === 'wide') && side !== 'bottom' && 'sm:max-w-3xl',
          size === 'half' && side !== 'bottom' && 'sm:max-w-3xl lg:w-1/2 lg:max-w-none',
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title
              className={cn(
                'truncate text-base font-semibold tracking-tight text-ink',
                hideTitle && 'sr-only',
              )}
            >
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs text-ink-3">
                {description}
              </DialogPrimitive.Description>
            ) : (
              // Radix warns when Content has no Description; declare its absence explicitly.
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          {headerActions}
          <DialogPrimitive.Close
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-3 transition duration-1 hover:bg-surface-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
          >
            <X size={16} />
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <div className="border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
