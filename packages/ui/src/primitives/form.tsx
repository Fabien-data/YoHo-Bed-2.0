'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

const CONTROL =
  'w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink outline-none ' +
  'transition placeholder:text-ink-3 focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50';

// --- Input / Field -----------------------------------------------------------

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, 'h-9 py-2', className)} {...props} />;
});

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** Label + control + hint/error. `error` replaces `hint` so the two never stack and fight. */
export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <label className={cn('flex w-full flex-col gap-1.5', className)}>
      <span className="text-sm font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-[var(--closed-ink)]">*</span>}
      </span>
      {children}
      {error ? (
        <span className="text-xs text-[var(--closed-ink)]">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

// --- Select ------------------------------------------------------------------

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(CONTROL, 'flex h-9 items-center justify-between gap-2 py-2', className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={14} className="shrink-0 text-ink-3" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = 'popper', ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        className={cn(
          'z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl',
          position === 'popper' && 'translate-y-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-0">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-2.5 text-sm',
        'text-ink outline-none data-[highlighted]:bg-surface-2',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={14} />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

// --- Switch / Checkbox -------------------------------------------------------

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-brand data-[state=unchecked]:bg-[var(--line-strong)]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow transition data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
});

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded border border-line-strong transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

// --- Tabs --------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(function TabsList({ className, ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn('flex items-center gap-1 border-b border-line', className)}
      {...props}
    />
  );
});

/**
 * An underlined tab, optionally with a count — Yanolja labels every tab with its live count
 * (Reservations 4 · Arrivals 2 · Departures 3 · In-house 3) and staff navigate by those numbers.
 */
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { count?: number }
>(function TabsTrigger({ className, children, count, ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-3 py-2.5',
        'text-sm font-medium text-ink-3 transition -mb-px',
        'hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
        'data-[state=active]:border-brand data-[state=active]:text-ink',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-ink-2">
          {count}
        </span>
      )}
    </TabsPrimitive.Trigger>
  );
});
