'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { RoomTypesList } from '@/components/configuration/room-types';

export default function RoomTypesPage() {
  const { canEdit, role, propertyId } = useConfigAccess();
  // A hotel role with the setup permission looks after the room types as well as the owner.
  const mayEdit = canEdit || role === 'CUSTOM';
  return (
    <ConfigPage slug="room-types">
      {propertyId ? (
        <RoomTypesList propertyId={propertyId} canEdit={mayEdit} />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </ConfigPage>
  );
}
