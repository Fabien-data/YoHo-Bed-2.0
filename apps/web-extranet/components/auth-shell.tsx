'use client';

import { Card, cn } from '@yohobed/ui';
import { ThemeToggle } from '@/components/theme';
import { Logo } from '@/components/logo';

/**
 * The one public-page treatment: centred card, brand mark above, ambient ink-and-brass glows
 * behind. Every unauthenticated surface (sign in, register, forgot/reset, guest review) uses
 * this shell so the front door always looks like the same product.
 */
export function AuthShell({
  children,
  footer,
  width = 'sm',
}: {
  children: React.ReactNode;
  /** Small helper line under the card — links to the other auth pages. */
  footer?: React.ReactNode;
  width?: 'sm' | 'lg';
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(110% 90% at 88% -12%, var(--brand-soft), transparent 55%), ' +
            'radial-gradient(90% 80% at 8% 115%, var(--brass-soft), transparent 52%)',
        }}
      />
      <ThemeToggle floating />
      <div className={cn('relative w-full', width === 'lg' ? 'max-w-lg' : 'max-w-sm')}>
        <div className="mb-6 flex justify-center">
          <Logo size={32} />
        </div>
        <Card className="p-7">{children}</Card>
        {footer && <p className="mt-4 text-center text-xs text-ink-3">{footer}</p>}
      </div>
    </main>
  );
}

/** Inline error banner for auth forms. */
export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-closed-soft px-3 py-2 text-sm font-medium text-closed-ink">
      {children}
    </p>
  );
}

/** Inline notice banner (session expired, pending approval …). */
export function AuthNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg bg-low-soft px-3 py-2 text-sm font-medium text-low-ink">{children}</p>
  );
}
