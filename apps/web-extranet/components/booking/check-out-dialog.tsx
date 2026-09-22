'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CalendarX, Envelope, Receipt, SignOut } from '@phosphor-icons/react';
import { Button, Checkbox, Dialog, DialogContent, InlineAlert, Skeleton, toast } from '@yohobed/ui';
import {
  changeDeparture,
  checkOutBooking,
  describeError,
  getBookingFolio,
  getCheckOutPreview,
  issueFolioInvoice,
  listInvoices,
  sendInvoice,
  undoCheckOut,
} from '@/lib/api';
import { useTenantRole } from '@/lib/queries';
import { useUxTask } from '@/lib/ux';
import { ApprovalDialog } from '@/components/reservations/composer/approval-dialog';
import { ReasonDialog } from './reason-dialog';
import { RefundDialog } from './refund-dialog';
import { TakePaymentForm } from './take-payment-form';
import { useRefreshDesk } from './refresh';
import type { DeskBooking } from './check-in-dialog';

/**
 * Checking a guest out (UX-1b) — settle, invoice, email and check out in ONE dialog, where it used
 * to take about sixteen presses over three screens. It opens on a dry run of the real check-out,
 * so it knows exactly what the guest still owes after any company bill moves to the city ledger.
 * The amount owed is filled in and the usual payment method chosen, so a guest paying at the desk
 * is: open, Record payment, Check out (docs/UX-STANDARD.md §3, ≤ 5C).
 */
export function CheckOutDialog({
  booking,
  open,
  onOpenChange,
}: {
  booking: DeskBooking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshDesk();
  const role = useTenantRole();
  const ux = useUxTask('stay.check_out', open);
  const id = booking?.id ?? '';

  const preview = useQuery({
    queryKey: ['check-out-preview', id],
    queryFn: () => getCheckOutPreview(id),
    enabled: open && Boolean(id),
    staleTime: 0,
  });
  const folio = useQuery({
    queryKey: ['folio', id],
    queryFn: () => getBookingFolio(id),
    enabled: open && Boolean(id),
  });
  // The guest's own bill: window 1, unless the stay is billed to a company.
  const guestWindow = folio.data?.windows.find((w) => !w.payerLedgerAccountId) ?? null;
  const documents = useQuery({
    queryKey: ['invoices', 'folio', guestWindow?.id],
    queryFn: () => listInvoices({ folioId: guestWindow!.id }),
    enabled: open && Boolean(guestWindow),
  });
  const alreadyInvoiced = (documents.data ?? []).some(
    (d) => !d.creditedAt && d.kind !== 'credit_note' && d.kind !== 'proforma',
  );
  const canInvoice =
    Boolean(guestWindow) &&
    !alreadyInvoiced &&
    (guestWindow?.lines.some((l) => !l.voidedAt) ?? false);

  const [invoice, setInvoice] = React.useState(true);
  const [email, setEmail] = React.useState(true);
  const [override, setOverride] = React.useState(false);
  const [approving, setApproving] = React.useState<string | null>(null);
  const [refunding, setRefunding] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setInvoice(true);
      setEmail(true);
    }
  }, [open]);

  const p = preview.data;
  const balance = Number(p?.balance ?? 0);
  const blocked = p?.problem?.reason === 'balance_open';

  const reload = () => {
    refresh();
    void preview.refetch();
    void folio.refetch();
  };

  const checkOut = useMutation({
    mutationFn: async (body: {
      reason?: string;
      allowBalance?: boolean;
      approvalToken?: string;
    }) => {
      await checkOutBooking(id, body);
      // The bill after the guest has gone: issue it and send it, in the same press.
      const notes: string[] = [];
      if (invoice && canInvoice && guestWindow) {
        try {
          const issued = await issueFolioInvoice(guestWindow.id);
          const numbers = issued.documents.map((d) => d.number);
          notes.push(`invoice ${numbers.join(' and ')} issued`);
          if (email && p?.guestEmail) {
            for (const d of issued.documents) await sendInvoice(d.id, [p.guestEmail]);
            notes.push(`emailed to ${p.guestEmail}`);
          }
        } catch (e) {
          // The guest is checked out; the invoice can be issued from the bill.
          toast.error(describeError(e, 'Checked out, but the invoice could not be issued'));
        }
      }
      return notes;
    },
    onSuccess: (notes) => {
      ux.complete();
      refresh();
      toast.success(
        `${booking!.guestName} is checked out${notes.length ? ` · ${notes.join(', ')}` : ''}`,
        {
          action: {
            label: 'Undo',
            onClick: () =>
              undoCheckOut(id, 'Undone straight away — checked out by mistake')
                .then(() => {
                  refresh();
                  toast.success(`${booking!.reference} is in house again`);
                })
                .catch((e) => toast.error(describeError(e, 'The check-out could not be undone'))),
          },
        },
      );
      setOverride(false);
      setApproving(null);
      onOpenChange(false);
    },
    onError: () => void preview.refetch(),
  });

  const shorten = useMutation({
    mutationFn: () => changeDeparture(id, p!.today, 'Leaving early'),
    onSuccess: reload,
  });

  return (
    <>
      <Dialog
        open={open && !override && approving === null && !refunding}
        onOpenChange={onOpenChange}
      >
        <DialogContent
          title={booking ? `Check out ${booking.guestName}` : 'Check out'}
          className="max-w-lg"
        >
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="font-mono text-xs text-ink-3">{booking?.reference}</p>
            {!p || folio.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <>
                {p.unstayedNights > 0 && (
                  <InlineAlert tone="info">
                    <p className="flex items-start gap-2">
                      <CalendarX size={16} className="mt-0.5 shrink-0" />
                      Leaving {p.unstayedNights} night{p.unstayedNights === 1 ? '' : 's'} early.
                      Those nights go back on sale; their price stays on the bill unless you shorten
                      the stay.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => shorten.mutate()}
                      loading={shorten.isPending}
                    >
                      Shorten the stay to today
                    </Button>
                    {shorten.isError && (
                      <p className="mt-2 text-sm text-closed-ink">{describeError(shorten.error)}</p>
                    )}
                  </InlineAlert>
                )}

                {balance > 0.004 && guestWindow && (
                  <div className="rounded-lg border border-line p-3">
                    <p className="mb-3 text-sm text-ink-2">
                      Still to pay{' '}
                      <span className="font-mono font-semibold tabular-nums text-closed-ink">
                        {p.currency} {balance.toFixed(2)}
                      </span>
                    </p>
                    <TakePaymentForm
                      key={`${guestWindow.id}-${p.balance}`}
                      folioId={guestWindow.id}
                      suggested={balance}
                      currency={p.currency}
                      onDone={reload}
                      compact
                    />
                  </div>
                )}

                {balance < -0.004 && guestWindow && (
                  <InlineAlert tone="warn">
                    <p>
                      The guest has paid {p.currency} {Math.abs(balance).toFixed(2)} more than the
                      bill.
                    </p>
                    <Button size="sm" className="mt-2" onClick={() => setRefunding(true)}>
                      Give it back…
                    </Button>
                  </InlineAlert>
                )}

                {balance <= 0.004 && balance >= -0.004 && (
                  <p className="text-sm text-avail-ink">The bill is settled.</p>
                )}

                {canInvoice && (
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-sm text-ink-2">
                      <Checkbox checked={invoice} onCheckedChange={(v) => setInvoice(v === true)} />
                      <Receipt size={15} className="text-ink-3" /> Issue the invoice
                    </label>
                    {invoice && p.guestEmail && (
                      <label className="flex items-center gap-2 pl-6 text-sm text-ink-2">
                        <Checkbox checked={email} onCheckedChange={(v) => setEmail(v === true)} />
                        <Envelope size={15} className="text-ink-3" /> Email it to {p.guestEmail}
                      </label>
                    )}
                  </div>
                )}
                {alreadyInvoiced && (
                  <p className="text-xs text-ink-3">This bill has already been invoiced.</p>
                )}

                {p.problem && !blocked && (
                  <InlineAlert tone="error">{String(p.problem.message)}</InlineAlert>
                )}
                {checkOut.isError && (
                  <InlineAlert tone="error">{describeError(checkOut.error)}</InlineAlert>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
            {blocked && (
              <Button variant="ghost" className="mr-auto" onClick={() => setOverride(true)}>
                Let the guest go with the balance…
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button
              onClick={() => checkOut.mutate({})}
              disabled={!p?.ok}
              loading={checkOut.isPending}
            >
              <SignOut size={15} /> Check out
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={override}
        onOpenChange={setOverride}
        title="Let the guest leave owing money?"
        consequence={
          <>
            {booking?.guestName} leaves with {p?.currency} {balance.toFixed(2)} unpaid. It stays on
            the bill to collect later, and your reason is recorded.
            {role !== 'OWNER' && ' The owner approves it on the next screen.'}
          </>
        }
        confirmLabel={role === 'OWNER' ? 'Check out' : 'Continue to approval'}
        destructive
        suggestions={[
          'Company will pay by transfer',
          'Guest will pay online today',
          'Disputed charge',
        ]}
        busy={checkOut.isPending}
        error={checkOut.isError ? describeError(checkOut.error) : null}
        onConfirm={(reason) => {
          if (role === 'OWNER') checkOut.mutate({ allowBalance: true, reason });
          else {
            setOverride(false);
            setApproving(reason);
          }
        }}
      />
      <ApprovalDialog
        actions={['checkout_balance']}
        reason={approving ?? ''}
        open={approving !== null}
        onOpenChange={(o) => !o && setApproving(null)}
        onApproved={(tokens) => {
          if (approving)
            checkOut.mutate({
              allowBalance: true,
              reason: approving,
              approvalToken: tokens.checkout_balance,
            });
        }}
      />
      {guestWindow && (
        <RefundDialog
          folioId={guestWindow.id}
          paid={Number(guestWindow.totals.paid)}
          suggested={Math.abs(balance)}
          currency={p?.currency ?? ''}
          open={refunding}
          onOpenChange={setRefunding}
          onDone={reload}
        />
      )}
    </>
  );
}
