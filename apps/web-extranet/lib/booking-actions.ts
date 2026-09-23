/**
 * Which actions a reservation offers right now. Kept pure so every screen agrees — the
 * reservation list's ⋮ menu and the Stay View panel both read it. The server is the authority
 * (UX-STANDARD §4): an action offered here can still be refused, with a reason.
 */
export interface ActionableStay {
  status: string;
  reservationKind: string;
  inventoryHeld: boolean;
  checkin: string;
  checkout: string;
  roomCodes: string[];
}

export function actionsFor(row: ActionableStay, today: string) {
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

export type StayActions = ReturnType<typeof actionsFor>;
