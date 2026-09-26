'use client';

import type { Discount } from '@/lib/api';
import { money } from '@/lib/format';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { SimpleList } from '@/components/configuration/simple-list';
import { ActiveBadge } from '@/components/configuration/shared';

type Draft = {
  code: string;
  name: string;
  kind: 'percent' | 'amount';
  value: string;
  description: string;
  active: boolean;
};

/** Named discounts the desk applies to a reservation's nightly rate. */
export default function DiscountsPage() {
  const { canEdit, property, propertyId } = useConfigAccess();
  const currency = property?.currency ?? 'LKR';
  return (
    <ConfigPage slug="discounts">
      <SimpleList<'discounts', Draft>
        list="discounts"
        propertyId={propertyId}
        canEdit={canEdit}
        noun="discount"
        columns={[
          {
            header: 'Code',
            accessorKey: 'code',
            cell: ({ row }) => <span className="font-mono">{row.original.code}</span>,
          },
          { header: 'Discount', accessorKey: 'name' },
          {
            header: 'Takes off',
            accessorKey: 'value',
            cell: ({ row }) => (
              <span className="font-mono tabular-nums">
                {row.original.kind === 'percent'
                  ? `${Number(row.original.value)}% of the rate`
                  : `${money(row.original.value, currency)} a night`}
              </span>
            ),
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
            key: 'kind',
            label: 'Takes off',
            kind: 'select',
            span: 2,
            options: [
              { value: 'percent', label: 'A percentage of the nightly rate' },
              { value: 'amount', label: `An amount each night (${currency})` },
            ],
          },
          { key: 'value', label: 'How much', kind: 'number', required: true },
          {
            key: 'description',
            label: 'When to use it',
            kind: 'textarea',
            maxLength: 300,
            span: 3,
          },
          { key: 'active', label: 'Offered at the desk', kind: 'switch' },
        ]}
        blank={{ code: '', name: '', kind: 'percent', value: '', description: '', active: true }}
        fromRow={(d: Discount) => ({
          code: d.code,
          name: d.name,
          kind: d.kind,
          value: String(Number(d.value)),
          description: d.description ?? '',
          active: d.active,
        })}
        toBody={(d) => ({
          code: d.code.trim(),
          name: d.name.trim(),
          kind: d.kind,
          value: Number(d.value),
          description: d.description.trim() || null,
          active: d.active,
        })}
        valid={(d) => {
          const v = Number(d.value);
          return Boolean(
            d.code.trim() && d.name.trim() && v > 0 && (d.kind === 'amount' || v <= 100),
          );
        }}
        sheetDescription="Applying a discount types the lower rate with the discount as the reason, so the staff limit and the owner's approval beyond it still apply."
        emptyDescription="Add discounts such as Staff 20% or Long stay, and the desk applies them in one click."
        deleteConsequence={(d) =>
          `${d.name} is no longer offered. Stays it was already applied to keep their prices.`
        }
        label={(d) => d.name}
      />
    </ConfigPage>
  );
}
