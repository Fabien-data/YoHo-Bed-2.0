'use client';

import { Skeleton } from '@yohobed/ui';
import { todayIn } from '@/components/stayview/model/dates';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { TaxesTab } from '@/components/configuration/taxes-tab';

export default function TaxesPage() {
  const { canEdit, property, propertyId } = useConfigAccess();
  return (
    <ConfigPage slug="taxes">
      {propertyId ? (
        <TaxesTab
          propertyId={propertyId}
          canEdit={canEdit}
          today={todayIn(property?.timezone ?? 'UTC')}
        />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </ConfigPage>
  );
}
