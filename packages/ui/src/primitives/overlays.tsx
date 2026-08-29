'use client';

import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../lib/cn';

/** Shared enter/exit choreography for floating panels (requires tailwindcss-animate). */
const FLOATING_MOTION =
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ' +
  'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 ' +
  'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 ' +
  'duration-2 ease-smooth';

const PANEL = 'z-50 rounded-xl border border-line bg-surface p-3 shadow-raised outline-none';

// --- Popover -----------------------------------------------------------------
// Date pickers, the notification centre, the quick-menu grid.

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(function PopoverContent({ className, align = 'end', sideOffset = 8, ...props }, ref) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(PANEL, FLOATING_MOTION, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

// --- Tooltip -----------------------------------------------------------------
// An inverted chip — unmistakably a label, never confusable with a popover surface.

export const TooltipProvider = TooltipPrimitive.Provider;
export const TooltipRoot = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipVariant = 'chip' | 'panel';

const TOOLTIP_VARIANTS: Record<TooltipVariant, string> = {
  /** Short labels — an inverted chip, unmistakably a caption. */
  chip: 'rounded-md bg-ink px-2.5 py-1.5 text-xs font-medium text-surface shadow-raised',
  /** Rich hover cards (the stay-view guest card) — a real surface panel. */
  panel: 'rounded-xl border border-line bg-surface p-2.5 text-xs text-ink shadow-raised',
};

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & { variant?: TooltipVariant }
>(function TooltipContent({ className, sideOffset = 6, variant = 'chip', ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 max-w-xs', TOOLTIP_VARIANTS[variant], FLOATING_MOTION, className)}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
});

/** The common case: an element that shows a short label on hover/focus. */
export function Tooltip({
  label,
  children,
  side = 'top',
  variant = 'chip',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  variant?: TooltipVariant;
}) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} variant={variant}>
        {label}
      </TooltipContent>
    </TooltipRoot>
  );
}
