'use client';

import { ErrorScreen } from '@/components/error-screen';

/** Public pages (sign-in, the guest voucher) get the same honest error screen. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-bg px-4">
      <ErrorScreen error={error} reset={reset} homeHref="/" />
    </main>
  );
}
