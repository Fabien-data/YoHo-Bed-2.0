'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowCounterClockwise,
  CalendarPlus,
  CheckCircle,
  DoorOpen,
  DotsThreeVertical,
  Eye,
  HourglassSimpleLow,
  Printer,
  SignIn,
  SignOut,
  UserMinus,
  Wallet,
  XCircle,
} from '@phosphor-icons/react';
import {
  ConfirmDialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  toast,
} from '@yohobed/ui';
import {
  autoAssignRooms,
  bookingTransition,
  confirmBooking,
  describeError,
  releaseHold,
  type ReservationRow,
} from '@/lib/api';
import { useDesk } from '@/components/booking/desk-dialogs';
import { useRefreshDesk } from '@/components/booking/refresh';

type Row = Pick<
  ReservationRow,
  | 'id'
  | 'reference'
  | 'status'
  | 'reservationKind'
  | 'inventoryHeld'
  | 'checkin'
  | 'checkout'
  | 'roomCodes'
  | 'guestName'
>;

type Danger = 'no-show' | 'release' | null;

/**
 * Which actions a reservation offers right now. Kept pure so every screen agrees. The server is
 * the authority (UX-STANDARD §4) — an action offered here can still be refused with a reason.
 */
export function actionsFor(
  row: Pick<
    Row,
    'status' | 'reservationKind' | 'inventoryHeld' | 'checkin' | 'checkout' | 'roomCodes'
  >,
  today: string,
) {
  const live = row.status === 'Pending' || row.status === 'Approved';
  const kind = row.reservationKind;
  const isHold = kind === 'hold_confirm' || kind === 'hold_unconfirm';
  return {
    confirm: live && kind !== 'confirm',
    release: live && isHold,
    checkIn:
      row.status === 'Approved' &&
      (kind === 'confirm' || kind === 'hold_confirm') &&
      row.checkin <= today,
    checkOut: row.status === 'CheckedIn',
    takePayment: row.status === 'Approved' || row.status === 'CheckedIn',
    changeDeparture: row.status === 'CheckedIn',
    undoCheckIn: row.status === 'CheckedIn',
    undoCheckOut: row.status === 'CheckedOut',
    reinstate: (row.status === 'Cancelled' || row.status === 'NoShow') && row.checkout > today,
    assign: live && row.inventoryHeld && row.roomCodes.length === 0,
    noShow: row.status === 'Approved' && row.checkin < today,
    cancel: live,
  };
}

/** Refresh every screen a reservation's change shows on. */
export function useInvalidateReservations() {
  return useRefreshDesk();
}

/**
 * The ⋮ menu on a reservation: every front-desk action, each opening the same dialog it opens
 * everywhere else (UX-1b). Anything that gives rooms away or ends the reservation asks first, and
 * says why it is asking.
 */
export function RowActions({
  row,
  today,
  onOpen,
  onCard,
}: {
  row: Row;
  today: string;
  /** Omitted inside the reservation's own sheet. */
  onOpen?: () => void;
  onCard: () => void;
}) {
  const [danger, setDanger] = React.useState<Danger>(null);
  const refresh = useRefreshDesk();
  const desk = useDesk();
  const can = actionsFor(row, today);
  const target = {
    id: row.id,
    reference: row.reference,
    guestName: row.guestName,
    checkin: row.checkin,
    checkout: row.checkout,
  };

  const act = useMutation({
    mutationFn: async (what: 'confirm' | 'release' | 'assign' | 'no-show') => {
      switch (what) {
        case 'confirm':
          return confirmBooking(row.id);
        case 'release':
          return releaseHold(row.id);
        case 'assign':
          return autoAssignRooms(row.id);
        default:
          return bookingTransition(row.id, what);
      }
    },
    onSuccess: (_, what) => {
      refresh();
      const done: Record<string, string> = {
        confirm: 'confirmed',
        release: 'released: its rooms are back on sale',
        assign: 'given a room',
        'no-show': 'marked as a no-show',
      };
      toast.success(`${row.reference} ${done[what]}`);
    },
    onError: (e) => toast.error(describeError(e, 'That did not work. Try again.')),
  });

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for ${row.reference}`}
            className="rounded-md p-1.5 text-ink-3 transition duration-1 hover:bg-surface-2 hover:text-ink"
          >
            <DotsThreeVertical size={18} weight="bold" />
          </button>
        </MenuTrigger>
        <MenuContent align="end" className="w-56">
          {onOpen && (
            <MenuItem onSelect={onOpen}>
              <Eye size={15} /> Open
            </MenuItem>
          )}
          {can.confirm && (
            <MenuItem onSelect={() => act.mutate('confirm')}>
              <CheckCircle size={15} /> Confirm
            </MenuItem>
          )}
          {can.checkIn && (
            <MenuItem onSelect={() => desk('check-in', target)}>
              <SignIn size={15} /> Check in
            </MenuItem>
          )}
          {can.checkOut && (
            <MenuItem onSelect={() => desk('check-out', target)}>
              <SignOut size={15} /> Check out
            </MenuItem>
          )}
          {can.takePayment && (
            <MenuItem onSelect={() => desk('take-payment', target)}>
              <Wallet size={15} /> Take payment
            </MenuItem>
          )}
          {can.changeDeparture && (
            <MenuItem onSelect={() => desk('change-departure', target)}>
              <CalendarPlus size={15} /> Change departure
            </MenuItem>
          )}
          {can.assign && (
            <MenuItem onSelect={() => act.mutate('assign')}>
              <DoorOpen size={15} /> Assign a room
            </MenuItem>
          )}
          <MenuItem onSelect={onCard}>
            <Printer size={15} /> Registration card
          </MenuItem>
          {(can.undoCheckIn || can.undoCheckOut || can.reinstate) && <MenuSeparator />}
          {can.undoCheckIn && (
            <MenuItem onSelect={() => desk('undo-check-in', target)}>
              <ArrowCounterClockwise size={15} /> Undo check-in
            </MenuItem>
          )}
          {can.undoCheckOut && (
            <MenuItem onSelect={() => desk('undo-check-out', target)}>
              <ArrowCounterClockwise size={15} /> Undo check-out
            </MenuItem>
          )}
          {can.reinstate && (
            <MenuItem onSelect={() => desk('reinstate', target)}>
              <ArrowCounterClockwise size={15} /> Bring back
            </MenuItem>
          )}
          {(can.release || can.noShow || can.cancel) && <MenuSeparator />}
          {can.release && (
            <MenuItem onSelect={() => setDanger('release')}>
              <HourglassSimpleLow size={15} /> Release hold
            </MenuItem>
          )}
          {can.noShow && (
            <MenuItem onSelect={() => setDanger('no-show')}>
              <UserMinus size={15} /> No-show
            </MenuItem>
          )}
          {can.cancel && (
            <MenuItem onSelect={() => desk('cancel', target)} className="text-closed-ink">
              <XCircle size={15} /> Cancel reservation
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={danger !== null}
        onOpenChange={(o) => !o && setDanger(null)}
        title={
          danger === 'release' ? `Release ${row.reference}?` : `Mark ${row.reference} as a no-show?`
        }
        description={
          danger === 'release'
            ? 'The hold ends now and its rooms go back on sale.'
            : 'The guest did not arrive. The nights after tonight go back on sale. If they turn up later, bring the reservation back.'
        }
        confirmLabel={danger === 'release' ? 'Release' : 'Mark no-show'}
        cancelLabel="Keep it"
        destructive
        onConfirm={() => {
          if (danger) act.mutate(danger);
          setDanger(null);
        }}
      />
    </>
  );
}
