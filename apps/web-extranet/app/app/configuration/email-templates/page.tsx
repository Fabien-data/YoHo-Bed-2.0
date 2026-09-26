'use client';

import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { EmailTemplates } from '@/components/configuration/email-templates';

export default function EmailTemplatesPage() {
  const { canEdit } = useConfigAccess();
  return (
    <ConfigPage slug="email-templates">
      <EmailTemplates canEdit={canEdit} />
    </ConfigPage>
  );
}
