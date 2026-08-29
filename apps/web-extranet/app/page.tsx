'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, isStaff, ApiError } from '@/lib/api';
import { Button, Field, Input } from '@yohobed/ui';
import { AuthShell, AuthError, AuthNotice } from '@/components/auth-shell';

export default function LoginPage() {
  // Read straight off the URL rather than useSearchParams: that hook forces the whole page into
  // a Suspense boundary, which is a lot of ceremony for one flag. Read in an effect, not during
  // render — the server prerenders `false`, and a first-render `true` is a hydration mismatch
  // React may resolve by discarding exactly the notice this flag exists to show.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(new URLSearchParams(window.location.search).has('expired'));
  }, []);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(email, password);
      router.push(isStaff(user) ? '/staff' : '/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <AuthShell
      footer={
        <>
          New to YoHoBed?{' '}
          <a href="/register" className="font-semibold text-brand-ink">
            Create an account
          </a>{' '}
          ·{' '}
          <a href="/forgot" className="font-semibold text-brand-ink">
            Forgot password
          </a>
        </>
      }
    >
      <h1 className="text-xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mb-6 mt-1 text-sm text-ink-2">
        Manage your property&rsquo;s rates &amp; availability.
      </p>
      {expired && (
        <div className="mb-4">
          <AuthNotice>Your session expired. Please sign in again.</AuthNotice>
        </div>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </Field>
        <Field label="Password" required>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        {error && <AuthError>{error}</AuthError>}
        <Button type="submit" loading={busy} className="mt-1 w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
