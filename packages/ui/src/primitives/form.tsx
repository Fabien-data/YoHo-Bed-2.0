'use client';

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { CaretDown, Check, Minus } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

const CONTROL =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink outline-none ' +
  'transition duration-1 placeholder:text-ink-3 hover:border-ink-3 ' +
  'focus-visible:border-brass focus-visible:ring-2 focus-visible:ring-brass-soft ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line-strong';

const FLOATING_MOTION =
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 ' +
  'duration-2 ease-smooth';

// --- Input / Field -----------------------------------------------------------

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(CONTROL, 'h-9 py-2', className)} {...props} />;
});

/** A multi-line control on the same visual contract as Input. */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(CONTROL, 'min-h-20 py-2', className)} {...props} />;
});

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
  /**
   * Label a control by id instead of wrapping it. Needed for a composite control (a date input
   * with a calendar button): a wrapping label forwards every click inside it to the first
   * button, which would open the calendar whenever the text was clicked.
   */
  htmlFor?: string;
}

/** Label + control + hint/error. `error` replaces `hint` so the two never stack and fight. */
export function Field({ label, hint, error, required, children, className, htmlFor }: FieldProps) {
  const Root = htmlFor ? 'div' : 'label';
  const Title = htmlFor ? 'label' : 'span';
  return (
    <Root
      className={cn(
        'flex w-full flex-col gap-1.5',
        // An invalid field colors its own control — helper text alone is too easy to miss.
        error &&
          '[&_input]:border-closed [&_textarea]:border-closed [&_button]:border-closed [&_select]:border-closed',
        className,
      )}
    >
      <Title {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-closed-ink">*</span>}
      </Title>
      {children}
      {error ? (
        <span className="text-xs font-medium text-closed-ink">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-3">{hint}</span>
      ) : null}
    </Root>
  );
}

// --- Select ------------------------------------------------------------------

/**
 * Radix's Select, minus one echo. Inside a `<form>` Radix renders a hidden native `<select>` for
 * autofill; when a controlled value arrives before that select has the matching option (a room
 * type's rate types are still mounting, say), the browser falls back to "" and Radix reports the
 * resulting change event as if the user had chosen "". No item can have the value "" — Radix
 * forbids it — so an empty-string change is always that echo, and is dropped here.
 */
export function Select({
  onValueChange,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return (
    <SelectPrimitive.Root
      {...props}
      onValueChange={(v) => {
        if (v !== '') onValueChange?.(v);
      }}
    />
  );
}
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        CONTROL,
        // One line, however long the chosen item's label: the trigger never grows or wraps.
        'flex h-9 items-center justify-between gap-2 whitespace-nowrap py-2 text-left [&>span]:min-w-0 [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <CaretDown size={13} className="shrink-0 text-ink-3" />
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
          'z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-raised',
          FLOATING_MOTION,
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
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    /** Muted text on the right of the option — "4 left", a price. Shown in the list only. */
    hint?: React.ReactNode;
  }
>(function SelectItem({ className, children, hint, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        'relative flex cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-2.5 text-sm',
        'text-ink outline-none transition duration-1 data-[highlighted]:bg-surface-2',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={14} weight="bold" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      {hint !== undefined && hint !== null && (
        <span className="ml-auto pl-3 text-xs tabular-nums text-ink-3">{hint}</span>
      )}
    </SelectPrimitive.Item>
  );
});

/** A heading over a run of options, e.g. "OTA" above Booking.com and Agoda. */
export function SelectGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <SelectPrimitive.Group>
      {label && (
        <SelectPrimitive.Label className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
          {label}
        </SelectPrimitive.Label>
      )}
      {children}
    </SelectPrimitive.Group>
  );
}

export function SelectSeparator() {
  return <SelectPrimitive.Separator className="my-1 h-px bg-line" />;
}

// --- Switch / Checkbox -------------------------------------------------------

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition duration-2',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-brand data-[state=unchecked]:bg-line-strong',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-surface shadow-card transition duration-2 ease-smooth data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
});

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  // `checked="indeterminate"` is the "some rows selected" state of a select-all box.
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer h-4 w-4 shrink-0 rounded border border-line-strong bg-surface transition duration-1',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=checked]:text-white',
        'data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand data-[state=indeterminate]:text-white',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        {props.checked === 'indeterminate' ? (
          <Minus size={12} weight="bold" />
        ) : (
          <Check size={12} weight="bold" />
        )}
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
        'text-sm font-medium text-ink-3 transition duration-1 -mb-px',
        'hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass',
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
