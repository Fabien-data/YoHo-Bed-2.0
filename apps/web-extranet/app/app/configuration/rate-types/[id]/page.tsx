'use client';

import { Skeleton } from '@yohobed/ui';
import { useConfigAccess } from '@/components/configuration/config-frame';
import { RateTypeEditor } from '@/components/configuration/rate-type-editor';
import { OwnerOnlyNotice } from '@/components/configuration/shared';

/** One rate type: `/app/configuration/rate-types/new`, or an existing type's id. */
export default function RateTypePage({ params }: { params: { id: string } }) {
  const { canEdit, role, property, propertyId } = useConfigAccess();
  if (!propertyId || !property) return <Skeleton className="h-96 w-full" />;
  return (
    <>
      {role !== null && !canEdit && <OwnerOnlyNotice />}
      <RateTypeEditor
        key={params.id}
        propertyId={propertyId}
        rateTypeId={params.id === 'new' ? null : params.id}
        canEdit={canEdit}
        currency={property.currency ?? 'LKR'}
      />
    </>
  );
}
