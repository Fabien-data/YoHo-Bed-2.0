'use client';

import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { TransportModesTab } from '@/components/configuration/transport-modes-tab';

export default function TransportTypesPage() {
  const { canEdit, property } = useConfigAccess();
  return (
    <ConfigPage slug="transport">
      <TransportModesTab canEdit={canEdit} currency={property?.currency ?? 'LKR'} />
    </ConfigPage>
  );
}
