'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getProfile,
  setPayoutAccount,
  acceptAgreement,
  changePassword,
  ApiError,
  type Profile,
} from '@/lib/api';
import { Button, Card, Field, Pill } from '@/components/ui';

function statusTone(s: string): 'avail' | 'low' | 'closed' | 'muted' {
  if (s === 'active') return 'avail';
  if (s === 'pending') return 'low';
  return 'closed';
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<{ tone: 'avail' | 'closed'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [bank, setBank] = useState({
    bankName: '',
    branchName: '',
    accountName: '',
    accountNumber: '',
    swiftCode: '',
  });
  const [pw, setPw] = useState({ current: '', next: '' });

  const load = useCallback(async () => {
    const p = await getProfile();
    setProfile(p);
    if (p.payoutAccount) {
      setBank({
        bankName: p.payoutAccount.bankName,
        branchName: p.payoutAccount.branchName ?? '',
        accountName: p.payoutAccount.accountName,
        accountNumber: p.payoutAccount.accountNumber,
        swiftCode: p.payoutAccount.swiftCode ?? '',
      });
    }
  }, []);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function run(fn: () => Promise<void>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
      setMsg({ tone: 'avail', text: okText });
    } catch (e) {
      setMsg({ tone: 'closed', text: e instanceof ApiError ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }

  if (!profile) return null;

  return (
    <div>
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">Account</div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Profile</h1>
        <Pill tone={statusTone(profile.tenant.status)}>{profile.tenant.status}</Pill>
      </div>

      {msg && (
        <div
          className="mt-4 rounded-lg px-3 py-2 text-sm font-medium"
          style={{
            color: msg.tone === 'avail' ? 'var(--avail-ink)' : 'var(--closed-ink)',
            background: msg.tone === 'avail' ? 'var(--avail-soft)' : 'var(--closed-soft)',
          }}
        >
          {msg.text}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink">Your details</h2>
          <dl className="grid grid-cols-[auto,1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-3">Name</dt>
            <dd className="font-medium text-ink">{profile.user.name}</dd>
            <dt className="text-ink-3">Email</dt>
            <dd className="font-medium text-ink">{profile.user.email}</dd>
            <dt className="text-ink-3">Business</dt>
            <dd className="font-medium text-ink">{profile.tenant.name}</dd>
          </dl>

          <h2 className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-ink">
            Platform agreement
          </h2>
          {profile.tenant.agreementAcceptedAt ? (
            <p className="text-sm text-ink-2">
              Accepted on{' '}
              <span className="font-mono">
                {new Date(profile.tenant.agreementAcceptedAt).toLocaleDateString()}
              </span>
              .
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-2">
                Review and accept the YoHoBed property agreement — commission terms, payout
                schedule, and cancellation handling.
              </p>
              <Button
                disabled={busy}
                onClick={() => run(async () => void (await acceptAgreement()), 'Agreement accepted.')}
              >
                Accept agreement
              </Button>
            </>
          )}

          <h2 className="mb-3 mt-6 text-sm font-bold uppercase tracking-wide text-ink">
            Change password
          </h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await changePassword(pw.current, pw.next);
                setPw({ current: '', next: '' });
              }, 'Password updated.');
            }}
          >
            <Field
              label="Current password"
              type="password"
              value={pw.current}
              onChange={(e) => setPw((v) => ({ ...v, current: e.target.value }))}
              autoComplete="current-password"
              required
            />
            <Field
              label="New password (min 8 characters)"
              type="password"
              value={pw.next}
              onChange={(e) => setPw((v) => ({ ...v, next: e.target.value }))}
              autoComplete="new-password"
              minLength={8}
              required
            />
            <Button type="submit" variant="secondary" disabled={busy} className="self-start">
              Update password
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink">Payout account</h2>
          <p className="mb-4 text-sm text-ink-2">
            Where your settlement (net payable) is sent. Payout statements use these details.
          </p>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                async () =>
                  void (await setPayoutAccount({
                    bankName: bank.bankName.trim(),
                    branchName: bank.branchName.trim() || undefined,
                    accountName: bank.accountName.trim(),
                    accountNumber: bank.accountNumber.trim(),
                    swiftCode: bank.swiftCode.trim() || undefined,
                  })),
                'Payout account saved.',
              );
            }}
          >
            <Field
              label="Bank"
              value={bank.bankName}
              onChange={(e) => setBank((v) => ({ ...v, bankName: e.target.value }))}
              placeholder="e.g. Commercial Bank of Ceylon"
              required
            />
            <Field
              label="Branch (optional)"
              value={bank.branchName}
              onChange={(e) => setBank((v) => ({ ...v, branchName: e.target.value }))}
              placeholder="e.g. Kollupitiya"
            />
            <Field
              label="Account holder name"
              value={bank.accountName}
              onChange={(e) => setBank((v) => ({ ...v, accountName: e.target.value }))}
              required
            />
            <Field
              label="Account number"
              value={bank.accountNumber}
              onChange={(e) => setBank((v) => ({ ...v, accountNumber: e.target.value }))}
              required
            />
            <Field
              label="SWIFT code (optional)"
              value={bank.swiftCode}
              onChange={(e) => setBank((v) => ({ ...v, swiftCode: e.target.value.toUpperCase() }))}
              placeholder="CCEYLKLX"
            />
            <Button type="submit" disabled={busy} className="self-start">
              {profile.payoutAccount ? 'Update payout account' : 'Save payout account'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
