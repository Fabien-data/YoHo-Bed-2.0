'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { DocumentSeries } from '@/components/configuration/document-series';

export default function DocumentNumberingPage() {
  const { canEdit, property } = useConfigAccess();
  return (
    <ConfigPage slug="document-numbering">
      {property ? (
        <DocumentSeries propertyId={property.id} canEdit={canEdit} />
      ) : (
        <Skeleton className="h-48 w-full" />
      )}
    </ConfigPage>
  );
}
