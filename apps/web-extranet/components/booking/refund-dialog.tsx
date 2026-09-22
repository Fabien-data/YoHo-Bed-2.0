'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@yohobed/ui';
import { ApiError, describeError, refundFolio } from '@/lib/api';
import { usePaymentMethods, useTenantRole } from '@/lib/queries';
import { ApprovalDialog } from '@/components/reservations/composer/approval-dialog';
import { ReasonDialog } from './reason-dialog';

/**
 * Giving money back to a guest (UX-1b): an overpaid deposit, a goodwill gesture. Never more than
 * the bill has been paid, always with a reason, and — for anyone but the owner — the owner's
 * approval given on this screen.
 */
export function RefundDialog({
  folioId,
  paid,
  suggested,
  currency,
  open,
  onOpenChange,
  onDone,
}: {
  folioId: string;
  /** What this bill has been paid, net: the most that can be given back. */
  paid: number;
  suggested: number;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const role = useTenantRole();
  const methods = usePaymentMethods();
  const options = (methods.data ?? []).filter(
    (m) => m.active && m.category !== 'city_ledger' && (!m.currency || m.currency === currency),
  );
  const [amount, setAmount] = React.useState('');
  const [methodId, setMethodId] = React.useState('');
  const [pending, setPending] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setAmount(suggested > 0 ? Math.min(suggested, paid).toFixed(2) : '');
    setMethodId('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Choose the default cash method once the list has arrived (it may land after the dialog opens).
  React.useEffect(() => {
    if (!open || methodId || options.length === 0) return;
    const cash = options.find((m) => m.isDefaultCash) ?? options.find((m) => m.category === 'cash');
    setMethodId((cash ?? options[0]).id);
  }, [open, methodId, options]);

  const refund = useMutation({
    mutationFn: (v: { reason: string; approvalToken?: string }) =>
      refundFolio(folioId, {
        amount: Number(Number(amount).toFixed(2)),
        paymentMethodId: methodId,
        reason: v.reason,
        approvalToken: v.approvalToken,
      }),
    onSuccess: () => {
      toast.success(`Refunded ${currency} ${Number(amount).toFixed(2)}`);
      setPending(null);
      onOpenChange(false);
      onDone();
    },
  });

  const value = Number(amount);
  const amountProblem =
    !amount || !Number.isFinite(value) || value <= 0
      ? 'Enter the amount to give back'
      : value > paid + 0.004
        ? `At most ${currency} ${paid.toFixed(2)}, what has been paid`
        : null;

  return (
    <>
      <ReasonDialog
        open={open && pending === null}
        onOpenChange={onOpenChange}
        title="Give money back to the guest?"
        consequence={
          <>
            The refund is recorded on this bill and, if it is cash, taken out of the open till.
            {role !== 'OWNER' && ' The owner approves it on the next screen.'}
          </>
        }
        confirmLabel={role === 'OWNER' ? 'Refund' : 'Continue to approval'}
        destructive
        suggestions={['Deposit returned', 'Paid twice by mistake', 'Goodwill — guest complaint']}
        busy={refund.isPending}
        error={
          refund.isError
            ? refund.error instanceof ApiError
              ? refund.error.message
              : describeError(refund.error)
            : null
        }
        onConfirm={(reason) => {
          if (amountProblem || !methodId) return;
          if (role === 'OWNER') refund.mutate({ reason });
          else setPending(reason);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`Amount (${currency})`}
            error={amount ? (amountProblem ?? undefined) : undefined}
          >
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Given back as">
            <Select value={methodId} onValueChange={setMethodId}>
              <SelectTrigger aria-label="Refund method">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {options.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </ReasonDialog>
      <ApprovalDialog
        actions={['refund']}
        reason={pending ?? ''}
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        onApproved={(tokens) => {
          if (pending) refund.mutate({ reason: pending, approvalToken: tokens.refund });
        }}
      />
    </>
  );
}
