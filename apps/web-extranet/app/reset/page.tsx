'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { resetPassword, ApiError } from '@/lib/api';
import { Button, Field, Input } from '@yohobed/ui';
import { AuthShell, AuthError } from '@/components/auth-shell';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <p className="mt-2 text-sm text-ink-2">
        This link is missing its token. Request a new one from{' '}
        <Link href="/forgot" className="font-semibold text-brand-ink">
          reset password
        </Link>
        .
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
      <Field label="New password (min 8 characters)" required>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      {error && <AuthError>{error}</AuthError>}
      <Button type="submit" loading={busy} className="w-full">
        {busy ? 'Updating…' : 'Set new password'}
      </Button>
    </form>
  );
}

export default function ResetPage() {
  return (
    <AuthShell>
      <h1 className="text-xl font-semibold tracking-tight text-ink">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
