'use client';

import * as React from 'react';
import { Button, Dialog, DialogContent, Field, InlineAlert, Input } from '@yohobed/ui';
import { ApiError, stepUpApproval, type ApprovalAction } from '@/lib/api';

const WHAT: Record<ApprovalAction, string> = {
  rate_override: 'This reservation has a rate below the desk’s discount limit',
  complimentary: 'This reservation has a complimentary room',
  tax_exempt: 'This reservation has a tax exemption',
  refund: 'Money is being given back to the guest',
  checkout_balance: 'The guest is leaving with money still owed',
};

/**
 * The owner approves one decision on the desk's screen (POST /auth/step-up). The token it
 * returns covers that one action for ten minutes; nothing else is unlocked, and the desk user
 * stays signed in as themselves.
 */
export function ApprovalDialog<A extends ApprovalAction>({
  actions,
  reason,
  open,
  onOpenChange,
  onApproved,
}: {
  actions: A[];
  reason: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApproved: (tokens: Partial<Record<A, string>>, approver: string) => void;
}) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
    }
  }, [open]);

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    try {
      const tokens: Partial<Record<A, string>> = {};
      let approver = '';
      for (const action of actions) {
        const r = await stepUpApproval({
          email: email.trim(),
          password,
          action,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        });
        tokens[action] = r.approvalToken;
        approver = r.approver.name;
      }
      onApproved(tokens, approver);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Owner approval" className="max-w-md">
        <form onSubmit={approve} className="flex flex-col gap-4 px-5 py-4">
          <p className="text-sm text-ink-2">
            {actions.map((a) => WHAT[a]).join('; ')}. An owner of the property signs in here to
            approve it — just this once.
          </p>
          <Field label="Owner email">
            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Owner password">
            <Input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          {error && <InlineAlert tone="error">{error}</InlineAlert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!email.trim() || !password}>
              Approve
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
