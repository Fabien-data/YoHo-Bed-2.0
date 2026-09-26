'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { RateTypesList } from '@/components/configuration/rate-types';

export default function RateTypesPage() {
  const { canEdit, property, propertyId } = useConfigAccess();
  return (
    <ConfigPage slug="rate-types">
      {propertyId && property ? (
        <RateTypesList
          propertyId={propertyId}
          canEdit={canEdit}
          currency={property.currency ?? 'LKR'}
        />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </ConfigPage>
  );
}
