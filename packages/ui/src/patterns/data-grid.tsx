'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { EmptyState, Skeleton } from '../primitives/surfaces';

export type { ColumnDef } from '@tanstack/react-table';

/**
 * The standard list table — Guest Database, Travel Agents, Channel Logs, Work Orders.
 *
 * Sorting is client-side by design: these lists are per-property and small, and a sort that does
 * not round-trip feels instant. Anything that outgrows that (Channel Logs over months) should
 * page on the server and pass `manualSorting` through instead.
 */
export function DataGrid<T>({
  data,
  columns,
  loading,
  emptyTitle = 'No data',
  emptyDescription,
  emptyAction,
  onRowClick,
  rowKey,
  stickyHeader = false,
  className,
}: {
  data: T[];
  columns: ColumnDef<T, any>[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  onRowClick?: (row: T) => void;
  rowKey?: (row: T) => string;
  stickyHeader?: boolean;
  className?: string;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: rowKey ? (row) => rowKey(row) : undefined,
  });

  if (loading) {
    return (
      <div className={cn('flex flex-col gap-2 p-4', className)}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} shimmer className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      {/* On a phone the table scrolls sideways rather than crushing every column to a word. */}
      <table className="w-full min-w-[40rem] border-collapse text-sm md:min-w-0">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-line bg-surface-2">
              {hg.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                    className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2 first:rounded-l-lg last:rounded-r-lg"
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      // Preflight resets text-transform on buttons, so the header's capitals are
                      // restated here.
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 uppercase transition duration-1 hover:text-ink"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === 'asc' ? (
                          <CaretUp size={12} weight="bold" />
                        ) : dir === 'desc' ? (
                          <CaretDown size={12} weight="bold" />
                        ) : (
                          <CaretUpDown size={12} className="opacity-40" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              className={cn(
                'border-b border-line last:border-0',
                onRowClick && 'cursor-pointer transition duration-1 hover:bg-surface-2',
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-4 py-3 text-ink">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
