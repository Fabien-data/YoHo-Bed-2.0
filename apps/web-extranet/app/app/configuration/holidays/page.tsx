'use client';

import { Badge } from '@yohobed/ui';
import { formatDate } from '@yohobed/locale';
import type { Holiday } from '@/lib/api';
import { todayIn } from '@/components/stayview/model/dates';
import { ConfigPage, useConfigAccess } from '@/components/configuration/config-frame';
import { SimpleList } from '@/components/configuration/simple-list';

type Draft = { date: string; name: string; recurring: boolean; notes: string };

/** Holidays and special dates, marked on Stay View and the rates calendar. */
export default function HolidaysPage() {
  const { canEdit, property, propertyId } = useConfigAccess();
  return (
    <ConfigPage slug="holidays">
      <SimpleList<'holidays', Draft>
        list="holidays"
        propertyId={propertyId}
        canEdit={canEdit}
        noun="holiday"
        today={todayIn(property?.timezone ?? 'UTC')}
        columns={[
          {
            header: 'Date',
            accessorKey: 'date',
            cell: ({ row }) => (
              <span className="font-mono tabular-nums">{formatDate(row.original.date)}</span>
            ),
          },
          { header: 'Holiday', accessorKey: 'name' },
          {
            header: 'Repeats',
            accessorKey: 'recurring',
            cell: ({ row }) =>
              row.original.recurring ? (
                <Badge tone="info">Every year</Badge>
              ) : (
                <span className="text-ink-3">Once</span>
              ),
          },
          {
            header: 'Notes',
            accessorKey: 'notes',
            cell: ({ row }) => <span className="text-ink-3">{row.original.notes ?? ''}</span>,
          },
        ]}
        fields={[
          { key: 'date', label: 'Date', kind: 'date', required: true },
          { key: 'name', label: 'Name', kind: 'text', required: true, maxLength: 80, span: 2 },
          {
            key: 'recurring',
            label: 'Every year on this date',
            kind: 'switch',
            hint: 'A national day that falls on the same date each year. A Poya day moves, so add it once a year.',
          },
          { key: 'notes', label: 'Notes', kind: 'textarea', maxLength: 500, span: 3 },
        ]}
        blank={{ date: '', name: '', recurring: false, notes: '' }}
        fromRow={(h: Holiday) => ({
          date: h.date,
          name: h.name,
          recurring: h.recurring,
          notes: h.notes ?? '',
        })}
        toBody={(d) => ({
          date: d.date,
          name: d.name.trim(),
          recurring: d.recurring,
          notes: d.notes.trim() || null,
        })}
        valid={(d) => Boolean(d.date && d.name.trim())}
        sheetDescription="Holidays are marked on Stay View and the rates calendar, so the desk and whoever sets prices see them coming."
        emptyDescription="Add public holidays and special dates to see them on the calendars."
        deleteConsequence={(h) =>
          `${h.name} is no longer marked on the calendars. Nothing else changes.`
        }
        label={(h) => h.name}
      />
    </ConfigPage>
  );
}
