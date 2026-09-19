'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  DoorOpen,
  DotsThreeVertical,
  Eye,
  HourglassSimpleLow,
  Printer,
  SignIn,
  SignOut,
  UserMinus,
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
  ApiError,
  autoAssignRooms,
  bookingTransition,
  confirmBooking,
  releaseHold,
  type ReservationRow,
} from '@/lib/api';

type Row = Pick<
  ReservationRow,
  'id' | 'reference' | 'status' | 'reservationKind' | 'inventoryHeld' | 'checkin' | 'roomCodes'
>;

type Danger = 'cancel' | 'no-show' | 'release' | null;

/** Which actions a reservation offers right now. Kept pure so the sheet and the menu agree. */
export function actionsFor(row: Row, today: string) {
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
    assign: live && row.inventoryHeld && row.roomCodes.length === 0,
    noShow: row.status === 'Approved' && row.checkin < today,
    cancel: live,
  };
}

/** Refresh every screen a reservation's change shows on. */
export function useInvalidateReservations() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      'reservations',
      'reservation-groups',
      'stayview',
      'dashboard',
      'booking-extras',
      // A transfer marked done, or a check-in, changes the bill.
      'folio',
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

/**
 * The ⋮ menu on a reservation row: Yanolja's row actions. Anything that gives rooms away or ends
 * the reservation asks first.
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
  const refresh = useInvalidateReservations();
  const can = actionsFor(row, today);

  const act = useMutation({
    mutationFn: async (
      what: 'confirm' | 'release' | 'check-in' | 'check-out' | 'assign' | 'cancel' | 'no-show',
    ) => {
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
        'check-in': 'checked in',
        'check-out': 'checked out',
        assign: 'given a room',
        cancel: 'cancelled',
        'no-show': 'marked as a no-show',
      };
      toast.success(`${row.reference} ${done[what]}`);
    },
    onError: (e) =>
      toast.error(e instanceof ApiError ? e.message : 'That did not work. Try again.'),
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
        <MenuContent align="end" className="w-52">
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
            <MenuItem onSelect={() => act.mutate('check-in')}>
              <SignIn size={15} /> Check in
            </MenuItem>
          )}
          {can.checkOut && (
            <MenuItem onSelect={() => act.mutate('check-out')}>
              <SignOut size={15} /> Check out
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
            <MenuItem onSelect={() => setDanger('cancel')} className="text-closed-ink">
              <XCircle size={15} /> Cancel reservation
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={danger !== null}
        onOpenChange={(o) => !o && setDanger(null)}
        title={
          danger === 'release'
            ? `Release ${row.reference}?`
            : danger === 'no-show'
              ? `Mark ${row.reference} as a no-show?`
              : `Cancel ${row.reference}?`
        }
        description={
          danger === 'release'
            ? 'The hold ends now and its rooms go back on sale.'
            : danger === 'no-show'
              ? 'The guest did not arrive. The nights after tonight go back on sale.'
              : 'The reservation is cancelled and its rooms go back on sale.'
        }
        confirmLabel={
          danger === 'release'
            ? 'Release'
            : danger === 'no-show'
              ? 'Mark no-show'
              : 'Cancel reservation'
        }
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
