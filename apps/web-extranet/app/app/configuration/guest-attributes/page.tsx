'use client';

import { TagChip } from '@yohobed/ui';
import type { GuestAttribute } from '@/lib/api';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { SimpleList } from '@/components/configuration/simple-list';
import { ActiveBadge } from '@/components/configuration/shared';

type Draft = { name: string; color: string; description: string; active: boolean };

/** Labels the hotel puts on a guest, shown on every stay of theirs. */
export default function GuestAttributesPage() {
  const { canEdit } = useConfigAccess();
  return (
    <ConfigPage slug="guest-attributes">
      <SimpleList<'guest-attributes', Draft>
        list="guest-attributes"
        canEdit={canEdit}
        noun="attribute"
        columns={[
          {
            header: 'Attribute',
            accessorKey: 'name',
            cell: ({ row }) => <TagChip color={row.original.color}>{row.original.name}</TagChip>,
          },
          {
            header: 'What it means',
            accessorKey: 'description',
            cell: ({ row }) => <span className="text-ink-3">{row.original.description ?? ''}</span>,
          },
          {
            header: 'Status',
            accessorKey: 'active',
            cell: ({ row }) => <ActiveBadge active={row.original.active} />,
          },
        ]}
        fields={[
          { key: 'name', label: 'Name', kind: 'text', required: true, maxLength: 40, span: 3 },
          { key: 'color', label: 'Colour', kind: 'color' },
          {
            key: 'description',
            label: 'What it means',
            kind: 'textarea',
            maxLength: 300,
            span: 3,
          },
          { key: 'active', label: 'Offered when labelling guests', kind: 'switch' },
        ]}
        blank={{ name: '', color: 'slate', description: '', active: true }}
        fromRow={(a: GuestAttribute) => ({
          name: a.name,
          color: a.color,
          description: a.description ?? '',
          active: a.active,
        })}
        toBody={(d) => ({
          name: d.name.trim(),
          color: d.color,
          description: d.description.trim() || null,
          active: d.active,
        })}
        valid={(d) => Boolean(d.name.trim())}
        sheetDescription="An attribute labels a guest — repeat guest, allergy, blacklisted — and shows on every reservation of theirs."
        emptyDescription="Add labels such as Repeat guest or Nut allergy, then put them on guests from their profile."
        deleteConsequence={(a) =>
          `${a.name} is taken off every guest who has it. Their stays and details are not touched.`
        }
        label={(a) => a.name}
      />
    </ConfigPage>
  );
}
