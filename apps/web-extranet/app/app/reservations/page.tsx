'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Crown, Download, LayoutList, Printer, Search, Table2, Users2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Sheet,
  SheetContent,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
  type Tone,
} from '@yohobed/ui';
import {
  getReservations,
  makeBookingGroup,
  type ReservationRow,
  type ReservationTab,
} from '@/lib/api';
import { useProperties } from '@/lib/queries';
import { RegistrationCardSheet } from '@/components/reservations/registration-card';

const TABS: Array<{ value: ReservationTab; label: string }> = [
  { value: 'all', label: 'Reservations' },
  { value: 'arrivals', label: 'Arrivals' },
  { value: 'departures', label: 'Departures' },
  { value: 'inhouse', label: 'In-house' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_TONE: Record<string, Tone> = {
  Pending: 'low',
  Approved: 'brand',
  CheckedIn: 'avail',
  CheckedOut: 'muted',
  Cancelled: 'closed',
  Rejected: 'closed',
  NoShow: 'closed',
};

export default function ReservationsPage() {
  const qc = useQueryClient();
  const { data: properties } = useProperties();
  const propertyId = properties?.[0]?.id;

  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [tab, setTab] = React.useState<ReservationTab>('all');
  const [search, setSearch] = React.useState('');
  const [view, setView] = React.useState<'list' | 'cards'>('list');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [cardFor, setCardFor] = React.useState<string | null>(null);
  const [groupName, setGroupName] = React.useState('');

  // Debounced so typing does not fire a request per keystroke.
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({
    queryKey: ['reservations', propertyId, date, tab, debounced],
    queryFn: () =>
      getReservations({ propertyId: propertyId!, date, tab, q: debounced || undefined }),
    enabled: !!propertyId,
    placeholderData: (prev) => prev,
  });

  const group = useMutation({
    mutationFn: () =>
      makeBookingGroup(propertyId!, {
        bookingIds: [...selected],
        name: groupName.trim() || undefined,
      }),
    onSuccess: () => {
      setSelected(new Set());
      setGroupName('');
      qc.invalidateQueries({ queryKey: ['reservations'] });
    },
  });

  const rows = list.data?.rows ?? [];
  const counts = list.data?.counts;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Client-side CSV of the rows on screen — what the user is looking at, not a second query. */
  function exportCsv() {
    const head = [
      'Reference',
      'Guest',
      'Status',
      'Source',
      'Arrival',
      'Departure',
      'Nights',
      'Rooms',
      'Room numbers',
      'Amount',
      'Currency',
      'Group',
    ];
    const body = rows.map((r) => [
      r.reference,
      r.guestName,
      r.status,
      r.channel ?? r.source,
      r.checkin,
      r.checkout,
      r.nights,
      r.rooms,
      r.roomCodes.join(' '),
      r.amount,
      r.currency,
      r.groupCode ?? '',
    ]);
    const csv = [head, ...body]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `reservations-${tab}-${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
            Front desk
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Reservations</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-40"
            aria-label="Business date"
          />
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, name, email or phone"
              className="w-64 pl-8"
              aria-label="Search reservations"
            />
          </div>
          <Button
            variant="secondary"
            size="icon"
            aria-label={view === 'list' ? 'Switch to cards' : 'Switch to list'}
            onClick={() => setView(view === 'list' ? 'cards' : 'list')}
          >
            {view === 'list' ? <LayoutList size={16} /> : <Table2 size={16} />}
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            <Download size={14} />
            Export
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReservationTab)}>
        <TabsList className="mb-4 overflow-x-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} count={counts?.[t.value]}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {selected.size > 0 && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
          <Users2 size={16} className="text-ink-2" />
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
            onClick={() => group.mutate()}
            disabled={selected.size < 2 || group.isPending}
          >
            {group.isPending ? 'Grouping…' : 'Make group'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {selected.size < 2 && (
            <span className="text-xs text-ink-3">Select at least two to group them.</span>
          )}
          {group.isError && (
            <span className="text-xs text-[var(--closed-ink)]">
              {(group.error as Error).message}
            </span>
          )}
        </Card>
      )}

      {list.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">
          {debounced ? 'Nothing matches that search.' : 'No reservations on this tab.'}
        </Card>
      ) : view === 'list' ? (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-10 px-3 py-3" />
                {['Reference', 'Guest', 'Stay', 'Rooms', 'Status', 'Amount', ''].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      aria-label={`Select ${r.reference}`}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono text-xs font-semibold text-ink">{r.reference}</span>
                    {r.groupCode && (
                      <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10px] text-ink-3">
                        G{r.groupCode}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5 text-ink">
                      {r.vip && <Crown size={12} className="text-[var(--low-ink)]" />}
                      {r.guestName}
                    </span>
                    <span className="text-xs text-ink-3">{r.channel ?? r.source}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                    {r.checkin} → {r.checkout}
                    <span className="ml-1 text-xs text-ink-3">({r.nights}n)</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs text-ink-2">
                    {r.roomCodes.length > 0 ? r.roomCodes.join(', ') : `${r.rooms} unassigned`}
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS_TONE[r.status] ?? 'muted'}>{r.status}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono tabular-nums text-ink">
                    {Number(r.amount).toFixed(2)}
                    {r.balanceDue && (
                      <span className="ml-1 text-xs text-[var(--closed-ink)]">due</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setCardFor(r.id)}
                      aria-label={`Registration card for ${r.reference}`}
                    >
                      <Printer size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <ReservationCard
              key={r.id}
              row={r}
              selected={selected.has(r.id)}
              onToggle={() => toggle(r.id)}
              onPrint={() => setCardFor(r.id)}
            />
          ))}
        </div>
      )}

      <Sheet open={cardFor !== null} onOpenChange={(o) => !o && setCardFor(null)}>
        <SheetContent title="Registration card" wide>
          {cardFor && <RegistrationCardSheet bookingId={cardFor} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ReservationCard({
  row,
  selected,
  onToggle,
  onPrint,
}: {
  row: ReservationRow;
  selected: boolean;
  onToggle: () => void;
  onPrint: () => void;
}) {
  return (
    <Card className={cn('p-3', selected && 'border-brand')}>
      <div className="mb-2 flex items-start gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${row.reference}`}
          className="mt-1"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {row.vip && <Crown size={12} className="shrink-0 text-[var(--low-ink)]" />}
            <span className="truncate font-semibold text-ink">{row.guestName}</span>
          </div>
          <div className="font-mono text-xs text-ink-3">{row.reference}</div>
        </div>
        <Badge tone={STATUS_TONE[row.status] ?? 'muted'}>{row.status}</Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <Row label="Arrival" value={row.checkin} />
        <Row label="Departure" value={row.checkout} />
        <Row
          label="Rooms"
          value={row.roomCodes.length > 0 ? row.roomCodes.join(', ') : `${row.rooms} unassigned`}
        />
        <Row label="Source" value={row.channel ?? row.source} />
      </dl>
      <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
        <span className="font-mono text-sm tabular-nums text-ink">
          {row.currency} {Number(row.amount).toFixed(2)}
        </span>
        <Button size="sm" variant="ghost" onClick={onPrint}>
          <Printer size={14} />
          GR card
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="truncate text-right text-ink-2">{value}</dd>
    </>
  );
}
