'use client';

import type { PayoutType } from '@/lib/api';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { SimpleList } from '@/components/configuration/simple-list';
import { ActiveBadge, PAYOUT_CATEGORY } from '@/components/configuration/shared';

type Draft = { code: string; name: string; category: PayoutType['category']; active: boolean };

/** Why money leaves the till — picked on every expense voucher. */
export default function PayoutsPage() {
  const { canEdit } = useConfigAccess();
  return (
    <ConfigPage slug="payouts">
      <SimpleList<'payout-types', Draft>
        list="payout-types"
        canEdit={canEdit}
        noun="payout"
        columns={[
          {
            header: 'Code',
            accessorKey: 'code',
            cell: ({ row }) => <span className="font-mono">{row.original.code}</span>,
          },
          { header: 'Payout', accessorKey: 'name' },
          {
            header: 'Reported under',
            accessorKey: 'category',
            cell: ({ row }) => PAYOUT_CATEGORY[row.original.category],
          },
          {
            header: 'Status',
            accessorKey: 'active',
            cell: ({ row }) => <ActiveBadge active={row.original.active} />,
          },
        ]}
        fields={[
          { key: 'code', label: 'Code', kind: 'text', required: true, maxLength: 12, mono: true },
          { key: 'name', label: 'Name', kind: 'text', required: true, maxLength: 60, span: 2 },
          {
            key: 'category',
            label: 'Reported under',
            kind: 'select',
            span: 3,
            options: Object.entries(PAYOUT_CATEGORY).map(([value, label]) => ({ value, label })),
          },
          { key: 'active', label: 'Offered on expense vouchers', kind: 'switch' },
        ]}
        blank={{ code: '', name: '', category: 'other', active: true }}
        fromRow={(p: PayoutType) => ({
          code: p.code,
          name: p.name,
          category: p.category,
          active: p.active,
        })}
        toBody={(d) => ({
          code: d.code.trim(),
          name: d.name.trim(),
          category: d.category,
          active: d.active,
        })}
        valid={(d) => Boolean(d.code.trim() && d.name.trim())}
        sheetDescription="Every expense voucher paid from a till says why the money went out; the reports group it under the category."
        emptyDescription="Add the reasons cash leaves the till, such as Taxi and transport."
        deleteConsequence={(p) =>
          `${p.name} is no longer offered. Vouchers already written with it keep their category.`
        }
        label={(p) => p.name}
      />
    </ConfigPage>
  );
}
