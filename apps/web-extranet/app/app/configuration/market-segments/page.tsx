'use client';

import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { MarketSegmentsTab } from '@/components/configuration/market-segments-tab';

export default function MarketSegmentsPage() {
  const { canEdit } = useConfigAccess();
  return (
    <ConfigPage slug="market-segments">
      <MarketSegmentsTab canEdit={canEdit} />
    </ConfigPage>
  );
}
