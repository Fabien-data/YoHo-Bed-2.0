'use client';

import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowCounterClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  CaretUpDown,
  Columns,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { EmptyState, Skeleton } from '../primitives/surfaces';
import {
  Checkbox,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../primitives/form';
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../primitives/menu';
import { Button } from '../primitives/button';

export type { ColumnDef, VisibilityState } from '@tanstack/react-table';

/** Server-side paging: the grid shows one page and says where it is in the whole. */
export interface GridPagination {
  /** 0-based. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizes?: number[];
}

/** Row selection by key. The grid never owns it: the page decides what "selected" means. */
export interface GridSelection<T> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** The accessible name of a row's checkbox, e.g. "Select 2609180001-1". */
  label?: (row: T) => string;
  /** Rows that cannot be selected (a checked-in booking for a merge, say). */
  disabled?: (row: T) => boolean;
}

const SELECT_ID = '__select';
const ACTIONS_ID = '__actions';

/**
 * The standard list table — Guest Database, Travel Agents, Channel Logs, Work Orders, and the
 * Reservations list.
 *
 * Sorting is client-side by default: most lists are per-property and small, and a sort that does
 * not round-trip feels instant. A list that pages on the server passes `pagination`, which turns
 * client sorting off — sorting one page of many would lie about the order of the whole.
 *
 * Optional, all independent: `selection` (a checkbox column with select-all for the page),
 * `columnVisibility` (from `useColumnVisibility`, edited by `ManageColumns`), `rowActions`
 * (a trailing column, typically a kebab menu) and `stickyFirstColumn` (the first data column
 * stays put while a wide table scrolls sideways on a phone).
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
  selection,
  columnVisibility,
  pagination,
  rowActions,
  stickyFirstColumn = false,
  rowClassName,
  minWidth,
  density = 'default',
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
  selection?: GridSelection<T>;
  columnVisibility?: VisibilityState;
  pagination?: GridPagination;
  rowActions?: (row: T) => React.ReactNode;
  stickyFirstColumn?: boolean;
  rowClassName?: (row: T) => string | undefined;
  /**
   * Below this width the table scrolls sideways instead of crushing its columns. Defaults to
   * 40rem on a phone and none from `md` up.
   */
  minWidth?: string;
  /** `compact` for a wide operational list, where fitting every column matters more than air. */
  density?: 'default' | 'compact';
}) {
  const cellX = density === 'compact' ? 'px-2.5' : 'px-4';
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const keyOf = React.useCallback(
    (row: T, index: number) => (rowKey ? rowKey(row) : String(index)),
    [rowKey],
  );

  const allColumns = React.useMemo(() => {
    const out: ColumnDef<T, any>[] = [];
    if (selection) {
      out.push({
        id: SELECT_ID,
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => {
          const rows = table.getRowModel().rows.filter((r) => !selection.disabled?.(r.original));
          const picked = rows.filter((r) => selection.selected.has(r.id)).length;
          return (
            <Checkbox
              aria-label="Select all on this page"
              checked={picked === 0 ? false : picked === rows.length ? true : 'indeterminate'}
              disabled={rows.length === 0}
              onCheckedChange={() => {
                const next = new Set(selection.selected);
                if (picked === rows.length) rows.forEach((r) => next.delete(r.id));
                else rows.forEach((r) => next.add(r.id));
                selection.onChange(next);
              }}
            />
          );
        },
        cell: ({ row }) => (
          <Checkbox
            aria-label={selection.label?.(row.original) ?? 'Select row'}
            checked={selection.selected.has(row.id)}
            disabled={selection.disabled?.(row.original)}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={() => {
              const next = new Set(selection.selected);
              if (next.has(row.id)) next.delete(row.id);
              else next.add(row.id);
              selection.onChange(next);
            }}
          />
        ),
      });
    }
    out.push(...columns);
    if (rowActions) {
      out.push({
        id: ACTIONS_ID,
        enableSorting: false,
        enableHiding: false,
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => rowActions(row.original),
      });
    }
    return out;
  }, [columns, selection, rowActions]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnVisibility: columnVisibility ?? {} },
    onSortingChange: setSorting,
    enableSorting: !pagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row, index) => keyOf(row, index),
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
      <div className={className}>
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
        {pagination && pagination.total > 0 && <Pager {...pagination} />}
      </div>
    );
  }

  /** Sticky cells: the checkbox column pinned at 0, the first data column right after it. */
  const stickyClass = (columnId: string, index: number, header: boolean) => {
    if (!stickyFirstColumn) return undefined;
    const bg = header ? 'bg-surface-2' : 'bg-surface';
    if (columnId === SELECT_ID) return cn('sticky left-0 z-[2] w-10', bg);
    const firstData = selection ? 1 : 0;
    if (index === firstData) {
      return cn('sticky z-[2] border-r border-line', selection ? 'left-10' : 'left-0', bg);
    }
    return undefined;
  };

  return (
    <div className={className}>
      {/* `relative`: an absolutely positioned child (a screen-reader-only header label) must
          belong to this scroll box. Without it, it escaped to the page and made the whole page
          scroll sideways on a phone. */}
      <div className="relative overflow-x-auto">
        {/* On a phone the table scrolls sideways rather than crushing every column to a word. */}
        <table
          className={cn('w-full border-collapse text-sm', !minWidth && 'min-w-[40rem] md:min-w-0')}
          style={minWidth ? { minWidth } : undefined}
        >
          <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-surface-2">
                {hg.headers.map((header, i) => {
                  const sortable = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined
                      }
                      className={cn(
                        cellX,
                        'py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2 first:rounded-l-lg last:rounded-r-lg',
                        header.column.id === SELECT_ID && 'w-10 px-3',
                        header.column.id === ACTIONS_ID && 'w-12',
                        stickyClass(header.column.id, i, true),
                      )}
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
            {table.getRowModel().rows.map((row) => {
              const selected = selection?.selected.has(row.id);
              return (
                <tr
                  key={row.id}
                  data-state={selected ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'group/row border-b border-line last:border-0',
                    onRowClick && 'cursor-pointer transition duration-1 hover:bg-surface-2',
                    selected && 'bg-brass-soft',
                    rowClassName?.(row.original),
                  )}
                >
                  {row.getVisibleCells().map((cell, i) => (
                    <td
                      key={cell.id}
                      onClick={
                        cell.column.id === ACTIONS_ID || cell.column.id === SELECT_ID
                          ? (e) => e.stopPropagation()
                          : undefined
                      }
                      className={cn(
                        cellX,
                        density === 'compact' ? 'py-2.5' : 'py-3',
                        'align-top text-ink',
                        cell.column.id === SELECT_ID && 'px-3 pt-3.5',
                        cell.column.id === ACTIONS_ID && 'px-2 py-2 text-right',
                        stickyClass(cell.column.id, i, false),
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pagination && <Pager {...pagination} />}
    </div>
  );
}

/** "1–25 of 132", the page size, and previous / next. */
function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100],
}: GridPagination) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-3"
    >
      <span className="tabular-nums" aria-live="polite">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger aria-label="Rows per page" className="h-8 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizes.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {`${s} rows`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="tabular-nums">
          Page {page + 1} of {pages}
        </span>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8"
          aria-label="Previous page"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
        >
          <CaretLeft size={14} />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8"
          aria-label="Next page"
          disabled={page + 1 >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          <CaretRight size={14} />
        </Button>
      </div>
    </nav>
  );
}

export interface ManagedColumn {
  id: string;
  label: string;
  /** Always shown: the column that says which row is which. */
  locked?: boolean;
}

/**
 * Which columns a grid shows, remembered per grid in this browser. `hidden` lists the columns off
 * by default. Storage can be blocked (a private window); the grid then simply forgets on reload.
 */
export function useColumnVisibility(gridId: string, hidden: string[] = []) {
  const key = `yoho.grid.${gridId}.columns`;
  const defaults = React.useMemo(
    () => Object.fromEntries(hidden.map((id) => [id, false])) as VisibilityState,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hidden.join('|')],
  );
  const [visibility, setVisibility] = React.useState<VisibilityState>(defaults);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setVisibility({ ...defaults, ...(JSON.parse(raw) as VisibilityState) });
    } catch {
      // Storage unavailable or corrupt: keep the defaults.
    }
  }, [key, defaults]);

  const update = React.useCallback(
    (next: VisibilityState) => {
      setVisibility(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not remembered, but still applied for this visit.
      }
    },
    [key],
  );

  const reset = React.useCallback(() => {
    setVisibility(defaults);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing stored to remove.
    }
  }, [key, defaults]);

  return { visibility, setVisibility: update, reset };
}

/** Yanolja's "Manage Columns": tick the columns to show. */
export function ManageColumns({
  columns,
  visibility,
  onChange,
  onReset,
}: {
  columns: ManagedColumn[];
  visibility: VisibilityState;
  onChange: (next: VisibilityState) => void;
  onReset?: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <Columns size={14} />
          Manage columns
        </Button>
      </MenuTrigger>
      <MenuContent
        align="end"
        className="w-56 overflow-y-auto"
        // Never taller than the room below (or above) the button: the list scrolls instead, so
        // the last column and Reset stay reachable on a short screen.
        style={{ maxHeight: 'min(70vh, var(--radix-dropdown-menu-content-available-height))' }}
      >
        <MenuLabel>Show columns</MenuLabel>
        {columns.map((c) => (
          <MenuCheckboxItem
            key={c.id}
            checked={visibility[c.id] !== false}
            disabled={c.locked}
            // Keep the menu open: people untick several columns in a row.
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => onChange({ ...visibility, [c.id]: Boolean(on) })}
          >
            {c.label}
          </MenuCheckboxItem>
        ))}
        {onReset && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={onReset}>
              <ArrowCounterClockwise size={14} />
              Reset to default
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
