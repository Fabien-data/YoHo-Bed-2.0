'use client';

import { Badge } from '@yohobed/ui';
import type { RemarkTemplate, RemarkType } from '@/lib/api';
import { REMARK_LABEL } from '@/components/reservations/full/line-extras';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { SimpleList } from '@/components/configuration/simple-list';
import { ActiveBadge } from '@/components/configuration/shared';

type Draft = { type: RemarkType; text: string; active: boolean };

/** Saved remarks the desk adds to a reservation with one click. */
export default function RemarksPage() {
  const { canEdit } = useConfigAccess();
  return (
    <ConfigPage slug="remarks">
      <SimpleList<'remarks', Draft>
        list="remarks"
        canEdit={canEdit}
        noun="remark"
        columns={[
          {
            header: 'For',
            accessorKey: 'type',
            cell: ({ row }) => (
              <Badge tone="muted" dot={false}>
                {REMARK_LABEL[row.original.type]}
              </Badge>
            ),
          },
          { header: 'Remark', accessorKey: 'text' },
          {
            header: 'Status',
            accessorKey: 'active',
            cell: ({ row }) => <ActiveBadge active={row.original.active} />,
          },
        ]}
        fields={[
          {
            key: 'type',
            label: 'Who reads it',
            kind: 'select',
            span: 3,
            options: Object.entries(REMARK_LABEL).map(([value, label]) => ({ value, label })),
          },
          {
            key: 'text',
            label: 'Remark',
            kind: 'textarea',
            required: true,
            maxLength: 500,
            span: 3,
          },
          { key: 'active', label: 'Offered at the desk', kind: 'switch' },
        ]}
        blank={{ type: 'general', text: '', active: true }}
        fromRow={(r: RemarkTemplate) => ({ type: r.type, text: r.text, active: r.active })}
        toBody={(d) => ({ type: d.type, text: d.text.trim(), active: d.active })}
        valid={(d) => Boolean(d.text.trim())}
        sheetDescription="A saved remark is added to a reservation in one click from Add remark, with the department that reads it."
        emptyDescription="Save the remarks the desk types again and again, such as Late arrival — keep the room."
        deleteConsequence={() =>
          'It is no longer offered. Remarks already added to reservations stay.'
        }
        label={(r) => (r.text.length > 40 ? `${r.text.slice(0, 40)}…` : r.text)}
      />
    </ConfigPage>
  );
}
