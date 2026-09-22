'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, InlineAlert, Skeleton, toast } from '@yohobed/ui';
import { ApiError, describeError, recordFolioPayment, type FolioPaymentRow } from '@/lib/api';
import { usePaymentMethods } from '@/lib/queries';
import { useUxTask } from '@/lib/ux';
import {
  PaymentFields,
  emptyPayment,
  paymentProblems,
  type PaymentDraft,
} from '@/components/payments/payment-fields';

const LAST_METHOD_KEY = 'yhb_last_payment_method';

function rememberedMethod(): string | null {
  try {
    return localStorage.getItem(LAST_METHOD_KEY);
  } catch {
    return null;
  }
}

/**
 * Taking a payment on a bill (UX-1b), one form everywhere money is taken at the desk — the folio,
 * check-in, check-out. The amount owed is filled in and the method the desk used last (or the
 * hotel's default cash) is chosen, so the common case is one press. A payment that looks like the
 * previous one entered twice is caught by the server and confirmed here in one more press.
 */
export function TakePaymentForm({
  folioId,
  suggested,
  currency,
  onDone,
  submitLabel = 'Record payment',
  compact,
}: {
  folioId: string;
  suggested: number;
  currency: string;
  onDone: (row: FolioPaymentRow) => void;
  submitLabel?: string;
  compact?: boolean;
}) {
  const methods = usePaymentMethods();
  // Moving a balance to a company is "Charge to company", not a payment method here. A method in
  // another currency is left out: the amount is recorded in the bill's currency.
  const options = React.useMemo(
    () =>
      (methods.data ?? []).filter(
        (m) => m.active && m.category !== 'city_ledger' && (!m.currency || m.currency === currency),
      ),
    [methods.data, currency],
  );
  const [payment, setPayment] = React.useState<PaymentDraft>(() => ({
    ...emptyPayment(),
    amount: suggested > 0 ? suggested.toFixed(2) : '',
  }));
  const [tried, setTried] = React.useState(false);
  const [duplicate, setDuplicate] = React.useState<string | null>(null);
  const ux = useUxTask('folio.take_payment', true);

  // Choose a method once the list arrives: the last one used here, else the default cash.
  React.useEffect(() => {
    if (payment.methodId || options.length === 0) return;
    const last = rememberedMethod();
    const pick =
      options.find((m) => m.id === last) ??
      options.find((m) => m.isDefaultCash) ??
      options.find((m) => m.category === 'cash') ??
      options[0];
    if (pick) setPayment((p) => ({ ...p, methodId: pick.id }));
  }, [options, payment.methodId]);

  const problems = paymentProblems(payment, options, null);

  const pay = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      recordFolioPayment(folioId, {
        amount: Number(Number(payment.amount).toFixed(2)),
        paymentMethodId: payment.methodId!,
        reference: payment.reference.trim() || undefined,
        fileId: payment.file?.id,
        confirmDuplicate: confirmDuplicate || undefined,
      }),
    onSuccess: (row) => {
      try {
        localStorage.setItem(LAST_METHOD_KEY, payment.methodId!);
      } catch {
        // Remembering the method is a convenience; the payment is already recorded.
      }
      setDuplicate(null);
      ux.complete();
      toast.success(
        row.receiptNo ? `Payment recorded · receipt ${row.receiptNo}` : 'Payment recorded',
      );
      onDone(row);
    },
    onError: (e) => {
      if (
        e instanceof ApiError &&
        (e.data as { reason?: string })?.reason === 'possible_duplicate'
      ) {
        setDuplicate(e.message);
      }
    },
  });

  function submit(confirmDuplicate = false) {
    setTried(true);
    if (!payment.methodId || Object.keys(problems).length > 0) return;
    pay.mutate(confirmDuplicate);
  }

  if (methods.isLoading) return <Skeleton className="h-10 w-full" />;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        submit();
      }}
      className={compact ? 'space-y-3' : 'space-y-3 rounded-lg border border-line p-3'}
    >
      <PaymentFields
        methods={options}
        value={payment}
        onChange={(next) => {
          setDuplicate(null);
          setPayment(next);
        }}
        currency={currency}
        max={null}
        showErrors={tried}
        idPrefix={`pay-${folioId}`}
        className="max-w-md"
      />
      {tried && !payment.methodId && (
        <p className="text-xs font-medium text-closed-ink">Choose how the guest paid.</p>
      )}
      {duplicate ? (
        <InlineAlert tone="warn">
          <p>{duplicate}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" type="button" onClick={() => submit(true)} loading={pay.isPending}>
              Yes, record a second payment
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={() => setDuplicate(null)}>
              No, it was the same one
            </Button>
          </div>
        </InlineAlert>
      ) : (
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" loading={pay.isPending} disabled={pay.isPending}>
            {submitLabel}
          </Button>
          {pay.isError && (
            <span className="text-sm text-closed-ink">{describeError(pay.error)}</span>
          )}
        </div>
      )}
    </form>
  );
}
