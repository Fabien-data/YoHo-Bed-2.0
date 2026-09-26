'use client';

import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { PaymentMethodsTab } from '@/components/configuration/payment-methods-tab';

export default function PaymentMethodsPage() {
  const { canEdit, properties } = useConfigAccess();
  return (
    <ConfigPage slug="payment-methods">
      <PaymentMethodsTab canEdit={canEdit} properties={properties ?? []} />
    </ConfigPage>
  );
}
