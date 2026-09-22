'use client';

import { ErrorScreen } from '@/components/error-screen';

/** A crash inside the PMS keeps the app shell and offers a way back (UX-0). */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen error={error} reset={reset} />;
}
