'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'icon';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:brightness-110 shadow-sm',
  secondary: 'bg-surface-2 text-ink border border-line-strong hover:border-ink-3',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  outline: 'border border-line-strong bg-transparent text-ink hover:bg-surface-2',
  danger: 'bg-[var(--closed-ink)] text-white hover:brightness-110 shadow-sm',
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
}

/**
 * The one button. `asChild` lets a `<Link>` or a Radix trigger inherit the styling without
 * nesting an interactive element inside another — which is both invalid HTML and a11y-hostile.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', asChild = false, className, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center font-semibold transition',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});
