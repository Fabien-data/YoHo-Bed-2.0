'use client';

import { useState } from 'react';
import Link from 'next/link';
import { register, ApiError } from '@/lib/api';
import { Button, Card, Field, Logo } from '@/components/ui';
import { ThemeToggle } from '@/components/theme';

export default function RegisterPage() {
  const [form, setForm] = useState({ ownerName: '', businessName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        backgroundImage:
          'radial-gradient(120% 100% at 85% -10%, var(--brand-soft), transparent 55%), radial-gradient(100% 90% at 10% 120%, rgba(12,110,102,0.10), transparent 50%)',
      }}
    >
      <ThemeToggle floating />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={30} />
        </div>
        <Card className="p-7">
          {done ? (
            <>
              <h1 className="text-xl font-bold tracking-tight text-ink">Registration received</h1>
              <p className="mt-2 text-sm text-ink-2">
                You can sign in now and start setting up your property. Our team will review and
                activate your account shortly — you&rsquo;ll get an email when it&rsquo;s approved.
              </p>
              <Link href="/">
                <Button className="mt-5 w-full">Go to sign in</Button>
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold tracking-tight text-ink">Create your account</h1>
              <p className="mb-6 mt-1 text-sm text-ink-2">
                List your property on YoHoBed. Free to register.
              </p>
              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                <Field
                  label="Your name"
                  value={form.ownerName}
                  onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
                  placeholder="e.g. A. Fernando"
                  required
                />
                <Field
                  label="Property / business name"
                  value={form.businessName}
                  onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
                  placeholder="e.g. Lagoon View Villa"
                  required
                />
                <Field
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  autoComplete="username"
                  required
                />
                <Field
                  label="Password (min 8 characters)"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                {error && (
                  <p
                    className="rounded-lg px-3 py-2 text-sm font-medium"
                    style={{ color: 'var(--closed-ink)', background: 'var(--closed-soft)' }}
                  >
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy} className="mt-1 w-full">
                  {busy ? 'Creating…' : 'Create account'}
                </Button>
              </form>
            </>
          )}
        </Card>
        {!done && (
          <p className="mt-4 text-center text-xs text-ink-3">
            Already have an account?{' '}
            <Link href="/" className="font-semibold text-brand-ink">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
