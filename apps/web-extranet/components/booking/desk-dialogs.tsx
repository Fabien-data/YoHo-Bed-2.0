'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, Sheet, SheetContent, Skeleton, toast } from '@yohobed/ui';
import { RegistrationCardSheet } from '@/components/reservations/registration-card';
import {
  cancelBooking,
  describeError,
  getBookingBalance,
  getBookingFolio,
  reinstateBooking,
  undoCheckIn,
  undoCheckOut,
} from '@/lib/api';
import { CheckInDialog, type DeskBooking } from './check-in-dialog';
import { CheckOutDialog } from './check-out-dialog';
import { ChangeDepartureDialog } from './change-departure-dialog';
import { MoveRoomDialog } from './move-room-dialog';
import { ReasonDialog } from './reason-dialog';
import { TakePaymentForm } from './take-payment-form';
import { useRefreshDesk } from './refresh';

export type DeskAction =
  | 'move-room'
  | 'check-in'
  | 'check-out'
  | 'take-payment'
  | 'change-departure'
  | 'cancel'
  | 'undo-check-in'
  | 'undo-check-out'
  | 'reinstate';

export interface DeskTarget extends DeskBooking {
  checkin: string;
  checkout: string;
  status?: string;
  currency?: string;
}

/** The reason-only actions: what they do, said plainly, and the one call that does it. */
const REASONED: Record<
  'cancel' | 'undo-check-in' | 'undo-check-out' | 'reinstate',
  {
    title: (b: DeskTarget) => string;
    consequence: string;
    confirm: string;
    destructive?: boolean;
    suggestions: string[];
    run: (id: string, reason: string) => Promise<unknown>;
    done: (b: DeskTarget) => string;
  }
> = {
  cancel: {
    title: (b) => `Cancel ${b.reference}?`,
    consequence:
      'The reservation is cancelled and its rooms go back on sale. It can be brought back while the rooms are still free.',
    confirm: 'Cancel reservation',
    destructive: true,
    suggestions: ['Guest cancelled', 'Duplicate booking', 'No deposit received'],
    run: cancelBooking,
    done: (b) => `${b.reference} is cancelled`,
  },
  'undo-check-in': {
    title: (b) => `Undo ${b.guestName}'s check-in?`,
    consequence:
      'The stay goes back to arriving and the room is freed for tonight. Only possible the same day, before a night is charged.',
    confirm: 'Undo check-in',
    suggestions: ['Checked in the wrong guest', 'Checked in the wrong booking'],
    run: undoCheckIn,
    done: (b) => `${b.reference} is back to arriving`,
  },
  'undo-check-out': {
    title: (b) => `Undo ${b.guestName}'s check-out?`,
    consequence:
      'The guest is in house again, and any nights an early departure released are taken back if they are still free. Only possible the same day.',
    confirm: 'Undo check-out',
    suggestions: ['Checked out the wrong guest', 'Guest is staying after all'],
    run: undoCheckOut,
    done: (b) => `${b.reference} is in house again`,
  },
  reinstate: {
    title: (b) => `Bring back ${b.reference}?`,
    consequence:
      'The reservation comes back and takes its rooms again — if they have not been sold in the meantime.',
    confirm: 'Bring it back',
    suggestions: ['Cancelled by mistake', 'Guest arrived after the night audit'],
    run: reinstateBooking,
    done: (b) => `${b.reference} is a reservation again`,
  },
};

type OpenDesk = (action: DeskAction, booking: DeskTarget) => void;
const DeskContext = React.createContext<OpenDesk | null>(null);

/**
 * Every front-desk dialog in one place (UX-1b), mounted once for the whole app: any screen — the
 * Dashboard, the lists, the reservation sheet, Stay View — calls `useDesk()('check-in', booking)`
 * and gets the same dialog, the same rules and the same wording. One component per job is what
 * makes "one obvious path" true (docs/UX-STANDARD.md principle 12).
 */
export function DeskDialogsProvider({ children }: { children: React.ReactNode }) {
  const [cardFor, setCardFor] = React.useState<string | null>(null);
  const { open, dialogs } = useDeskDialogs({ onPrintCard: setCardFor });
  return (
    <DeskContext.Provider value={open}>
      {children}
      {dialogs}
      <Sheet open={cardFor !== null} onOpenChange={(o) => !o && setCardFor(null)}>
        <SheetContent title="Registration card" wide>
          {cardFor && <RegistrationCardSheet bookingId={cardFor} />}
        </SheetContent>
      </Sheet>
    </DeskContext.Provider>
  );
}

/** Open a front-desk dialog for a booking, from anywhere inside the app. */
export function useDesk(): OpenDesk {
  const open = React.useContext(DeskContext);
  if (!open) throw new Error('useDesk() needs <DeskDialogsProvider> (mounted in app/app/layout)');
  return open;
}

function useDeskDialogs(opts: { onPrintCard?: (bookingId: string) => void } = {}) {
  const [state, setState] = React.useState<{ action: DeskAction; booking: DeskTarget } | null>(
    null,
  );
  const refresh = useRefreshDesk();
  const close = () => setState(null);
  const is = (a: DeskAction) => state?.action === a;

  const reasoned =
    state && state.action in REASONED ? REASONED[state.action as keyof typeof REASONED] : null;
  const run = useMutation({
    mutationFn: (reason: string) => reasoned!.run(state!.booking.id, reason),
    onSuccess: () => {
      toast.success(reasoned!.done(state!.booking));
      refresh();
      close();
    },
  });

  const dialogs = (
    <>
      <CheckInDialog
        booking={state?.booking ?? null}
        open={is('check-in')}
        onOpenChange={(o) => !o && close()}
        onPrintCard={opts.onPrintCard}
      />
      <CheckOutDialog
        booking={state?.booking ?? null}
        open={is('check-out')}
        onOpenChange={(o) => !o && close()}
      />
      <ChangeDepartureDialog
        booking={state?.booking ?? null}
        open={is('change-departure')}
        onOpenChange={(o) => !o && close()}
      />
      <MoveRoomDialog
        booking={state?.booking ?? null}
        open={is('move-room')}
        onOpenChange={(o) => !o && close()}
      />
      <TakePaymentDialog booking={is('take-payment') ? state!.booking : null} onClose={close} />
      {reasoned && state && (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && close()}
          title={reasoned.title(state.booking)}
          consequence={reasoned.consequence}
          confirmLabel={reasoned.confirm}
          destructive={reasoned.destructive}
          suggestions={reasoned.suggestions}
          busy={run.isPending}
          error={run.isError ? describeError(run.error) : null}
          onConfirm={(reason) => run.mutate(reason)}
        />
      )}
    </>
  );

  const reset = run.reset;
  const open = React.useCallback(
    (action: DeskAction, booking: DeskTarget) => {
      reset();
      setState({ action, booking });
    },
    [reset],
  );
  return { open, dialogs };
}

/** Taking a payment from anywhere, onto the guest's own bill. */
function TakePaymentDialog({
  booking,
  onClose,
}: {
  booking: DeskTarget | null;
  onClose: () => void;
}) {
  const refresh = useRefreshDesk();
  const folio = useQuery({
    queryKey: ['folio', booking?.id],
    queryFn: () => getBookingFolio(booking!.id),
    enabled: Boolean(booking),
  });
  // "Still to pay" is the stay's balance — the room price counts before its nights are posted.
  const owed = useQuery({
    queryKey: ['folio', booking?.id, 'balance'],
    queryFn: () => getBookingBalance(booking!.id),
    enabled: Boolean(booking),
  });
  const w = folio.data?.windows.find((x) => !x.payerLedgerAccountId) ?? folio.data?.windows[0];
  const balance = Number(owed.data?.balance ?? w?.totals.balance ?? 0);
  return (
    <Dialog open={booking !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={booking ? `Take a payment from ${booking.guestName}` : 'Take a payment'}
        className="max-w-md"
      >
        <div className="px-5 py-4">
          {w && owed.data ? (
            <>
              <p className="mb-3 text-sm text-ink-2">
                Still to pay{' '}
                <span className="font-mono font-semibold tabular-nums text-ink">
                  {folio.data!.currency} {balance.toFixed(2)}
                </span>
              </p>
              <TakePaymentForm
                folioId={w.id}
                suggested={balance}
                currency={folio.data!.currency}
                compact
                onDone={() => {
                  refresh();
                  onClose();
                }}
              />
            </>
          ) : folio.isError ? (
            <p className="text-sm text-closed-ink">{describeError(folio.error)}</p>
          ) : (
            <Skeleton className="h-24 w-full" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
