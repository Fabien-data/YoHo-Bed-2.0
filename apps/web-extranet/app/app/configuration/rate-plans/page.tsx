'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { RatePlansView } from '@/components/configuration/rate-plans';

export default function RatePlansPage() {
  const { canEdit, propertyId } = useConfigAccess();
  return (
    <ConfigPage slug="rate-plans">
      {propertyId ? (
        <RatePlansView propertyId={propertyId} canEdit={canEdit} />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </ConfigPage>
  );
}
