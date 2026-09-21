'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CaretDown,
  DownloadSimple,
  FunnelSimple,
  ListDashes,
  MagnifyingGlass,
  Plus,
  SquaresFour,
  User,
  UsersThree,
  X,
} from '@phosphor-icons/react';
import {
  Button,
  Card,
  Checkbox,
  Combobox,
  DataGrid,
  DatePicker,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  ManageColumns,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Skeleton,
  TabsList,
  TabsTrigger,
  Tabs,
  TagDot,
  toast,
  useColumnVisibility,
  type ColumnDef,
  type ComboboxOption,
  type ManagedColumn,
} from '@yohobed/ui';
import { displayMealCode, formatDate } from '@yohobed/locale';
import {
  ApiError,
  downloadReservationsCsv,
  getReservationGroups,
  getReservations,
  getUser,
  makeBookingGroup,
  mergeReservationGroups,
  type GroupTab,
  type ReservationConfig,
  type ReservationFilters,
  type ReservationGroupCard,
  type ReservationKindFilter,
  type ReservationRow,
  type ReservationTab,
} from '@/lib/api';
import { useReservationConfig } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';
import { money as formatMoney } from '@/lib/format';
import { RegistrationCardSheet } from '@/components/reservations/registration-card';
import { useReservationComposer } from '@/components/reservations/composer/composer-context';
import { useDebounced } from '@/components/reservations/composer/shared';
import { StatusChip, StayWhen, bookedAt } from '@/components/reservations/list/bits';
import { GroupCardView, GuestCell, ReservationCard } from '@/components/reservations/list/cards';
import { RowActions, useInvalidateReservations } from '@/components/reservations/list/row-actions';
import { ReservationDetailSheet } from '@/components/reservations/list/detail-sheet';

const TABS: Array<{ value: ReservationTab; label: string }> = [
  { value: 'all', label: 'Reservations' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'booked', label: 'Booked today' },
  { value: 'arrivals', label: 'Arrivals' },
  { value: 'departures', label: 'Departures' },
  { value: 'inhouse', label: 'In-house' },
  { value: 'cancelled', label: 'Cancelled' },
];

const GROUP_TABS: Array<{ value: GroupTab; label: string }> = [
  { value: 'upcoming', label: 'Reservations' },
  { value: 'inhouse', label: 'In-house' },
  { value: 'departed', label: 'Departed' },
];

const KIND_FILTERS: Array<{ value: ReservationKindFilter | 'any'; label: string }> = [
  { value: 'any', label: 'All types' },
  { value: 'confirm', label: 'Confirmed' },
  { value: 'holds', label: 'Holds' },
  { value: 'inquiry', label: 'Inquiries' },
  { value: 'online_failed', label: 'Online failed' },
];

const COLUMNS: ManagedColumn[] = [
  { id: 'guest', label: 'Guest', locked: true },
  { id: 'reference', label: 'Res no. / voucher' },
  { id: 'bookedAt', label: 'Booking date' },
  { id: 'arrival', label: 'Arrival' },
  { id: 'departure', label: 'Departure' },
  { id: 'room', label: 'Room details' },
  { id: 'status', label: 'Status' },
  { id: 'source', label: 'Business source' },
  { id: 'segment', label: 'Market segment' },
  { id: 'user', label: 'User' },
  { id: 'total', label: 'Total' },
  { id: 'paid', label: 'Paid' },
  { id: 'balance', label: 'Balance' },
];
// Off until asked for in Manage columns, so Total, Paid and Balance fit on a laptop screen. The
// booking date is on every card and in the reservation sheet, and "Booked today" is a tab; with
// the column on, it also says who took the reservation.
const HIDDEN_BY_DEFAULT = ['source', 'segment', 'user', 'bookedAt'];

const RESERVATION_TABS = new Set(TABS.map((t) => t.value));

function ReservationsScreen() {
  const params = useSearchParams();
  const { propertyId } = useActiveProperty();
  const config = useReservationConfig(propertyId);
  const cfg = config.data;
  const { openComposer, openFullPage } = useReservationComposer();

  const [date, setDate] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<ReservationTab>(() => {
    const t = params.get('tab') as ReservationTab | null;
    return t && RESERVATION_TABS.has(t) ? t : 'all';
  });
  const [groupTab, setGroupTab] = React.useState<GroupTab>('upcoming');
  const [search, setSearch] = React.useState(() => params.get('q') ?? '');
  const [mode, setMode] = React.useState<'individual' | 'group'>('individual');
  const [layout, setLayout] = React.useState<'list' | 'cards'>('list');
  const [kind, setKind] = React.useState<ReservationKindFilter | 'any'>('any');
  const [sourceId, setSourceId] = React.useState<string | null>(null);
  const [segmentId, setSegmentId] = React.useState<string | null>(null);
  const [mine, setMine] = React.useState(false);
  const [group, setGroup] = React.useState<{ id: string; code: string } | null>(null);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(25);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = React.useState<Set<string>>(new Set());
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [cardFor, setCardFor] = React.useState<string | null>(null);
  const [groupName, setGroupName] = React.useState('');
  const [mergeOpen, setMergeOpen] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const columns = useColumnVisibility('reservations', HIDDEN_BY_DEFAULT);
  const refresh = useInvalidateReservations();
  const q = useDebounced(search.trim(), 250);
  const me = getUser()?.id;

  // The hotel's own date, once its config has loaded.
  const day = date ?? cfg?.today ?? null;

  // Anything that changes the rows goes back to page 1 and drops the selection.
  React.useEffect(() => {
    setPage(0);
    setSelected(new Set());
    setSelectedGroups(new Set());
  }, [day, tab, groupTab, q, kind, sourceId, segmentId, mine, group, mode, pageSize]);

  const filters: ReservationFilters | null =
    propertyId && day
      ? {
          propertyId,
          date: day,
          tab,
          q: q || undefined,
          kind: kind === 'any' ? undefined : kind,
          businessSourceId: sourceId ?? undefined,
          marketSegmentId: segmentId ?? undefined,
          createdBy: mine && me ? me : undefined,
          groupId: group?.id,
        }
      : null;

  const list = useQuery({
    queryKey: ['reservations', filters, page, pageSize],
    queryFn: () => getReservations({ ...filters!, limit: pageSize, offset: page * pageSize }),
    enabled: Boolean(filters) && mode === 'individual',
    placeholderData: (prev) => prev,
  });
  const groups = useQuery({
    queryKey: ['reservation-groups', propertyId, day, groupTab, q, page, pageSize],
    queryFn: () =>
      getReservationGroups({
        propertyId: propertyId!,
        date: day!,
        tab: groupTab,
        q: q || undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
    enabled: Boolean(propertyId && day) && mode === 'group',
    placeholderData: (prev) => prev,
  });

  React.useEffect(() => {
    const requested = params.get('bookingId');
    if (requested && list.data?.rows.some((row) => row.id === requested)) setOpenId(requested);
  }, [params, list.data?.rows]);

  const makeGroup = useMutation({
    mutationFn: () =>
      makeBookingGroup(propertyId!, {
        bookingIds: [...selected],
        name: groupName.trim() || undefined,
      }),
    onSuccess: (g) => {
      setSelected(new Set());
      setGroupName('');
      refresh();
      toast.success(`Group ${g.code} made`, { description: `${g.memberCount} reservations` });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not make the group'),
  });

  if (!cfg || !day) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const money = (v: string | number, currency?: string) =>
    formatMoney(v, currency ?? cfg.property.currency);
  const rows = list.data?.rows ?? [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const openRow = openId ? (byId.get(openId) ?? null) : null;
  const filtered = kind !== 'any' || sourceId || segmentId || mine || group;

  const sourceOptions: ComboboxOption[] = cfg.businessSources.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.shortCode,
    keywords: [s.shortCode],
    prefix: <TagDot color={s.palette} />,
  }));

  const gridColumns: ColumnDef<ReservationRow>[] = [
    {
      id: 'guest',
      header: 'Guest name',
      cell: ({ row }) => (
        <button type="button" className="text-left" onClick={() => setOpenId(row.original.id)}>
          <GuestCell row={row.original} />
        </button>
      ),
    },
    {
      id: 'reference',
      header: 'Res no. / voucher',
      cell: ({ row }) => (
        <span className="flex flex-col whitespace-nowrap">
          <span className="font-mono text-[13px] font-semibold text-ink">
            {row.original.reference}
          </span>
          {row.original.voucherNo && (
            <span className="font-mono text-xs text-ink-3">{row.original.voucherNo}</span>
          )}
          {row.original.groupCode && (
            <button
              type="button"
              className="mt-0.5 self-start whitespace-nowrap rounded bg-surface-2 px-1 font-mono text-[10px] text-ink-3 hover:text-ink"
              onClick={() => setGroup({ id: row.original.groupId!, code: row.original.groupCode! })}
            >
              {/* A reservation's own group is coded with its master reference, already shown. */}
              {row.original.reference.startsWith(`${row.original.groupCode}-`)
                ? 'Group'
                : `Group ${row.original.groupCode}`}
            </button>
          )}
        </span>
      ),
    },
    {
      id: 'bookedAt',
      header: 'Booking date',
      cell: ({ row }) => {
        const b = bookedAt(row.original.createdAt, cfg.property.timezone);
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span className="font-mono text-[13px] tabular-nums text-ink">{b.date}</span>
            <span className="text-xs text-ink-3">{b.time}</span>
            {/* Who took it, unless the User column is showing it already. */}
            {columns.visibility.user === false && (
              <span className="max-w-[8rem] truncate text-xs text-ink-3">
                {row.original.createdByName ?? row.original.channel ?? row.original.source}
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: 'arrival',
      header: 'Arrival',
      cell: ({ row }) => (
        <StayWhen
          date={row.original.checkin}
          time={row.original.arrivalTime}
          fallback={cfg.property.checkinTime}
          format={cfg.settings.timeFormat}
        />
      ),
    },
    {
      id: 'departure',
      header: 'Departure',
      cell: ({ row }) => (
        <StayWhen
          date={row.original.checkout}
          time={row.original.departureTime}
          fallback={cfg.property.checkoutTime}
          format={cfg.settings.timeFormat}
        />
      ),
    },
    {
      id: 'room',
      header: 'Room details',
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="flex min-w-[7rem] flex-col">
            <span className="font-medium text-ink">
              {r.roomCodes.length ? r.roomCodes.join(', ') : 'Unassigned'}
            </span>
            <span className="text-xs text-ink-3">
              {r.roomTypeName}
              {r.rateCode && ` · ${displayMealCode(r.rateCode, cfg.settings.mealCodeStyle)}`}
            </span>
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusChip row={row.original} kinds={cfg.kinds} />,
    },
    {
      id: 'source',
      header: 'Business source',
      cell: ({ row }) => (
        <span className="text-ink-2">{row.original.sourceName ?? row.original.channel ?? '—'}</span>
      ),
    },
    {
      id: 'segment',
      header: 'Market segment',
      cell: ({ row }) => <span className="text-ink-2">{row.original.segmentName ?? '—'}</span>,
    },
    {
      id: 'user',
      header: 'User',
      cell: ({ row }) => (
        <span className="text-ink-2">
          {row.original.createdByName ??
            (row.original.channel ? row.original.channel : row.original.source)}
        </span>
      ),
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total ({cfg.property.currency})</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono tabular-nums text-ink">
          {money(row.original.total, row.original.currency).replace(/^[^\d-]+/, '')}
        </span>
      ),
    },
    {
      id: 'paid',
      header: () => <span className="block text-right">Paid</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono tabular-nums text-ink-2">
          {money(row.original.paid, row.original.currency).replace(/^[^\d-]+/, '')}
        </span>
      ),
    },
    {
      id: 'balance',
      header: () => <span className="block text-right">Balance</span>,
      cell: ({ row }) => (
        <span
          className={`block text-right font-mono tabular-nums ${
            row.original.balanceDue ? 'font-semibold text-closed-ink' : 'text-ink-2'
          }`}
        >
          {money(row.original.balance, row.original.currency).replace(/^[^\d-]+/, '')}
        </span>
      ),
    },
  ];

  async function exportCsv() {
    if (!filters) return;
    setExporting(true);
    try {
      await downloadReservationsCsv(filters);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'The export failed. Try again.');
    } finally {
      setExporting(false);
    }
  }

  const counts = list.data?.counts;
  const total = mode === 'individual' ? (list.data?.total ?? 0) : (groups.data?.total ?? 0);
  const pager = {
    page,
    pageSize,
    total,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
  };

  return (
    <div>
      <PageHeader
        eyebrow="Front desk"
        title="Reservations"
        actions={
          <>
            <DatePicker
              aria-label="Business date"
              value={day}
              today={cfg.today}
              onChange={(d) => setDate(d)}
              className="w-40"
            />
            <div className="relative">
              <MagnifyingGlass
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Reference, voucher, name, email or phone"
                className="w-72 pl-8"
                aria-label="Search reservations"
              />
            </div>
            <div className="flex">
              <Button
                size="sm"
                className="rounded-r-none"
                onClick={() => openComposer({ checkin: day })}
              >
                <Plus size={14} />
                New reservation
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    size="sm"
                    className="rounded-l-none border-l border-l-white/20 px-2"
                    aria-label="More ways to add a reservation"
                  >
                    <CaretDown size={12} weight="bold" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  <MenuItem onSelect={() => openComposer({ checkin: day })}>
                    Quick reservation
                  </MenuItem>
                  <MenuItem onSelect={() => openFullPage({ checkin: day })}>
                    Full reservation page
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          </>
        }
      />

      {/* Tabs, on their own row so none is ever cut off. */}
      <div className="mb-3 border-b border-line">
        {mode === 'individual' ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as ReservationTab)} className="min-w-0">
            <TabsList className="overflow-x-auto border-b-0">
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value} count={counts?.[t.value]}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : (
          <Tabs
            value={groupTab}
            onValueChange={(v) => setGroupTab(v as GroupTab)}
            className="min-w-0"
          >
            <TabsList className="overflow-x-auto border-b-0">
              {GROUP_TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  count={t.value === groupTab ? groups.data?.total : undefined}
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {/* Filters on the left; views and actions on the right. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {mode === 'individual' && (
          <>
            <FunnelSimple size={15} className="text-ink-3" aria-hidden />
            <Select value={kind} onValueChange={(v) => setKind(v as ReservationKindFilter | 'any')}>
              <SelectTrigger aria-label="Reservation type" className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_FILTERS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="w-52">
              <Combobox
                aria-label="Business source"
                value={sourceId}
                onChange={setSourceId}
                options={sourceOptions}
                placeholder="All sources"
                clearable
                searchPlaceholder="Search sources…"
              />
            </div>
            <Select
              value={segmentId ?? 'any'}
              onValueChange={(v) => setSegmentId(v === 'any' ? null : v)}
            >
              <SelectTrigger aria-label="Market segment" className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All segments</SelectItem>
                {cfg.marketSegments.map((s) => (
                  <SelectItem key={s.id} value={s.id} hint={s.code}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 px-1 text-sm text-ink-2">
              <Checkbox
                checked={mine}
                onCheckedChange={(c) => setMine(c === true)}
                aria-label="Taken by me"
              />
              Taken by me
            </label>
            {group && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brass-soft px-2.5 py-1 text-xs font-semibold text-brass-ink">
                Group {group.code}
                <button
                  type="button"
                  aria-label="Show all reservations"
                  onClick={() => setGroup(null)}
                >
                  <X size={12} weight="bold" />
                </button>
              </span>
            )}
            {filtered && (
              <button
                type="button"
                className="text-xs font-medium text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink"
                onClick={() => {
                  setKind('any');
                  setSourceId(null);
                  setSegmentId(null);
                  setMine(false);
                  setGroup(null);
                }}
              >
                Clear filters
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Individual or group view"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setGroup(null);
            }}
            options={[
              {
                value: 'individual',
                label: <User size={15} />,
                ariaLabel: 'Individual reservations',
              },
              { value: 'group', label: <UsersThree size={15} />, ariaLabel: 'Groups' },
            ]}
          />
          <SegmentedControl
            aria-label="List or cards"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'cards', label: <SquaresFour size={15} />, ariaLabel: 'Cards' },
              { value: 'list', label: <ListDashes size={15} />, ariaLabel: 'List' },
            ]}
          />
          {mode === 'individual' && layout === 'list' && (
            <ManageColumns
              columns={COLUMNS}
              visibility={columns.visibility}
              onChange={columns.setVisibility}
              onReset={columns.reset}
            />
          )}
          {mode === 'group' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={selectedGroups.size < 2}
              onClick={() => setMergeOpen(true)}
            >
              <UsersThree size={14} />
              Merge groups
            </Button>
          )}
          {mode === 'individual' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={exportCsv}
              loading={exporting}
              disabled={total === 0}
            >
              <DownloadSimple size={14} />
              Export
            </Button>
          )}
        </div>
      </div>

      {mode === 'individual' && selected.size > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
          <UsersThree size={16} className="text-ink-2" />
          <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
          <Input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (optional)"
            className="w-56"
            aria-label="Group name"
          />
          <Button
            size="sm"
            onClick={() => makeGroup.mutate()}
            disabled={selected.size < 2 || makeGroup.isPending}
          >
            Make group
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {selected.size < 2 && (
            <span className="text-xs text-ink-3">Select at least two to group them.</span>
          )}
        </Card>
      )}

      {mode === 'individual' ? (
        layout === 'list' ? (
          <Card className="overflow-hidden">
            <DataGrid
              data={rows}
              columns={gridColumns}
              loading={list.isLoading}
              rowKey={(r) => r.id}
              emptyTitle={q ? 'Nothing matches that search' : 'No reservations on this tab'}
              emptyDescription={
                filtered
                  ? 'Try clearing the filters.'
                  : 'Pick another tab or date, or take a new reservation.'
              }
              selection={{
                selected,
                onChange: setSelected,
                label: (r) => `Select ${r.reference}`,
              }}
              columnVisibility={columns.visibility}
              pagination={pager}
              stickyFirstColumn
              density="compact"
              minWidth="64rem"
              rowActions={(r) => (
                <RowActions
                  row={r}
                  today={cfg.today}
                  onOpen={() => setOpenId(r.id)}
                  onCard={() => setCardFor(r.id)}
                />
              )}
            />
          </Card>
        ) : list.isLoading ? (
          <CardsSkeleton />
        ) : rows.length === 0 ? (
          <EmptyState title={q ? 'Nothing matches that search' : 'No reservations on this tab'} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {rows.map((r) => (
                <ReservationCard
                  key={r.id}
                  row={r}
                  cfg={cfg}
                  money={(v) => money(v, r.currency)}
                  selected={selected.has(r.id)}
                  onToggle={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                  onOpen={() => setOpenId(r.id)}
                  actions={
                    <RowActions
                      row={r}
                      today={cfg.today}
                      onOpen={() => setOpenId(r.id)}
                      onCard={() => setCardFor(r.id)}
                    />
                  }
                />
              ))}
            </div>
            <CardPager {...pager} />
          </>
        )
      ) : (
        <GroupsView
          cfg={cfg}
          loading={groups.isLoading}
          rows={groups.data?.rows ?? []}
          layout={layout}
          money={money}
          selected={selectedGroups}
          onSelect={setSelectedGroups}
          onOpen={(g) => {
            setMode('individual');
            setGroup({ id: g.id, code: g.code });
          }}
          pager={pager}
        />
      )}

      <ReservationDetailSheet
        row={openRow}
        cfg={cfg}
        money={(v) => money(v, openRow?.currency)}
        onClose={() => setOpenId(null)}
        onCard={(id) => setCardFor(id)}
        initialTab={params.get('section') === 'folio' ? 'folio' : 'details'}
      />
      <Sheet open={cardFor !== null} onOpenChange={(o) => !o && setCardFor(null)}>
        <SheetContent title="Registration card" wide>
          {cardFor && <RegistrationCardSheet bookingId={cardFor} />}
        </SheetContent>
      </Sheet>
      <MergeGroupsDialog
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        groups={(groups.data?.rows ?? []).filter((g) => selectedGroups.has(g.id))}
        onMerged={() => {
          setSelectedGroups(new Set());
          refresh();
        }}
      />
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-72 w-full" />
      ))}
    </div>
  );
}

/** Paging under the card grids, matching the table's. */
function CardPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-2 text-xs text-ink-3">
      <span className="tabular-nums">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page === 0}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={page + 1 >= pages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </Button>
    </nav>
  );
}

function GroupsView({
  cfg,
  loading,
  rows,
  layout,
  money,
  selected,
  onSelect,
  onOpen,
  pager,
}: {
  cfg: ReservationConfig;
  loading: boolean;
  rows: ReservationGroupCard[];
  layout: 'list' | 'cards';
  money: (v: string | number, currency?: string) => string;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  onOpen: (g: ReservationGroupCard) => void;
  pager: React.ComponentProps<typeof CardPager> & { onPageSizeChange?: (n: number) => void };
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelect(next);
  };
  if (layout === 'cards') {
    if (loading) return <CardsSkeleton />;
    if (rows.length === 0) {
      return (
        <EmptyState
          title="No groups here"
          description="A reservation of two rooms or more makes a group, and so does Make group."
        />
      );
    }
    return (
      <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.map((g) => (
            <GroupCardView
              key={g.id}
              group={g}
              cfg={cfg}
              money={(v) => money(v, g.currency)}
              selected={selected.has(g.id)}
              onToggle={() => toggle(g.id)}
              onOpen={() => onOpen(g)}
            />
          ))}
        </div>
        <CardPager {...pager} />
      </>
    );
  }
  const columns: ColumnDef<ReservationGroupCard>[] = [
    {
      id: 'group',
      header: 'Group',
      cell: ({ row }) => (
        <button type="button" className="text-left" onClick={() => onOpen(row.original)}>
          <span className="block font-medium text-ink">
            {row.original.name || row.original.ownerName}
          </span>
          <span className="font-mono text-xs text-ink-3">
            {row.original.code}
            {row.original.voucherNo && ` | ${row.original.voucherNo}`}
          </span>
        </button>
      ),
    },
    {
      id: 'stay',
      header: 'Stay',
      cell: ({ row }) => (
        <span className="whitespace-nowrap font-mono text-[13px] tabular-nums text-ink">
          {formatDate(row.original.checkin)} → {formatDate(row.original.checkout)}
        </span>
      ),
    },
    {
      id: 'rooms',
      header: 'Rooms',
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.roomsLive} ({row.original.roomsTotal})
        </span>
      ),
    },
    {
      id: 'pax',
      header: 'Guests',
      cell: ({ row }) => (
        <span className="text-ink-2">
          {row.original.adults} + {row.original.children}
        </span>
      ),
    },
    {
      id: 'total',
      header: () => <span className="block text-right">Total</span>,
      cell: ({ row }) => (
        <span className="block text-right font-mono tabular-nums">
          {money(row.original.total, row.original.currency)}
        </span>
      ),
    },
    {
      id: 'balance',
      header: () => <span className="block text-right">Balance</span>,
      cell: ({ row }) => (
        <span
          className={`block text-right font-mono tabular-nums ${
            Number(row.original.balance) > 0.004 ? 'font-semibold text-closed-ink' : ''
          }`}
        >
          {money(row.original.balance, row.original.currency)}
        </span>
      ),
    },
  ];
  return (
    <Card className="overflow-hidden">
      <DataGrid
        data={rows}
        columns={columns}
        loading={loading}
        rowKey={(g) => g.id}
        emptyTitle="No groups here"
        selection={{ selected, onChange: onSelect, label: (g) => `Select group ${g.code}` }}
        pagination={pager}
      />
    </Card>
  );
}

/** Merge Group: pick the group to keep; its owner stays the owner. */
function MergeGroupsDialog({
  open,
  onOpenChange,
  groups,
  onMerged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ReservationGroupCard[];
  onMerged: () => void;
}) {
  const [keep, setKeep] = React.useState<string>('');
  const merge = useMutation({
    mutationFn: () =>
      mergeReservationGroups(
        keep,
        groups.filter((g) => g.id !== keep).map((g) => g.id),
      ),
    onSuccess: (g) => {
      toast.success(`Merged into group ${g.code}`, { description: `${g.memberCount} rooms` });
      onMerged();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not merge the groups'),
  });
  React.useEffect(() => {
    if (open) setKeep(groups[0]?.id ?? '');
  }, [open, groups]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Merge groups" className="max-w-md">
        <div className="flex flex-col gap-4 px-5 py-4">
          <p className="text-sm text-ink-2">
            The rooms of {groups.length} groups become one group. Groups can only be merged before
            anyone has checked in.
          </p>
          <Field label="Keep this group (its owner pays)" htmlFor="merge-keep">
            <Select value={keep || undefined} onValueChange={setKeep}>
              <SelectTrigger id="merge-keep">
                <SelectValue placeholder="-Select-" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id} hint={`${g.roomsTotal} rooms`}>
                    {`${g.code} · ${g.name || g.ownerName || ''}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!keep || groups.length < 2}
              loading={merge.isPending}
              onClick={() => merge.mutate()}
            >
              Merge
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ReservationsPage() {
  // useSearchParams needs a Suspense boundary for Next's static rendering pass.
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ReservationsScreen />
    </React.Suspense>
  );
}
