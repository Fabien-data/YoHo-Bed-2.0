'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { MealPlansEditor } from '@/components/configuration/meal-plans-editor';

export default function MealPlansPage() {
  const { canEdit, property } = useConfigAccess();
  return (
    <ConfigPage slug="meal-plans">
      {property ? (
        <MealPlansEditor propertyId={property.id} canEdit={canEdit} />
      ) : (
        <Skeleton className="h-80 w-full" />
      )}
    </ConfigPage>
  );
}
