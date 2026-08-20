'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  BedDouble,
  Sparkles,
  Crown,
  LogIn,
  LogOut,
  ShieldCheck,
  Users,
  Wallet,
  Wrench,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CountedChips,
  Input,
  Sheet,
  SheetContent,
  Skeleton,
  Tooltip,
  cn,
  type Chip,
  type Tone,
} from '@yohobed/ui';
import {
  getRoomView,
  markDeparturesDirty,
  setHousekeeping,
  type HousekeepingState,
  type RoomCard,
  type RoomState,
} from '@/lib/api';
import { useProperties } from '@/lib/queries';

const STATE_LABEL: Record<RoomState, string> = {
  Vacant: 'Vacant',
  Occupied: 'Occupied',
  ArrivingToday: 'Arriving today',
  PendingCheckout: 'Pending checkout',
  OutOfOrder: 'Out of order',
};

const STATE_TONE: Record<RoomState, Tone> = {
  Vacant: 'avail',
  Occupied: 'brand',
  ArrivingToday: 'info',
  PendingCheckout: 'low',
  OutOfOrder: 'closed',
};

const HK_LABEL: Record<HousekeepingState, string> = {
  dirty: 'Dirty',
  clean: 'Clean',
  inspected: 'Inspected',
  out_of_order: 'Out of order',
};

const HK_TONE: Record<HousekeepingState, Tone> = {
  dirty: 'closed',
  clean: 'avail',
  inspected: 'brand',
  out_of_order: 'muted',
};

type Filter = 'all' | RoomState | 'dirty';

export default function RoomViewPage() {
  const qc = useQueryClient();
  const { data: properties } = useProperties();
  const propertyId = properties?.[0]?.id;

  const [date, setDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [filter, setFilter] = React.useState<Filter>('all');
  const [selected, setSelected] = React.useState<RoomCard | null>(null);

  const rooms = useQuery({
    queryKey: ['room-view', propertyId, date],
    queryFn: () => getRoomView(propertyId!, date),
    enabled: !!propertyId,
    placeholderData: (prev) => prev,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['room-view'] });
    qc.invalidateQueries({ queryKey: ['stayview'] });
  };

  const sweep = useMutation({
    mutationFn: () => markDeparturesDirty(propertyId!, date),
    onSuccess: refresh,
  });

  const cards = rooms.data ?? [];
  const count = (p: (c: RoomCard) => boolean) => cards.filter(p).length;

  const chips: Chip<Filter>[] = [
    { value: 'all', label: 'All', count: cards.length, tone: 'muted' },
    { value: 'Vacant', label: 'Vacant', count: count((c) => c.state === 'Vacant'), tone: 'avail' },
    {
      value: 'Occupied',
      label: 'Occupied',
      count: count((c) => c.state === 'Occupied'),
      tone: 'brand',
    },
    {
      value: 'ArrivingToday',
      label: 'Arriving',
      count: count((c) => c.state === 'ArrivingToday'),
      tone: 'info',
    },
    {
      value: 'PendingCheckout',
      label: 'Due out',
      count: count((c) => c.state === 'PendingCheckout'),
      tone: 'low',
    },
    {
      value: 'OutOfOrder',
      label: 'Out of order',
      count: count((c) => c.state === 'OutOfOrder'),
      tone: 'closed',
    },
    {
      value: 'dirty',
      label: 'Dirty',
      count: count((c) => c.housekeeping === 'dirty'),
      tone: 'low',
    },
  ];

  const visible = cards.filter((c) =>
    filter === 'all' ? true : filter === 'dirty' ? c.housekeeping === 'dirty' : c.state === filter,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
            Front desk
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Room view</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-40"
            aria-label="Business date"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => sweep.mutate()}
            disabled={sweep.isPending || !propertyId}
          >
            <Sparkles size={14} />
            {sweep.isPending ? 'Marking…' : 'Mark departures dirty'}
          </Button>
        </div>
      </div>

      {sweep.data && (
        <p className="mb-3 text-sm text-ink-2">
          Marked {sweep.data.marked} departed room{sweep.data.marked === 1 ? '' : 's'} as dirty.
        </p>
      )}

      <CountedChips
        chips={chips}
        value={filter}
        onChange={setFilter}
        loading={rooms.isLoading}
        aria-label="Room status"
        className="mb-4"
      />

      {rooms.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">
          No rooms set up yet. Add them under Configuration &rarr; Property setup.
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((c) => (
            <RoomTile key={c.unitId} card={c} onOpen={() => setSelected(c)} />
          ))}
        </div>
      )}

      <RoomSheet
        card={selected}
        propertyId={propertyId}
        date={date}
        onClose={() => setSelected(null)}
        onChanged={refresh}
      />
    </div>
  );
}

/** One room card — Yanolja's badge set, so the whole floor reads at a glance. */
function RoomTile({ card, onOpen }: { card: RoomCard; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex flex-col gap-2 rounded-xl border bg-surface p-3 text-left transition',
        'hover:border-ink-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
        card.state === 'OutOfOrder' ? 'border-[var(--closed-ink)]/40' : 'border-line',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-ink">{card.code}</span>
        {card.vip && (
          <Tooltip label="VIP guest">
            <Crown size={14} className="text-[var(--low-ink)]" />
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {card.balanceDue && (
            <Tooltip label="Payment pending">
              <Wallet size={14} className="text-[var(--closed-ink)]" />
            </Tooltip>
          )}
          {card.openWorkOrders > 0 && (
            <Tooltip label={`${card.openWorkOrders} open work order(s)`}>
              <span className="flex items-center gap-0.5 text-[var(--low-ink)]">
                <Wrench size={13} />
                <span className="text-[11px] font-semibold">{card.openWorkOrders}</span>
              </span>
            </Tooltip>
          )}
          {card.state === 'ArrivingToday' && (
            <Tooltip label="Arriving today">
              <LogIn size={14} className="text-[var(--info)]" />
            </Tooltip>
          )}
          {card.state === 'PendingCheckout' && (
            <Tooltip label="Due out">
              <LogOut size={14} className="text-[var(--low-ink)]" />
            </Tooltip>
          )}
          {card.unitStatus === 'inactive' && (
            <Tooltip label="Room disabled">
              <Ban size={14} className="text-[var(--closed-ink)]" />
            </Tooltip>
          )}
        </div>
      </div>

      <div className="truncate text-xs text-ink-3">{card.roomName}</div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={STATE_TONE[card.state]}>{STATE_LABEL[card.state]}</Badge>
        <Badge tone={HK_TONE[card.housekeeping]} dot={false}>
          {card.housekeeping === 'inspected' ? <ShieldCheck size={11} /> : <BedDouble size={11} />}
          {HK_LABEL[card.housekeeping]}
        </Badge>
      </div>

      <div className="mt-auto min-h-[1.25rem] truncate text-sm text-ink-2">
        {card.guestName ? (
          <span className="flex items-center gap-1.5">
            {card.guestName}
            {card.adults != null && (
              <span className="flex items-center gap-0.5 text-xs text-ink-3">
                <Users size={11} />
                {card.adults + (card.children ?? 0)}
              </span>
            )}
          </span>
        ) : card.blockReason ? (
          <span className="text-xs text-[var(--closed-ink)]">{card.blockReason}</span>
        ) : (
          <span className="text-xs text-ink-3">&mdash;</span>
        )}
      </div>
    </button>
  );
}

/** Room detail: set housekeeping, read the stay, leave a remark. */
function RoomSheet({
  card,
  propertyId,
  date,
  onClose,
  onChanged,
}: {
  card: RoomCard | null;
  propertyId?: string;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [remarks, setRemarks] = React.useState('');

  React.useEffect(() => {
    setRemarks(card?.remarks ?? '');
  }, [card]);

  const set = useMutation({
    mutationFn: (status: HousekeepingState) =>
      setHousekeeping(propertyId!, {
        roomUnitId: card!.unitId,
        date,
        status,
        remarks: remarks.trim() || undefined,
      }),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  return (
    <Sheet open={card !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={card ? `Room ${card.code}` : 'Room'}
        description={card?.roomName ?? undefined}
      >
        {!card ? null : (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <Badge tone={STATE_TONE[card.state]}>{STATE_LABEL[card.state]}</Badge>
              <Badge tone={HK_TONE[card.housekeeping]}>{HK_LABEL[card.housekeeping]}</Badge>
              {card.vip && <Badge tone="low">VIP</Badge>}
              {card.balanceDue && <Badge tone="closed">Payment pending</Badge>}
            </div>

            {card.guestName && (
              <div className="grid grid-cols-2 gap-4 rounded-lg border border-line p-3">
                <Info label="Guest" value={card.guestName} />
                <Info label="Reservation" value={card.reference ?? '—'} />
                <Info label="Arrival" value={card.checkin ?? '—'} />
                <Info label="Departure" value={card.checkout ?? '—'} />
              </div>
            )}

            {card.blockReason && (
              <p className="rounded-lg bg-[var(--closed-soft)] px-3 py-2 text-sm text-[var(--closed-ink)]">
                Blocked: {card.blockReason}
              </p>
            )}

            <div>
              <h3 className="mb-2 text-sm font-bold text-ink">Housekeeping</h3>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Remarks for the attendant (optional)"
                rows={2}
                className="mb-2 w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              />
              <div className="flex flex-wrap gap-2">
                {(['dirty', 'clean', 'inspected', 'out_of_order'] as const).map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={card.housekeeping === s ? 'primary' : 'secondary'}
                    onClick={() => set.mutate(s)}
                    disabled={set.isPending}
                  >
                    {HK_LABEL[s]}
                  </Button>
                ))}
              </div>
              {set.isError && (
                <p className="mt-2 text-sm text-[var(--closed-ink)]">
                  {(set.error as Error).message}
                </p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
