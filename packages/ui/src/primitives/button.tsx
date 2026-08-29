'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white shadow-card hover:brightness-110 active:brightness-95',
  secondary:
    'bg-surface text-ink border border-line-strong shadow-card hover:border-ink-3 active:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-line/60',
  outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-2 active:bg-line/60',
  danger: 'bg-closed text-white shadow-card hover:brightness-110 active:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-xs',
  md: 'h-9 gap-2 rounded-lg px-4 text-sm',
  icon: 'h-9 w-9 rounded-lg',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as the single child element instead of a `<button>` (Radix Slot). */
  asChild?: boolean;
  /** Shows a spinner and disables the button; the label stays for layout stability. */
  loading?: boolean;
}

/**
 * The one button. `asChild` lets a `<Link>` or a Radix trigger inherit the styling without
 * nesting an interactive element inside another — which is both invalid HTML and a11y-hostile.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    asChild = false,
    loading = false,
    className,
    children,
    ...props
  },
  ref,
) {
  const classes = cn(
    'inline-flex select-none items-center justify-center font-semibold transition duration-1 ease-smooth active:translate-y-px',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    className,
  );

  if (asChild) {
    // Radix Slot requires exactly one element child, so the spinner cannot be injected here —
    // `loading` is a real-<button> affordance only.
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      className={classes}
      disabled={loading || (props as { disabled?: boolean }).disabled}
      {...props}
    >
      {loading && (
        <span
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
