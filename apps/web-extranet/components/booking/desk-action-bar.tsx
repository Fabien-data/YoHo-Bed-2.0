'use client';

import {
  ArrowCounterClockwise,
  CalendarPlus,
  DoorOpen,
  SignIn,
  SignOut,
  Wallet,
} from '@phosphor-icons/react';
import { Button } from '@yohobed/ui';
import { useDesk, type DeskTarget } from './desk-dialogs';

/**
 * The front-desk actions for one booking as buttons (UX-1b) — for the panels where the booking is
 * already open (Stay View, the reservation sheet), so the next step is one press, not a menu.
 * The one that moves the stay forward is the primary; the rest are secondary.
 */
export function DeskActionBar({ booking, status }: { booking: DeskTarget; status: string }) {
  const desk = useDesk();
  const inHouse = status === 'CheckedIn';
  const arriving = status === 'Approved';
  const ended = status === 'Cancelled' || status === 'NoShow';
  if (!inHouse && !arriving && !ended && status !== 'CheckedOut') return null;
  return (
    <div className="flex flex-wrap gap-2">
      {arriving && (
        <Button size="sm" onClick={() => desk('check-in', booking)}>
          <SignIn size={14} /> Check in
        </Button>
      )}
      {inHouse && (
        <Button size="sm" onClick={() => desk('check-out', booking)}>
          <SignOut size={14} /> Check out
        </Button>
      )}
      {(arriving || inHouse) && (
        <Button size="sm" variant="secondary" onClick={() => desk('take-payment', booking)}>
          <Wallet size={14} /> Take payment
        </Button>
      )}
      {(arriving || inHouse) && (
        <Button size="sm" variant="secondary" onClick={() => desk('move-room', booking)}>
          <DoorOpen size={14} /> Move room
        </Button>
      )}
      {inHouse && (
        <Button size="sm" variant="secondary" onClick={() => desk('change-departure', booking)}>
          <CalendarPlus size={14} /> Change departure
        </Button>
      )}
      {status === 'CheckedOut' && (
        <Button size="sm" variant="ghost" onClick={() => desk('undo-check-out', booking)}>
          <ArrowCounterClockwise size={14} /> Undo check-out
        </Button>
      )}
      {ended && (
        <Button size="sm" variant="secondary" onClick={() => desk('reinstate', booking)}>
          <ArrowCounterClockwise size={14} /> Bring back
        </Button>
      )}
    </div>
  );
}
