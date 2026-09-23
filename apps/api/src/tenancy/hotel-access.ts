import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  bookings,
  maintenanceBlocks,
  housekeepingTasks,
  occupancies,
  properties,
  ratePlans,
  roomUnits,
  rooms,
  workOrders,
  type HotelPermission,
  type Tx,
} from '@yohobed/db';
import type { TenantRequest } from './tenant.guard';

type AccessRule = {
  any: HotelPermission[];
  all?: HotelPermission[];
  resource:
    | 'none'
    | 'property'
    | 'booking'
    | 'block'
    | 'room'
    | 'roomUnit'
    | 'task'
    | 'workOrder'
    | 'ratePlan'
    | 'occupancy';
  listProperties?: boolean;
};
const rule = (resource: AccessRule['resource'], ...any: HotelPermission[]): AccessRule => ({
  resource,
  any,
});

/** Every route available to a hotel-created role is listed here. Unknown routes fail closed. */
export function accessRule(method: string, path: string): AccessRule | null {
  const read = method === 'GET';
  if (path === '/hotel-access' && read)
    return rule(
      'none',
      'reservation_read',
      'reservation_change',
      'check_in_out',
      'room_assignment',
      'financial_read',
      'price_change',
      'minimum_exception',
      'housekeeping',
      'setup',
    );
  if ((path === '/profile' || path === '/billing/entitlements') && read)
    return rule('none', 'reservation_read', 'housekeeping', 'setup');
  if (path === '/profile' && method === 'PATCH')
    return rule('none', 'reservation_read', 'housekeeping', 'setup');
  if (path === '/auth/staff' && read) return rule('none', 'housekeeping', 'setup');
  if (path === '/properties' && read)
    return {
      ...rule('none', 'reservation_read', 'housekeeping', 'setup', 'financial_read'),
      listProperties: true,
    };
  if (path === '/properties' && method === 'POST') return null; // New property grants require owner recovery access.
  if (/^\/properties\/[^/]+\/smart-setup(?:\/.*)?$/.test(path)) return rule('property', 'setup');
  if (/^\/properties\/[^/]+\/(?:reservation-config|room-availability)$/.test(path) && read)
    return {
      ...rule('property', 'reservation_read', 'reservation_change'),
      all: ['financial_read'],
    };
  if ((path === '/reservations' || path === '/reservations/quote') && method === 'POST')
    return { ...rule('property', 'reservation_change'), all: ['financial_read'] };
  if (
    /^\/(?:business-sources|market-segments|payment-methods|sales-persons|transport-modes|rate-codes)$/.test(
      path,
    ) &&
    read
  )
    return rule('none', 'reservation_change', 'setup');
  if (/^\/properties\/[^/]+\/room-units(?:\/counts)?$/.test(path) && read)
    return rule('property', 'reservation_read', 'housekeeping', 'setup');
  if (/^\/properties\/[^/]+\/room-units(?:\/bulk(?:-preview)?)?$/.test(path) && method === 'POST')
    return rule('property', 'setup');
  if (/^\/properties\/[^/]+\/blocks$/.test(path))
    return rule('property', read ? 'reservation_read' : 'reservation_change');
  if (/^\/blocks\/[^/]+(?:\/release)?$/.test(path)) return rule('block', 'reservation_change');
  if (/^\/properties\/[^/]+\/housekeeping(?:\/tasks|\/mark-departures-dirty)?$/.test(path))
    return rule('property', 'housekeeping');
  if (/^\/properties\/[^/]+\/(?:floor-layouts|work-orders)$/.test(path))
    return rule('property', 'housekeeping');
  if (/^\/properties\/[^/]+$/.test(path))
    return rule('property', method === 'GET' ? 'financial_read' : 'setup');
  if (path === '/room-view' || path === '/room-updates' || path === '/house-status/summary')
    return rule('property', 'reservation_read', 'housekeeping');
  if (path === '/stayview' && read) return rule('property', 'reservation_read');
  if (/^\/housekeeping\/tasks\/[^/]+$/.test(path) && method === 'PATCH')
    return rule('task', 'housekeeping');
  if (/^\/work-orders\/[^/]+$/.test(path)) return rule('workOrder', 'housekeeping');
  if (/^\/room-units\/[^/]+$/.test(path))
    return rule('roomUnit', method === 'GET' ? 'reservation_read' : 'setup');
  if (path === '/rooms' && read) return rule('none', 'reservation_read', 'housekeeping', 'setup');
  if (/^\/rooms\/[^/]+\/rates(?:\/.*)?$/.test(path))
    return rule('room', method === 'GET' ? 'financial_read' : 'price_change');
  if (/^\/rooms\/[^/]+\/ari-history$/.test(path)) return rule('room', 'price_change');
  if (/^\/rooms\/[^/]+\/availability$/.test(path) && read)
    return rule('room', 'reservation_read', 'setup');
  if (/^\/rooms\/[^/]+\/(?:reserve|release)$/.test(path)) return rule('room', 'reservation_change');
  if (/^\/rooms\/[^/]+\/restrictions$/.test(path)) return rule('room', 'price_change');
  if (/^\/rooms\/[^/]+$/.test(path) && method === 'PATCH') return rule('room', 'setup');
  if (/^\/properties\/[^/]+\/rooms$/.test(path)) return rule('property', 'setup');
  if (/^\/bookings\/[^/]+\/stay-change\/preview$/.test(path))
    return { ...rule('booking', 'reservation_change'), all: ['financial_read'] };
  if (/^\/bookings\/[^/]+\/stay-change$/.test(path))
    return { ...rule('booking', 'reservation_change'), all: ['financial_read'] };
  if (/^\/bookings\/[^/]+\/(?:assign|auto-assign|room-move)$/.test(path))
    return rule('booking', 'room_assignment');
  if (/^\/bookings\/[^/]+\/(?:rooms|room-moves)$/.test(path) && read)
    return rule('booking', 'room_assignment', 'reservation_read');
  if (/^\/bookings\/[^/]+\/(?:check-in|check-out)$/.test(path))
    return { ...rule('booking', 'check_in_out'), all: ['financial_read'] };
  if (/^\/bookings\/[^/]+\/room-signals$/.test(path)) return rule('booking', 'housekeeping');
  if (/^\/bookings\/[^/]+\/(?:remarks|guests|tasks)$/.test(path))
    return rule('booking', read ? 'reservation_read' : 'reservation_change');
  if (/^\/bookings\/[^/]+\/(?:inclusions|transfers)$/.test(path))
    return {
      ...rule('booking', read ? 'reservation_read' : 'reservation_change'),
      all: ['financial_read'],
    };
  if (/^\/bookings\/[^/]+\/(?:confirm|hold|release-hold)$/.test(path))
    return { ...rule('booking', 'reservation_change'), all: ['financial_read'] };
  if (/^\/bookings\/[^/]+\/registration-card$/.test(path) && read)
    return { ...rule('booking', 'reservation_read'), all: ['financial_read'] };
  if (/^\/bookings\/[^/]+\/(?:approve|reject|cancel|no-show)$/.test(path))
    return { ...rule('booking', 'reservation_change'), all: ['financial_read'] };
  if (/^\/bookings\/[^/]+$/.test(path))
    return method === 'GET'
      ? { ...rule('booking', 'reservation_read'), all: ['financial_read'] }
      : { ...rule('booking', 'reservation_change'), all: ['financial_read'] };
  if (path === '/bookings')
    return method === 'GET'
      ? { ...rule('none', 'reservation_read'), all: ['financial_read'] }
      : { ...rule('room', 'reservation_change'), all: ['financial_read'] };
  if (
    (path === '/reservations' ||
      path === '/reservations/export' ||
      path === '/reservation-groups') &&
    read
  )
    return { ...rule('property', 'reservation_read'), all: ['financial_read'] };
  if (/^\/rate-plans\/[^/]+/.test(path))
    return rule('ratePlan', method === 'GET' ? 'financial_read' : 'price_change');
  if (/^\/occupancies\/[^/]+/.test(path))
    return rule('occupancy', method === 'GET' ? 'financial_read' : 'price_change');
  // Financial endpoints need a separately reviewed target resolver and response policy.
  return null;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Resolve the target through tenant-scoped rows; a forged URL cannot choose another property. */
export async function propertyForAccess(
  tx: Tx,
  request: TenantRequest,
  resource: AccessRule['resource'],
): Promise<string | null> {
  if (resource === 'none') return null;
  const path = request.path;
  const body = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;
  const chunks = path.split('/').filter(Boolean);
  const id =
    resource === 'property'
      ? chunks[0] === 'properties'
        ? chunks[1]
        : (query?.propertyId ?? body?.propertyId)
      : resource === 'booking'
        ? chunks[1]
        : resource === 'room'
          ? chunks[0] === 'rooms'
            ? chunks[1]
            : body?.roomId
          : chunks[1];
  if (typeof id !== 'string' || !uuid.test(id))
    throw new ForbiddenException('A valid property target is required.');
  if (resource === 'property') {
    const [row] = await tx
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, id));
    return row?.id ?? null;
  }
  if (resource === 'booking') {
    const [row] = await tx
      .select({ propertyId: bookings.propertyId })
      .from(bookings)
      .where(eq(bookings.id, id));
    return row?.propertyId ?? null;
  }
  if (resource === 'block') {
    const [row] = await tx
      .select({ propertyId: maintenanceBlocks.propertyId })
      .from(maintenanceBlocks)
      .where(eq(maintenanceBlocks.id, id));
    return row?.propertyId ?? null;
  }
  if (resource === 'room') {
    const [row] = await tx
      .select({ propertyId: rooms.propertyId })
      .from(rooms)
      .where(eq(rooms.id, id));
    return row?.propertyId ?? null;
  }
  if (resource === 'roomUnit') {
    const [row] = await tx
      .select({ propertyId: roomUnits.propertyId })
      .from(roomUnits)
      .where(eq(roomUnits.id, id));
    return row?.propertyId ?? null;
  }
  if (resource === 'task') {
    const [row] = await tx
      .select({ propertyId: housekeepingTasks.propertyId })
      .from(housekeepingTasks)
      .where(eq(housekeepingTasks.id, id));
    return row?.propertyId ?? null;
  }
  if (resource === 'workOrder') {
    const [row] = await tx
      .select({ propertyId: workOrders.propertyId })
      .from(workOrders)
      .where(eq(workOrders.id, id));
    return row?.propertyId ?? null;
  }
  if (resource === 'ratePlan') {
    const [row] = await tx
      .select({ propertyId: ratePlans.propertyId })
      .from(ratePlans)
      .where(eq(ratePlans.id, id));
    return row?.propertyId ?? null;
  }
  const [row] = await tx
    .select({ propertyId: ratePlans.propertyId })
    .from(occupancies)
    .innerJoin(ratePlans, eq(ratePlans.id, occupancies.ratePlanId))
    .where(eq(occupancies.id, id));
  return row?.propertyId ?? null;
}
