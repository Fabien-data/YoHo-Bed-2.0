'use client';

import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { ChargesTab } from '@/components/configuration/charges-tab';

export default function ExtraChargesPage() {
  const { canEdit, property } = useConfigAccess();
  return (
    <ConfigPage slug="extra-charges">
      <ChargesTab canEdit={canEdit} currency={property?.currency ?? 'LKR'} />
    </ConfigPage>
  );
}
