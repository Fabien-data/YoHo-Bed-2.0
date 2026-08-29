'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, PageHeader, toast } from '@yohobed/ui';
import {
  getProfile,
  setPayoutAccount,
  acceptAgreement,
  changePassword,
  ApiError,
  type Profile,
} from '@/lib/api';

function statusTone(s: string): 'avail' | 'low' | 'closed' | 'muted' {
  if (s === 'active') return 'avail';
  if (s === 'pending') return 'low';
  return 'closed';
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    // A non-401 failure must not leave a permanently blank page with no message or retry.
    load()
      .then(() => setLoadError(null))
      .catch((e) =>
        setLoadError(e instanceof Error ? e.message : 'Your profile could not be loaded'),
      );
  }, [load]);

  async function run(fn: () => Promise<void>, okText: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      toast.success(okText);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    if (!loadError) return null;
    return (
      <div>
        <PageHeader eyebrow="Configuration" title="Profile" />
        <Card className="mt-6 p-8">
          <h2 className="text-lg font-bold text-ink">Your profile could not be loaded</h2>
          <p className="mt-2 max-w-xl text-sm text-ink-2">{loadError}.</p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() =>
              void load()
                .then(() => setLoadError(null))
                .catch((e) =>
                  setLoadError(e instanceof Error ? e.message : 'Your profile could not be loaded'),
                )
            }
          >
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Configuration"
        title="Profile"
        actions={<Badge tone={statusTone(profile.tenant.status)}>{profile.tenant.status}</Badge>}
      />

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
                loading={busy}
                onClick={() =>
                  void run(async () => void (await acceptAgreement()), 'Agreement accepted.')
                }
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
              void run(async () => {
                await changePassword(pw.current, pw.next);
                setPw({ current: '', next: '' });
              }, 'Password updated.');
            }}
          >
            <Field label="Current password" required>
              <Input
                type="password"
                value={pw.current}
                onChange={(e) => setPw((v) => ({ ...v, current: e.target.value }))}
                autoComplete="current-password"
                required
              />
            </Field>
            <Field label="New password (min 8 characters)" required>
              <Input
                type="password"
                value={pw.next}
                onChange={(e) => setPw((v) => ({ ...v, next: e.target.value }))}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Field>
            <Button type="submit" variant="secondary" loading={busy} className="self-start">
              Update password
            </Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink">
            Payout account
          </h2>
          <p className="mb-4 text-sm text-ink-2">
            Where your settlement (net payable) is sent. Payout statements use these details.
          </p>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
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
            <Field label="Bank" required>
              <Input
                value={bank.bankName}
                onChange={(e) => setBank((v) => ({ ...v, bankName: e.target.value }))}
                placeholder="e.g. Commercial Bank of Ceylon"
                required
              />
            </Field>
            <Field label="Branch (optional)">
              <Input
                value={bank.branchName}
                onChange={(e) => setBank((v) => ({ ...v, branchName: e.target.value }))}
                placeholder="e.g. Kollupitiya"
              />
            </Field>
            <Field label="Account holder name" required>
              <Input
                value={bank.accountName}
                onChange={(e) => setBank((v) => ({ ...v, accountName: e.target.value }))}
                required
              />
            </Field>
            <Field label="Account number" required>
              <Input
                value={bank.accountNumber}
                onChange={(e) => setBank((v) => ({ ...v, accountNumber: e.target.value }))}
                required
              />
            </Field>
            <Field label="SWIFT code (optional)">
              <Input
                value={bank.swiftCode}
                onChange={(e) =>
                  setBank((v) => ({ ...v, swiftCode: e.target.value.toUpperCase() }))
                }
                placeholder="CCEYLKLX"
              />
            </Field>
            <Button type="submit" loading={busy} className="self-start">
              {profile.payoutAccount ? 'Update payout account' : 'Save payout account'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
