'use client';

import { useState } from 'react';
import Link from 'next/link';
import { register, ApiError } from '@/lib/api';
import { Button, Field, Input } from '@yohobed/ui';
import { AuthShell, AuthError } from '@/components/auth-shell';

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
    <AuthShell
      footer={
        !done && (
          <>
            Already have an account?{' '}
            <Link href="/" className="font-semibold text-brand-ink">
              Sign in
            </Link>
          </>
        )
      }
    >
      {done ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Registration received</h1>
          <p className="mt-2 text-sm text-ink-2">
            You can sign in now and start setting up your property. Our team will review and
            activate your account shortly — you&rsquo;ll get an email when it&rsquo;s approved.
          </p>
          <Button asChild className="mt-5 w-full">
            <Link href="/">Go to sign in</Link>
          </Button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Create your account</h1>
          <p className="mb-6 mt-1 text-sm text-ink-2">
            List your property on YoHoBed. Free to register.
          </p>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field label="Your name" required>
              <Input
                value={form.ownerName}
                onChange={(e) => setForm((f) => ({ ...f, ownerName: e.target.value }))}
                placeholder="e.g. A. Fernando"
                required
              />
            </Field>
            <Field label="Property / business name" required>
              <Input
                value={form.businessName}
                onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
                placeholder="e.g. Lagoon View Villa"
                required
              />
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Password (min 8 characters)" required>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            {error && <AuthError>{error}</AuthError>}
            <Button type="submit" loading={busy} className="mt-1 w-full">
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
