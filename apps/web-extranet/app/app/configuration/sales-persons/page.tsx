'use client';

import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { SalesPersonsTab } from '@/components/configuration/sales-persons-tab';

export default function SalesPersonsPage() {
  const { canEdit } = useConfigAccess();
  return (
    <ConfigPage slug="sales-persons">
      <SalesPersonsTab canEdit={canEdit} />
    </ConfigPage>
  );
}
