'use client';

import { useState } from 'react';
import Link from 'next/link';
import { forgotPassword } from '@/lib/api';
import { Button, Card, Field, Logo } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await forgotPassword(email).catch(() => undefined); // always shows success — no enumeration
    setDone(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ThemeToggle floating />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={30} />
        </div>
        <Card className="p-7">
          <h1 className="text-xl font-bold tracking-tight text-ink">Reset your password</h1>
          {done ? (
            <p className="mt-2 text-sm text-ink-2">
              If that account exists, a reset link is on its way. Check your inbox — the link is
              valid for 60 minutes.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : 'Send reset link'}
              </Button>
            </form>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-ink-3">
          <Link href="/" className="font-semibold text-brand-ink">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
