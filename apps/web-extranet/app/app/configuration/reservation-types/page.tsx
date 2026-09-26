'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { ReservationTypesEditor } from '@/components/configuration/reservation-types-editor';

export default function ReservationTypesPage() {
  const { canEdit, property } = useConfigAccess();
  return (
    <ConfigPage slug="reservation-types">
      {property ? (
        <ReservationTypesEditor propertyId={property.id} canEdit={canEdit} />
      ) : (
        <Skeleton className="h-80 w-full" />
      )}
    </ConfigPage>
  );
}
