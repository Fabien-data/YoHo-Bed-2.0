'use client';

import * as React from 'react';
import { WarningOctagon } from '@phosphor-icons/react';
import { Button, Card } from '@yohobed/ui';
import { getLastErrorRef } from '@/lib/api';
import { APP_VERSION, reportClientError } from '@/lib/ux';

function clientRef(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `C-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * What a crashed screen shows instead of a blank page (UX-0). One render error used to blank the
 * whole app with no way back; now the desk keeps the shell, can retry, and has a reference to
 * give support. Nothing they typed is lost from the server — only this screen failed.
 */
export function ErrorScreen({
  error,
  reset,
  homeHref = '/app',
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref?: string;
}) {
  const [ref] = React.useState(() => error.digest ?? clientRef());
  const apiRef = getLastErrorRef();

  React.useEffect(() => {
    // The message and stack stay in this browser's console, where support can ask for them;
    // only the fact of the crash and its route are measured.
    console.error(`[${ref}]`, error);
    reportClientError();
  }, [error, ref]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <Card className="p-8">
        <WarningOctagon size={28} className="text-closed" aria-hidden />
        <h1 className="mt-3 text-base font-semibold tracking-tight text-ink">
          This screen ran into a problem
        </h1>
        <p className="mt-2 text-sm text-ink-2">
          Nothing you already saved is affected. Try again, and if it keeps happening, contact
          YoHoBed support with this reference.
        </p>
        <dl className="mt-4 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-ink-3">Reference</dt>
          <dd className="font-mono text-ink">{ref}</dd>
          {apiRef && (
            <>
              <dt className="text-ink-3">Last request</dt>
              <dd className="font-mono text-ink">{apiRef}</dd>
            </>
          )}
          <dt className="text-ink-3">Version</dt>
          <dd className="font-mono text-ink">{APP_VERSION}</dd>
        </dl>
        <div className="mt-6 flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild>
            <a href={homeHref}>Go to the dashboard</a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
