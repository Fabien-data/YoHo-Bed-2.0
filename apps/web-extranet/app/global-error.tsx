'use client';

import { ErrorScreen } from '@/components/error-screen';
import './globals.css';

/**
 * The last line of defence: a crash in the root layout itself. It replaces the whole document,
 * so it brings its own <html> and stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg px-4 font-sans">
        <ErrorScreen error={error} reset={reset} homeHref="/" />
      </body>
    </html>
  );
}
