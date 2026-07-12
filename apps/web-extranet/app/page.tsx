'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, ApiError } from '@/lib/api';
import { Button, Card, Field, Logo } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('owner@demo.yohobed.test');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push('/app');
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
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size={30} />
        </div>
        <Card className="p-7">
          <h1 className="text-xl font-bold tracking-tight text-ink">Sign in</h1>
          <p className="mb-6 mt-1 text-sm text-ink-2">Manage your property&rsquo;s rates &amp; availability.</p>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
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
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-ink-3">
          Demo: owner@demo.yohobed.test / password123
        </p>
      </div>
    </main>
  );
}
