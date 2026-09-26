'use client';

import { Skeleton } from '@yohobed/ui';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { CurrencyView } from '@/components/configuration/currency-view';

export default function CurrencyPage() {
  const { property } = useConfigAccess();
  return (
    <ConfigPage slug="currency">
      {property ? (
        <CurrencyView base={property.currency ?? 'LKR'} propertyName={property.name} />
      ) : (
        <Skeleton className="h-64 w-full" />
      )}
    </ConfigPage>
  );
}
