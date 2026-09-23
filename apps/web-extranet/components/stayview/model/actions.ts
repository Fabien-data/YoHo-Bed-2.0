import type { HotelPermission, StayBar } from '@/lib/api';
import { actionsFor } from '@/lib/booking-actions';

/**
 * The reservation panel's actions, in the order the stay needs them. The first is the stage's
 * main job — confirm a pending stay, check in an arrival, check out a departure — so the panel's
 * big button is never the same button for every reservation.
 */
export type StayAction =
  | 'confirm'
  | 'check-in'
  | 'check-out'
  | 'take-payment'
  | 'assign'
  | 'move-room'
  | 'change-dates'
  | 'change-departure'
  | 'release'
  | 'no-show'
  | 'cancel'
  | 'undo-check-in'
  | 'undo-check-out'
  | 'reinstate';

export const ACTION_LABEL: Record<StayAction, string> = {
  confirm: 'Confirm',
  'check-in': 'Check in',
  'check-out': 'Check out',
  'take-payment': 'Take payment',
  assign: 'Assign room',
  'move-room': 'Move room',
  'change-dates': 'Change dates',
  'change-departure': 'Change departure',
  release: 'Release hold',
  'no-show': 'Mark no-show',
  cancel: 'Cancel reservation',
  'undo-check-in': 'Undo check-in',
  'undo-check-out': 'Undo check-out',
  reinstate: 'Bring back',
};

/** Who can do what (`null` permissions = an owner or legacy staff member: everything). */
export interface DeskAccess {
  permissions: HotelPermission[] | null;
}
const allowed = (access: DeskAccess, ...need: HotelPermission[]) =>
  access.permissions === null || need.every((p) => access.permissions!.includes(p));

export function stayActions(
  bar: StayBar,
  today: string,
  access: DeskAccess,
): { primary: StayAction | null; secondary: StayAction[] } {
  if (bar.kind !== 'booking') return { primary: null, secondary: [] };
  const can = actionsFor(
    {
      status: bar.status ?? '',
      reservationKind: bar.reservationKind ?? 'confirm',
      inventoryHeld: bar.reservationKind !== 'inquiry' && bar.reservationKind !== 'online_failed',
      checkin: bar.from,
      checkout: bar.to,
      roomCodes: [],
    },
    today,
  );
  const change = allowed(access, 'reservation_change', 'financial_read');
  const desk = allowed(access, 'check_in_out', 'financial_read');
  const rooms = allowed(access, 'room_assignment');
  // Payments stay closed to hotel-created roles until their own review (owner, 2026-09-23).
  const money = access.permissions === null;
  const unassigned = !bar.roomUnitId;
  const inHouse = bar.status === 'CheckedIn';

  const list: StayAction[] = [];
  const add = (action: StayAction, ok: boolean) => ok && list.push(action);
  add('confirm', can.confirm && change);
  add('check-in', can.checkIn && desk);
  add('check-out', can.checkOut && desk);
  add('take-payment', can.takePayment && money);
  add('assign', unassigned && (bar.status === 'Approved' || bar.status === 'Pending') && rooms);
  add('move-room', !unassigned && (bar.status === 'Approved' || inHouse) && rooms);
  add(
    'change-dates',
    (bar.status === 'Approved' || bar.status === 'Pending') && bar.source !== 'OTA' && change,
  );
  add('change-departure', can.changeDeparture && change);
  add('release', can.release && change);
  add('no-show', can.noShow && change);
  add('cancel', can.cancel && change);
  add('undo-check-in', can.undoCheckIn && desk);
  add('undo-check-out', can.undoCheckOut && desk);
  add('reinstate', can.reinstate && change);

  // The stage's main job, then the money if any is owed.
  const order: StayAction[] =
    bar.balanceDue && inHouse
      ? ['check-out', 'take-payment']
      : ['confirm', 'check-in', 'check-out', 'assign', 'take-payment', 'reinstate'];
  const primary =
    order.find((a) => list.includes(a) && (a !== 'take-payment' || bar.balanceDue === true)) ??
    null;
  return { primary, secondary: list.filter((a) => a !== primary) };
}
