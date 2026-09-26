'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { ReservationSettingsForm } from '@/components/configuration/reservation-settings-form';

export default function ReservationSettingsPage() {
  const { canEdit, property } = useConfigAccess();
  return (
    <ConfigPage slug="reservation-settings">
      {property ? (
        <ReservationSettingsForm propertyId={property.id} canEdit={canEdit} />
      ) : (
        <Skeleton className="h-96 w-full" />
      )}
    </ConfigPage>
  );
}
