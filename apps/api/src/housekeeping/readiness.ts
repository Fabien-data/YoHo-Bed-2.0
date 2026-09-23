import { ConflictException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { housekeepingAsOf, roomUnits, smartPropertyPolicies, type Tx } from '@yohobed/db';

/** A missing housekeeping row means clean, as in the existing room grid. */
export async function assertRoomsReadyForCheckIn(
  tx: Tx,
  propertyId: string,
  roomUnitIds: string[],
  date: string,
) {
  if (!roomUnitIds.length) throw new ConflictException('Assign a physical room before check-in.');
  const [published] = await tx
    .select({ policy: smartPropertyPolicies.published })
    .from(smartPropertyPolicies)
    .where(eq(smartPropertyPolicies.propertyId, propertyId));
  const required = published?.policy?.readiness ?? 'clean';
  const units = await tx
    .select({ id: roomUnits.id, code: roomUnits.code, displayName: roomUnits.displayName })
    .from(roomUnits)
    .where(and(eq(roomUnits.propertyId, propertyId), inArray(roomUnits.id, roomUnitIds)));
  if (units.length !== new Set(roomUnitIds).size)
    throw new ConflictException('A selected room is no longer in this property.');
  const status = await housekeepingAsOf(tx, propertyId, date);
  const blocked = units.filter((unit) => {
    const value = status.get(unit.id)?.status ?? 'clean';
    return required === 'inspected'
      ? value !== 'inspected'
      : value !== 'clean' && value !== 'inspected';
  });
  if (blocked.length)
    throw new ConflictException({
      reason: 'room_not_ready',
      message: `Check-in needs ${required === 'inspected' ? 'inspection' : 'a clean room'}: ${blocked.map((unit) => `${unit.code}${unit.displayName ? ` · ${unit.displayName}` : ''}`).join(', ')}.`,
      roomUnitIds: blocked.map((unit) => unit.id),
    });
}
