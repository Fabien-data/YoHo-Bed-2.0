'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Broom, DoorOpen, IdentificationCard, SignIn, Wallet } from '@phosphor-icons/react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  Field,
  InlineAlert,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@yohobed/ui';
import { ID_DOCUMENT_LABELS, idTypesFor, type IdDocumentType } from '@yohobed/locale';
import {
  ApiError,
  addGuestDocument,
  checkInBooking,
  describeError,
  getBookingFolio,
  getCheckInPreview,
  reinstateBooking,
  switchToCleanRooms,
  undoCheckIn,
  type DeskProblem,
} from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { useUxTask } from '@/lib/ux';
import { ReasonDialog } from './reason-dialog';
import { TakePaymentForm } from './take-payment-form';
import { RegisterCapture } from './register-capture';
import { useRefreshDesk } from './refresh';

const PRINT_CARD_KEY = 'yhb_print_card_at_checkin';

function readPrintCard(): boolean {
  try {
    return localStorage.getItem(PRINT_CARD_KEY) === '1';
  } catch {
    return false;
  }
}

export interface DeskBooking {
  id: string;
  reference: string;
  guestName: string;
}

/**
 * Checking a guest in (UX-1b) — one dialog wherever it is started (the Dashboard, the lists,
 * Stay View). It opens on a dry run of the real check-in, so it already knows the room the guest
 * gets and anything that would stop it, and turns each refusal into the choice that fixes it:
 * a clean room instead of a dirty one, the ID the hotel requires, a no-show brought back.
 *
 * The prepared arrival is two presses: open, Check in (docs/UX-STANDARD.md §3, ≤ 3C).
 */
export function CheckInDialog({
  booking,
  open,
  onOpenChange,
  onPrintCard,
}: {
  booking: DeskBooking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the registration card; offered after a check-in. */
  onPrintCard?: (bookingId: string) => void;
}) {
  const refresh = useRefreshDesk();
  const ux = useUxTask('stay.check_in', open);
  const id = booking?.id ?? '';
  const preview = useQuery({
    queryKey: ['check-in-preview', id],
    queryFn: () => getCheckInPreview(id),
    enabled: open && Boolean(id),
    staleTime: 0,
  });
  const [printCard, setPrintCard] = React.useState(false);
  const [override, setOverride] = React.useState(false);
  const [reinstating, setReinstating] = React.useState(false);
  const [depositOpen, setDepositOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPrintCard(readPrintCard());
      setDepositOpen(false);
    }
  }, [open]);

  const p = preview.data;
  const problem = p?.problem ?? null;

  const checkIn = useMutation({
    mutationFn: (body: { reason?: string; overrideDirty?: boolean }) => checkInBooking(id, body),
    onSuccess: () => {
      ux.complete();
      refresh();
      const rooms = (p?.rooms ?? []).map((r) => r.code).filter(Boolean);
      const where = rooms.length ? ` to room ${rooms.join(', ')}` : '';
      toast.success(`${booking!.guestName} is checked in${where}`, {
        action: {
          label: 'Undo',
          onClick: () =>
            undoCheckIn(id, 'Undone straight away — checked in by mistake')
              .then(() => {
                refresh();
                toast.success(`${booking!.reference} is back to arriving`);
              })
              .catch((e) => toast.error(describeError(e, 'The check-in could not be undone'))),
        },
      });
      try {
        localStorage.setItem(PRINT_CARD_KEY, printCard ? '1' : '0');
      } catch {
        // A remembered preference only.
      }
      setOverride(false);
      onOpenChange(false);
      if (printCard) onPrintCard?.(id);
    },
    onError: () => {
      void preview.refetch();
    },
  });

  const switchClean = useMutation({
    mutationFn: () => switchToCleanRooms(id),
    onSuccess: () => {
      refresh();
      void preview.refetch();
    },
  });

  const reinstate = useMutation({
    mutationFn: (reason: string) => reinstateBooking(id, reason),
    onSuccess: () => {
      setReinstating(false);
      refresh();
      void preview.refetch();
    },
  });

  const serverError =
    checkIn.error instanceof ApiError &&
    (checkIn.error.data as DeskProblem | undefined)?.reason !== problem?.reason
      ? describeError(checkIn.error)
      : null;

  return (
    <>
      <Dialog open={open && !override && !reinstating} onOpenChange={onOpenChange}>
        <DialogContent
          title={booking ? `Check in ${booking.guestName}` : 'Check in'}
          className="max-w-lg"
        >
          <div className="flex flex-col gap-4 px-5 py-4">
            <p className="font-mono text-xs text-ink-3">{booking?.reference}</p>

            {preview.isLoading || !p ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <RoomsLine rooms={p.rooms} />
                {problem && (
                  <Problem
                    problem={problem}
                    bookingId={booking!.id}
                    customerId={p.customerId}
                    busy={switchClean.isPending}
                    onSwitchClean={() => switchClean.mutate()}
                    onOverride={() => setOverride(true)}
                    onReinstate={() => setReinstating(true)}
                    onFixed={() => void preview.refetch()}
                  />
                )}
                {switchClean.isError && (
                  <InlineAlert tone="error">{describeError(switchClean.error)}</InlineAlert>
                )}
                {Number(p.balance) > 0.004 && (
                  <Deposit
                    bookingId={id}
                    balance={Number(p.balance)}
                    currency={p.currency}
                    open={depositOpen}
                    onOpen={() => setDepositOpen(true)}
                    onPaid={() => {
                      setDepositOpen(false);
                      refresh();
                      void preview.refetch();
                    }}
                  />
                )}
                {onPrintCard && (
                  <label className="flex items-center gap-2 text-sm text-ink-2">
                    <Checkbox
                      checked={printCard}
                      onCheckedChange={(v) => setPrintCard(v === true)}
                    />
                    Print the registration card
                  </label>
                )}
                {serverError && <InlineAlert tone="error">{serverError}</InlineAlert>}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Not now
            </Button>
            <Button
              onClick={() => checkIn.mutate({})}
              disabled={!p?.ok}
              loading={checkIn.isPending}
            >
              <SignIn size={15} /> Check in
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ReasonDialog
        open={override}
        onOpenChange={setOverride}
        title="Check in to a room that is not clean?"
        consequence={
          <>
            Room {problem?.rooms?.join(', ')} is still marked dirty. The guest goes in now, and your
            reason is recorded with the check-in.
          </>
        }
        confirmLabel="Check in anyway"
        suggestions={[
          'Guest asked to drop bags now',
          'Room was cleaned, status not updated',
          'No clean room available',
        ]}
        busy={checkIn.isPending}
        error={checkIn.isError ? describeError(checkIn.error) : null}
        onConfirm={(reason) => checkIn.mutate({ overrideDirty: true, reason })}
      />
      <ReasonDialog
        open={reinstating}
        onOpenChange={setReinstating}
        title={`Bring back ${booking?.reference ?? 'this reservation'}?`}
        consequence="The night audit marked it a no-show. It becomes a reservation again and takes its rooms back — if they are still free — so the guest can be checked in."
        confirmLabel="Bring it back"
        suggestions={['Flight delayed, arrived late', 'Guest arrived after the night audit']}
        busy={reinstate.isPending}
        error={reinstate.isError ? describeError(reinstate.error) : null}
        onConfirm={(reason) => reinstate.mutate(reason)}
      />
    </>
  );
}

function RoomsLine({ rooms }: { rooms: Array<{ code: string; housekeeping: string }> }) {
  if (rooms.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-2">
        <DoorOpen size={16} className="text-ink-3" /> No numbered room is needed for this stay.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {rooms.map((r, i) => (
        <li key={`${r.code}-${i}`} className="flex items-center gap-2 text-sm">
          <DoorOpen size={16} className="text-ink-3" />
          {r.code ? (
            <>
              <span className="font-mono text-base font-semibold text-ink">Room {r.code}</span>
              <span
                className={
                  r.housekeeping === 'dirty'
                    ? 'text-closed-ink'
                    : r.housekeeping === 'clean' || r.housekeeping === 'inspected'
                      ? 'text-avail-ink'
                      : 'text-ink-3'
                }
              >
                {r.housekeeping === 'dirty'
                  ? 'not clean yet'
                  : r.housekeeping === 'inspected'
                    ? 'inspected'
                    : r.housekeeping === 'out_of_order'
                      ? 'out of order'
                      : 'clean'}
              </span>
            </>
          ) : (
            <span className="text-ink-3">No room assigned yet</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Each refusal becomes the choice that fixes it. */
function Problem({
  problem,
  bookingId,
  customerId,
  busy,
  onSwitchClean,
  onOverride,
  onReinstate,
  onFixed,
}: {
  problem: DeskProblem;
  bookingId: string;
  customerId: string;
  busy: boolean;
  onSwitchClean: () => void;
  onOverride: () => void;
  onReinstate: () => void;
  onFixed: () => void;
}) {
  switch (problem.reason) {
    case 'room_dirty':
      return (
        <InlineAlert tone="warn">
          <p>{problem.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={onSwitchClean} loading={busy}>
              <Broom size={14} /> Use a clean room instead
            </Button>
            <Button size="sm" variant="outline" onClick={onOverride}>
              Check in anyway…
            </Button>
          </div>
        </InlineAlert>
      );
    case 'documents_required':
      return <IdCapture customerId={customerId} message={problem.message} onSaved={onFixed} />;
    case 'registration_required':
      return (
        <RegisterCapture
          bookingId={bookingId}
          customerId={customerId}
          message={problem.message}
          missing={problem.missing ?? []}
          onSaved={onFixed}
        />
      );
    case 'no_show':
      return (
        <InlineAlert tone="warn">
          <p>{problem.message}</p>
          <Button size="sm" className="mt-2" onClick={onReinstate}>
            Bring the reservation back…
          </Button>
        </InlineAlert>
      );
    default:
      return <InlineAlert tone="error">{problem.message}</InlineAlert>;
  }
}

/** The ID the hotel requires, recorded without leaving the check-in. */
function IdCapture({
  customerId,
  message,
  onSaved,
}: {
  customerId: string;
  message: string;
  onSaved: () => void;
}) {
  const { property } = useActiveProperty();
  const types = idTypesFor(property?.countryCode);
  const [type, setType] = React.useState<IdDocumentType>(types[0]!);
  const [number, setNumber] = React.useState('');
  const save = useMutation({
    mutationFn: () => addGuestDocument(customerId, { type, number: number.trim() }),
    onSuccess: onSaved,
  });
  return (
    <div className="rounded-lg border border-low bg-low-soft p-3">
      <p className="mb-3 flex items-center gap-2 text-sm text-low-ink">
        <IdentificationCard size={16} /> {message}
      </p>
      <form
        className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (number.trim()) save.mutate();
        }}
      >
        <Field label="Document">
          <Select value={type} onValueChange={(v) => setType(v as IdDocumentType)}>
            <SelectTrigger aria-label="Document type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  {ID_DOCUMENT_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Number">
          <Input
            aria-label="Document number"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Button type="submit" size="sm" loading={save.isPending} disabled={!number.trim()}>
          Save ID
        </Button>
      </form>
      {save.isError && <p className="mt-2 text-sm text-closed-ink">{describeError(save.error)}</p>}
    </div>
  );
}

/** What the guest owes, and a deposit taken without leaving the check-in. */
function Deposit({
  bookingId,
  balance,
  currency,
  open,
  onOpen,
  onPaid,
}: {
  bookingId: string;
  balance: number;
  currency: string;
  open: boolean;
  onOpen: () => void;
  onPaid: () => void;
}) {
  const folio = useQuery({
    queryKey: ['folio', bookingId],
    queryFn: () => getBookingFolio(bookingId),
    enabled: open,
  });
  const windowId = folio.data?.windows[0]?.id;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-ink-2">
          Still to pay{' '}
          <span className="font-mono font-semibold tabular-nums text-ink">
            {currency} {balance.toFixed(2)}
          </span>
        </span>
        {!open && (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            <Wallet size={14} /> Take a deposit
          </Button>
        )}
      </div>
      {open &&
        (windowId ? (
          <div className="mt-3">
            <TakePaymentForm
              folioId={windowId}
              suggested={balance}
              currency={currency}
              onDone={onPaid}
              compact
            />
          </div>
        ) : (
          <Skeleton className="mt-3 h-10 w-full" />
        ))}
    </div>
  );
}
