'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bed,
  Crown,
  Prohibit,
  ShieldCheck,
  SignIn,
  SignOut,
  Sparkle,
  Users,
  Wallet,
  Wrench,
  Cigarette,
  Wheelchair,
  BellSlash,
  ForkKnife,
  Lightning,
  LinkSimple,
  MapPin,
} from '@phosphor-icons/react';
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
  toast,
  cn,
  type Chip,
  type Tone,
} from '@yohobed/ui';
import {
  getRoomView,
  listFloorLayouts,
  saveFloorLayout,
  listCleaningTasks,
  updateCleaningTask,
  setRoomSignals,
  markDeparturesDirty,
  setHousekeeping,
  subscribeRoomUpdates,
  bookingTransition,
  voidBooking,
  getBookingLegs,
  assignRooms,
  listRoomUnits,
  listRoomMoves,
  moveRoom,
  exchangeRooms,
  stopRoomMove,
  listInvoices,
  previewVoucher,
  sendVoucher,
  sendInvoice,
  fetchDocumentPdf,
  listTeamMembers,
  listRooms,
  createRoomUnit,
  updateRoomUnit,
  type HousekeepingState,
  type RoomCard,
  type RoomState,
  type FloorLayout,
  type CleaningTask,
} from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { useReservationComposer } from '@/components/reservations/composer/composer-context';
import { todayISO } from '@/lib/format';
import { useTenantRole } from '@/lib/queries';
import Link from 'next/link';

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
  const { propertyId } = useActiveProperty();
  const role = useTenantRole();

  const [date, setDate] = React.useState(() => todayISO());
  const [filter, setFilter] = React.useState<Filter>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'rooms' | 'floor'>('rooms');
  const [floor, setFloor] = React.useState('all');
  const [density, setDensity] = React.useState<'comfortable' | 'compact'>('comfortable');
  const [maintenanceOverlay, setMaintenanceOverlay] = React.useState(false);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const previousRects = React.useRef(new Map<string, DOMRect>());

  const rooms = useQuery({
    queryKey: ['room-view', propertyId, date],
    queryFn: () => getRoomView(propertyId!, date),
    enabled: !!propertyId,
    placeholderData: (prev) => prev,
    refetchInterval: 20_000,
  });
  const layouts = useQuery({ queryKey: ['floor-layouts', propertyId], queryFn: () => listFloorLayouts(propertyId!), enabled: !!propertyId });
  const tasks = useQuery({ queryKey: ['cleaning-tasks', propertyId, date], queryFn: () => listCleaningTasks(propertyId!, date), enabled: !!propertyId, refetchInterval: 20_000 });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['room-view'] });
    qc.invalidateQueries({ queryKey: ['stayview'] });
    qc.invalidateQueries({ queryKey: ['cleaning-tasks'] });
  };

  React.useEffect(() => {
    if (!propertyId) return;
    const stream = subscribeRoomUpdates(propertyId, date, refresh);
    return () => stream.abort();
  }, [propertyId, date]);

  const sweep = useMutation({
    mutationFn: () => markDeparturesDirty(propertyId!, date),
    onSuccess: refresh,
  });

  const cards = rooms.data ?? [];
  const selected = cards.find(c => c.unitId === selectedId) ?? null;
  const floors = Array.from(new Set(cards.map(c => c.floor ?? 'Unassigned'))).sort();
  const displayedFloor = floor === 'all' ? (floors[0] ?? 'Unassigned') : floor;
  const canEditLayout = role === 'OWNER' || role === 'HOUSEKEEPING_SUPERVISOR';
  const rememberRects = () => {
    previousRects.current = new Map(Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-room-id]') ?? [])
      .map(el => [el.dataset.roomId!, el.getBoundingClientRect()]));
  };
  React.useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-room-id]') ?? [])) {
      const before = previousRects.current.get(el.dataset.roomId!);
      if (!before) continue;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left, dy = before.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) < 2) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(.97)`, opacity: .75 }, { transform: 'translate(0, 0) scale(1)', opacity: 1 }],
        { duration: 500, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
    previousRects.current.clear();
  }, [view, floor, filter, density]);
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
    (view !== 'floor' || (c.floor ?? 'Unassigned') === displayedFloor) &&
    (floor === 'all' || (c.floor ?? 'Unassigned') === floor) &&
    (filter === 'all' ? true : filter === 'dirty' ? c.housekeeping === 'dirty' : c.state === filter),
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ink-3">
            Front desk
          </div>
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold tracking-tight text-ink">Rooms</h1>
            <div role="tablist" aria-label="Room presentation" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
              {(['floor', 'rooms'] as const).map(mode => (
                <button key={mode} type="button" role="tab" aria-selected={view === mode}
                  onClick={() => { rememberRects(); if (mode === 'floor' && floor === 'all') setFloor(floors[0] ?? 'Unassigned'); setView(mode); }}
                  className={cn('rounded-md px-3 py-1 text-sm capitalize transition-colors', view === mode ? 'bg-surface font-semibold text-ink shadow-sm' : 'text-ink-3')}>
                  {mode === 'floor' ? 'Floor' : 'Rooms'}
                </button>
              ))}
            </div>
          </div>
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
            <Sparkle size={14} />
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
        onChange={(next) => { rememberRects(); setFilter(next); }}
        loading={rooms.isLoading}
        aria-label="Room status"
        className="mb-4"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold text-ink-3" htmlFor="room-floor">Floor</label>
        <select id="room-floor" value={floor} onChange={e => { rememberRects(); setFloor(e.target.value); }}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink">
          {view === 'rooms' && <option value="all">All floors</option>}
          {floors.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {view === 'rooms' && <div role="group" aria-label="Card density" className="ml-2 flex rounded-lg border border-line p-0.5">
          {(['comfortable', 'compact'] as const).map(d => <button key={d} type="button" aria-pressed={density === d}
            onClick={() => { rememberRects(); setDensity(d); }} className={cn('rounded-md px-2 py-1 text-xs capitalize', density === d && 'bg-surface-2 font-semibold')}>{d}</button>)}
        </div>}
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={maintenanceOverlay} onChange={e => setMaintenanceOverlay(e.target.checked)} /> Maintenance overlay
        </label>
      </div>

      {role === 'OWNER' && propertyId && <RoomConfiguration propertyId={propertyId} onChanged={refresh} />}

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
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div ref={gridRef}>
            {view === 'floor' ? (
              <FloorCanvas cards={visible} floor={displayedFloor} layout={layouts.data?.find(l => l.floor === displayedFloor)}
                propertyId={propertyId} canEdit={canEditLayout} onSaved={() => { qc.invalidateQueries({ queryKey: ['floor-layouts'] }); refresh(); }}
                onOpen={id => setSelectedId(id)} maintenanceOverlay={maintenanceOverlay} />
            ) : (
              <div className={cn('grid gap-3', density === 'compact' ? 'grid-cols-2 md:grid-cols-4 2xl:grid-cols-6' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4')}>
                {visible.map(c => <RoomTile key={c.unitId} card={c} compact={density === 'compact'} maintenanceOverlay={maintenanceOverlay} onOpen={() => setSelectedId(c.unitId)} />)}
              </div>
            )}
          </div>
          <PriorityQueue tasks={tasks.data ?? []} canManage={canEditLayout} onJump={id => {
            const target = cards.find(c => c.unitId === id);
            if (!target) return;
            setFloor(target.floor ?? 'Unassigned');
            setFilter('all');
            window.setTimeout(() => {
              const el = document.querySelector<HTMLElement>(`[data-room-id="${id}"]`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el?.animate([{ outline: '3px solid var(--brand)' }, { outline: '3px solid transparent' }], { duration: 1400 });
            }, 80);
          }} onChanged={refresh} />
        </div>
      )}

      <RoomSheet
        card={selected}
        cards={cards}
        propertyId={propertyId}
        date={date}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
      />
    </div>
  );
}

/** One room card — Yanolja's badge set, so the whole floor reads at a glance. */
function RoomTile({ card, onOpen, compact = false, maintenanceOverlay = false }: { card: RoomCard; onOpen: () => void; compact?: boolean; maintenanceOverlay?: boolean }) {
  return (
    <button
      type="button"
      data-room-id={card.unitId}
      onClick={onOpen}
      className={cn(
        'relative flex min-h-36 flex-col gap-2 rounded-xl border border-l-[3px] bg-surface p-3 text-left shadow-sm transition duration-200',
        'hover:-translate-y-0.5 hover:border-ink-3 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
        card.state === 'OutOfOrder' ? 'border-closed' : card.state === 'Occupied' ? 'border-l-brand' : card.state === 'ArrivingToday' ? 'border-l-info' : 'border-l-avail',
        card.cleaningTask?.rush && 'ring-2 ring-low',
        maintenanceOverlay && card.openWorkOrders === 0 && !card.blockReason && 'opacity-45',
        compact && 'min-h-28 gap-1',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-ink">{card.code}</span>
        {card.vip && (
          <Tooltip label="VIP guest">
            <Crown size={14} className="text-low-ink" />
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {card.balanceDue && (
            <Tooltip label="Payment pending">
              <Wallet size={14} className="text-closed-ink" />
            </Tooltip>
          )}
          {card.openWorkOrders > 0 && (
            <Tooltip label={`${card.openWorkOrders} open work order(s)`}>
              <span className="flex items-center gap-0.5 text-low-ink">
                <Wrench size={13} />
                <span className="text-[11px] font-semibold">{card.openWorkOrders}</span>
              </span>
            </Tooltip>
          )}
          {card.state === 'ArrivingToday' && (
            <Tooltip label="Arriving today">
              <SignIn size={14} className="text-info" />
            </Tooltip>
          )}
          {card.state === 'PendingCheckout' && (
            <Tooltip label="Due out">
              <SignOut size={14} className="text-low-ink" />
            </Tooltip>
          )}
          {card.unitStatus === 'inactive' && (
            <Tooltip label="Room disabled">
              <Prohibit size={14} className="text-closed-ink" />
            </Tooltip>
          )}
          {card.smokingPolicy !== 'unspecified' && <Tooltip label={card.smokingPolicy === 'smoking' ? 'Smoking room' : 'No smoking'}><Cigarette size={14} className="text-ink-3" /></Tooltip>}
          {card.wheelchairAccessible && <Tooltip label="Wheelchair accessible"><Wheelchair size={14} className="text-info" /></Tooltip>}
          {card.connectedRoomUnitId && <Tooltip label="Connected room"><LinkSimple size={14} className="text-ink-3" /></Tooltip>}
          {card.doNotDisturb && <Tooltip label="Do not disturb"><BellSlash size={14} className="text-low-ink" /></Tooltip>}
          {card.groupBooking && <Tooltip label="Group booking"><Users size={14} className="text-ink-3" /></Tooltip>}
          {card.mealPlan && <Tooltip label={`Meal plan ${card.mealPlan}`}><ForkKnife size={14} className="text-ink-3" /></Tooltip>}
          {card.cleaningTask?.rush && <Tooltip label="Rush clean"><Lightning size={14} className="text-low-ink" /></Tooltip>}
          {card.requestedSafetyFlag && <Tooltip label="Guest-requested safety preference"><ShieldCheck size={14} className="text-low-ink" /></Tooltip>}
        </div>
      </div>

      <div className="truncate text-xs text-ink-3">{card.roomName}</div>

      <div className="flex flex-wrap gap-1.5">
        <Badge tone={STATE_TONE[card.state]}>{STATE_LABEL[card.state]}</Badge>
        <Badge tone={HK_TONE[card.housekeeping]} dot={false}>
          {card.housekeeping === 'inspected' ? <ShieldCheck size={11} /> : <Bed size={11} />}
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
          <span className="text-xs text-closed-ink">{card.blockReason}</span>
        ) : (
          <span className="text-xs text-ink-3">&mdash;</span>
        )}
      </div>
      {!compact && card.nextReservation && <p className="text-xs text-ink-3">Next: {card.nextReservation.checkin} · {card.nextReservation.guestName}</p>}
      {card.cleaningTask?.status === 'in_progress' && <span className="text-xs font-medium text-info">Cleaning in progress</span>}
    </button>
  );
}

function FloorCanvas({ cards, floor, layout, propertyId, canEdit, onSaved, onOpen, maintenanceOverlay }: {
  cards: RoomCard[]; floor: string; layout?: FloorLayout; propertyId?: string; canEdit: boolean;
  onSaved: () => void; onOpen: (id: string) => void; maintenanceOverlay: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({});
  const [landmarks, setLandmarks] = React.useState<FloorLayout['landmarks']>([]);
  const [landmarkKind, setLandmarkKind] = React.useState<FloorLayout['landmarks'][number]['kind']>('lift');
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const columns = 4;
  const rows = Math.max(2, Math.ceil(cards.length / columns));
  const canvasHeight = Math.max(460, rows * 170 + 100);
  const auto = (i: number) => ({ x: 25 + (i % columns) * 240, y: 30 + Math.floor(i / columns) * (800 / rows) });
  React.useEffect(() => {
    setPositions(Object.fromEntries(cards.map((c, i) => [c.unitId, c.mapX != null && c.mapY != null ? { x: c.mapX, y: c.mapY } : auto(i)])));
    setLandmarks(layout?.landmarks ?? []);
    setEditing(false);
  }, [floor, layout?.version, cards.map(c => `${c.unitId}:${c.mapX}:${c.mapY}`).join('|')]);
  const save = useMutation({
    mutationFn: () => saveFloorLayout(propertyId!, { floor, expectedVersion: layout?.version ?? null,
      rooms: cards.map(c => ({ unitId: c.unitId, ...(positions[c.unitId] ?? auto(cards.indexOf(c))) })), landmarks }),
    onSuccess: () => { setEditing(false); onSaved(); toast.success('Floor layout saved'); },
    onError: e => toast.error((e as Error).message),
  });
  return <div className="rounded-2xl border border-line bg-surface-2 p-3 sm:p-5">
    <div className="mb-3 flex items-center gap-2">
      <MapPin size={18} className="text-brand" /><h2 className="font-semibold text-ink">{floor}</h2>
      <span className="text-xs text-ink-3">{cards.length} rooms</span>
      {canEdit && <div className="ml-auto flex gap-2">
        {editing ? <><Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save layout</Button></>
          : <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Arrange</Button>}
      </div>}
    </div>
    {editing && <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
      Drag rooms to position them. <select aria-label="Landmark type" value={landmarkKind} onChange={e => setLandmarkKind(e.target.value as typeof landmarkKind)} className="rounded border border-line bg-surface p-1">
        {(['lift','stairs','service','corridor'] as const).map(k => <option key={k} value={k}>{k}</option>)}
      </select>
      <Button size="sm" variant="secondary" onClick={() => setLandmarks([...landmarks, { id: crypto.randomUUID(), kind: landmarkKind, x: 500, y: 500 }])}>Add landmark</Button>
      <Button size="sm" variant="secondary" onClick={() => setPositions(Object.fromEntries(cards.map((c,i) => [c.unitId, auto(i)])))}>Auto arrange</Button>
    </div>}
    <div ref={canvasRef} className="relative overflow-hidden rounded-xl border border-line bg-surface" style={{ height: canvasHeight }}>
      <div aria-hidden className="absolute left-3 right-3 top-1/2 border-t border-dashed border-line-strong text-center text-[10px] uppercase tracking-widest text-ink-3">Corridor</div>
      {landmarks.map(l => <div key={l.id} className="absolute z-10 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2"
        style={{ left: `${l.x / 10}%`, top: `${l.y / 10}%` }}>
        {l.label ?? l.kind}{editing && <button type="button" aria-label={`Remove ${l.kind}`} className="ml-2" onClick={() => setLandmarks(landmarks.filter(x => x.id !== l.id))}>×</button>}
      </div>)}
      {cards.map((c,i) => {
        const p = positions[c.unitId] ?? auto(i);
        return <div key={c.unitId} className={cn('absolute z-20 w-36 touch-none sm:w-40', editing && 'cursor-move')}
          style={{ left: `min(${p.x / 10}%, calc(100% - 10rem))`, top: `${p.y / 10}%` }}
          onPointerDown={editing ? e => e.currentTarget.setPointerCapture(e.pointerId) : undefined}
          onPointerMove={editing ? e => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
            setPositions(prev => ({ ...prev, [c.unitId]: { x: Math.max(0, Math.min(900, Math.round((e.clientX - rect.left) / rect.width * 1000))), y: Math.max(0, Math.min(900, Math.round((e.clientY - rect.top) / rect.height * 1000))) } }));
          } : undefined}>
          <RoomTile card={c} compact maintenanceOverlay={maintenanceOverlay} onOpen={() => { if (!editing) onOpen(c.unitId); }} />
        </div>;
      })}
    </div>
  </div>;
}

function RoomConfiguration({ propertyId, onChanged }: { propertyId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const units = useQuery({ queryKey: ['room-units', propertyId], queryFn: () => listRoomUnits(propertyId) });
  const roomTypes = useQuery({ queryKey: ['rooms'], queryFn: listRooms });
  const [form, setForm] = React.useState({ roomId: '', code: '', floor: '', smokingPolicy: 'unspecified' as 'unspecified' | 'smoking' | 'non_smoking', wheelchairAccessible: false });
  const options = (roomTypes.data ?? []).filter(room => room.propertyId === propertyId);
  React.useEffect(() => {
    if (!form.roomId && options[0]) setForm(current => ({ ...current, roomId: options[0]!.id }));
  }, [form.roomId, options]);
  const refresh = () => { void units.refetch(); void qc.invalidateQueries({ queryKey: ['room-view'] }); onChanged(); };
  const create = useMutation({
    mutationFn: () => createRoomUnit(propertyId, { ...form, floor: form.floor.trim() || undefined }),
    onSuccess: () => { setForm(current => ({ ...current, code: '' })); refresh(); toast.success('Physical room added'); },
    onError: error => toast.error((error as Error).message),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateRoomUnit>[1] }) => updateRoomUnit(id, body),
    onSuccess: () => { refresh(); toast.success('Room configuration updated'); },
    onError: error => toast.error((error as Error).message),
  });
  return <details className="mb-4 rounded-xl border border-line bg-surface">
    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">Configure physical rooms</summary>
    <div className="border-t border-line p-4">
      <div className="grid gap-2 lg:grid-cols-[1fr_8rem_8rem_10rem_auto_auto]">
        <select aria-label="Room type" value={form.roomId} onChange={e => setForm({ ...form, roomId: e.target.value })} className="rounded-lg border border-line bg-surface px-2 py-2 text-sm">
          <option value="">Choose room type</option>{options.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select>
        <Input aria-label="Room code" placeholder="Room 101" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} />
        <Input aria-label="Floor" placeholder="Floor" value={form.floor} onChange={e => setForm({ ...form, floor: e.target.value })} />
        <select aria-label="Smoking policy" value={form.smokingPolicy} onChange={e => setForm({ ...form, smokingPolicy: e.target.value as typeof form.smokingPolicy })} className="rounded-lg border border-line bg-surface px-2 py-2 text-sm">
          <option value="unspecified">Smoking unspecified</option><option value="non_smoking">Non smoking</option><option value="smoking">Smoking</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={form.wheelchairAccessible} onChange={e => setForm({ ...form, wheelchairAccessible: e.target.checked })} /> Accessible</label>
        <Button size="sm" disabled={!form.roomId || !form.code.trim() || create.isPending} onClick={() => create.mutate()}>Add room</Button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{(units.data ?? []).map(unit => <div key={unit.id} className="rounded-lg border border-line p-2 text-xs">
        <div className="mb-2 flex items-center gap-2"><strong className="text-ink">{unit.code}</strong><span className="text-ink-3">{unit.roomName} · {unit.floor ?? 'No floor'}</span></div>
        <div className="grid grid-cols-2 gap-2">
          <select aria-label={`Smoking policy for ${unit.code}`} value={unit.smokingPolicy} onChange={e => update.mutate({ id: unit.id, body: { smokingPolicy: e.target.value as typeof unit.smokingPolicy } })} className="rounded border border-line bg-surface px-1 py-1.5">
            <option value="unspecified">Unspecified</option><option value="non_smoking">Non smoking</option><option value="smoking">Smoking</option>
          </select>
          <select aria-label={`Connected room for ${unit.code}`} value={unit.connectedRoomUnitId ?? ''} onChange={e => update.mutate({ id: unit.id, body: { connectedRoomUnitId: e.target.value || null } })} className="rounded border border-line bg-surface px-1 py-1.5">
            <option value="">No connected room</option>{(units.data ?? []).filter(other => other.id !== unit.id).map(other => <option key={other.id} value={other.id}>{other.code}</option>)}
          </select>
        </div>
        <label className="mt-2 flex items-center gap-2 text-ink-2"><input type="checkbox" checked={unit.wheelchairAccessible} onChange={e => update.mutate({ id: unit.id, body: { wheelchairAccessible: e.target.checked } })} /> Wheelchair accessible</label>
      </div>)}</div>
    </div>
  </details>;
}

function PriorityQueue({ tasks, canManage, onJump, onChanged }: { tasks: CleaningTask[]; canManage: boolean; onJump: (id: string) => void; onChanged: () => void }) {
  const team = useQuery({ queryKey: ['team-members'], queryFn: listTeamMembers, enabled: canManage });
  const housekeepers = (team.data ?? []).filter(member => member.status !== 'disabled' && (member.role === 'HOUSEKEEPING_ATTENDANT' || member.role === 'HOUSEKEEPING_SUPERVISOR'));
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: { status?: string; rush?: boolean; assignedToUserId?: string | null } }) => updateCleaningTask(id, body),
    onSuccess: onChanged, onError: e => toast.error((e as Error).message) });
  const open = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  return <aside className="rounded-xl border border-line bg-surface p-3 xl:sticky xl:top-4 xl:self-start" aria-label="Priority cleaning queue">
    <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-ink">Cleaning queue</h2><Badge tone="low">{open.length}</Badge></div>
    {open.length === 0 ? <p className="text-xs text-ink-3">No cleaning tasks for this date.</p> : <ul className="space-y-2">
      {open.map(task => <li key={task.id} className="rounded-lg border border-line p-2 text-xs">
        <button type="button" className="font-semibold text-ink hover:underline" onClick={() => onJump(task.roomUnitId)}>Room {task.code}</button>
        {task.rush && <span className="ml-2 font-semibold text-low-ink">Rush</span>}
        {canManage && <select aria-label={`Assign room ${task.code}`} value={task.assignedToUserId ?? ''}
          onChange={e => update.mutate({ id: task.id, body: { assignedToUserId: e.target.value || null } })}
          className="mt-2 w-full rounded border border-line bg-surface px-1.5 py-1 text-xs">
          <option value="">Unassigned</option>{housekeepers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>}
        <p className="mt-1 text-ink-3">{task.kind.replace('_', ' ')} · {task.status.replace('_', ' ')}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {task.status === 'queued' && <button type="button" onClick={() => update.mutate({ id: task.id, body: { status: 'in_progress' } })} className="rounded bg-info-soft px-2 py-1 text-info-ink">Start</button>}
          <button type="button" onClick={() => update.mutate({ id: task.id, body: { status: 'done' } })} className="rounded bg-avail-soft px-2 py-1 text-avail-ink">Clean</button>
          {canManage && <button type="button" onClick={() => update.mutate({ id: task.id, body: { rush: !task.rush } })} className="rounded bg-low-soft px-2 py-1 text-low-ink">{task.rush ? 'Unrush' : 'Rush'}</button>}
        </div>
      </li>)}
    </ul>}
  </aside>;
}

/** Room detail: set housekeeping, read the stay, leave a remark. */
function RoomSheet({
  card,
  cards,
  propertyId,
  date,
  onClose,
  onChanged,
}: {
  card: RoomCard | null;
  cards: RoomCard[];
  propertyId?: string;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [remarks, setRemarks] = React.useState('');
  const { openComposer } = useReservationComposer();
  const role = useTenantRole();
  const housekeepingStates: HousekeepingState[] = role === 'HOUSEKEEPING_ATTENDANT'
    ? ['clean']
    : role === 'OWNER' || role === 'HOUSEKEEPING_SUPERVISOR'
      ? ['dirty', 'clean', 'inspected', 'out_of_order']
      : ['dirty', 'clean', 'out_of_order'];

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

            {card.bookingId && (role === 'OWNER' || role === 'OWNER_STAFF') && (
              <ReservationActions card={card} cards={cards} propertyId={propertyId} onChanged={onChanged} />
            )}

            {card.state === 'Vacant' && card.unitStatus === 'active' && (
              <Button
                onClick={() => {
                  onClose();
                  openComposer({ checkin: date, roomId: card.roomId, roomUnitId: card.unitId });
                }}
              >
                New reservation in room {card.code}
              </Button>
            )}

            {card.blockReason && (
              <p className="rounded-lg bg-closed-soft px-3 py-2 text-sm text-closed-ink">
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
                {housekeepingStates.map((s) => (
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
                <p className="mt-2 text-sm text-closed-ink">{(set.error as Error).message}</p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReservationActions({ card, cards, propertyId, onChanged }: {
  card: RoomCard;
  cards: RoomCard[];
  propertyId?: string;
  onChanged: () => void;
}) {
  const role = useTenantRole();
  const bookingId = card.bookingId!;
  const [destination, setDestination] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [exchangeLeg, setExchangeLeg] = React.useState('');
  const [recipient, setRecipient] = React.useState(card.guestEmail ?? '');

  React.useEffect(() => {
    setRecipient(card.guestEmail ?? '');
    setDestination('');
    setEffectiveDate('');
    setExchangeLeg('');
  }, [bookingId, card.guestEmail]);

  const legs = useQuery({ queryKey: ['booking-legs', bookingId], queryFn: () => getBookingLegs(bookingId) });
  const units = useQuery({ queryKey: ['room-units', propertyId], queryFn: () => listRoomUnits(propertyId!), enabled: !!propertyId });
  const moves = useQuery({ queryKey: ['room-moves', bookingId], queryFn: () => listRoomMoves(bookingId) });
  const invoices = useQuery({ queryKey: ['invoices', bookingId], queryFn: () => listInvoices({ bookingId }) });
  const voucher = useQuery({ queryKey: ['voucher-preview', bookingId], queryFn: () => previewVoucher(bookingId) });

  const refresh = () => {
    onChanged();
    void legs.refetch();
    void moves.refetch();
    void invoices.refetch();
  };
  const roomList = (legs.data ?? []).filter(l => !l.releasedAt).map(l => l.code ?? 'Unassigned').join(', ');
  const confirmReservation = (label: string) => window.confirm(`${label} reservation ${card.reference ?? ''}?\nAffected rooms: ${roomList || card.code}`);

  const workflow = useMutation({
    mutationFn: async (action: 'approve' | 'cancel' | 'no-show' | 'check-in' | 'check-out' | 'void' | 'unassign') => {
      if (!confirmReservation(action === 'void' ? 'Void' : action.replace('-', ' '))) throw new Error('cancelled');
      if (action === 'void') return voidBooking(bookingId);
      if (action === 'unassign') {
        if (!card.legId) throw new Error('No active room assignment');
        return assignRooms(bookingId, [{ legId: card.legId, roomUnitId: null }]);
      }
      return bookingTransition(bookingId, action);
    },
    onSuccess: () => { toast.success('Reservation updated'); refresh(); },
    onError: e => { if ((e as Error).message !== 'cancelled') toast.error((e as Error).message); },
  });
  const moveMutation = useMutation({
    mutationFn: () => moveRoom(bookingId, { legId: card.legId!, toRoomUnitId: destination, ...(effectiveDate ? { effectiveDate } : {}) }),
    onSuccess: () => { toast.success(effectiveDate ? 'Room move planned' : 'Room moved'); refresh(); setDestination(''); },
    onError: e => toast.error((e as Error).message),
  });
  const exchangeMutation = useMutation({
    mutationFn: () => exchangeRooms(card.legId!, exchangeLeg),
    onSuccess: () => { toast.success('Rooms exchanged'); refresh(); setExchangeLeg(''); },
    onError: e => toast.error((e as Error).message),
  });
  const stopMutation = useMutation({ mutationFn: stopRoomMove, onSuccess: () => { toast.success('Planned move stopped'); refresh(); }, onError: e => toast.error((e as Error).message) });
  const signalMutation = useMutation({
    mutationFn: (body: { doNotDisturb?: boolean; requestedSafetyFlag?: boolean }) => setRoomSignals(bookingId, body),
    onSuccess: refresh,
    onError: e => toast.error((e as Error).message),
  });
  const mail = useMutation({
    mutationFn: ({ kind, invoiceId }: { kind: 'voucher' | 'invoice'; invoiceId?: string }) => {
      const emails = recipient.split(',').map(x => x.trim()).filter(Boolean);
      if (!emails.length) throw new Error('Enter at least one recipient');
      return kind === 'voucher' ? sendVoucher(bookingId, emails) : sendInvoice(invoiceId!, emails);
    },
    onSuccess: () => toast.success('Document queued for delivery'),
    onError: e => toast.error((e as Error).message),
  });
  const print = async (kind: 'voucher' | 'invoice', id: string) => {
    try {
      const blob = await fetchDocumentPdf(kind, id);
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) toast.error('Allow pop-ups to open the PDF');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { toast.error((error as Error).message); }
  };

  const availableUnits = (units.data ?? []).filter(u => u.roomId === card.roomId && u.id !== card.unitId && u.status === 'active');
  const exchangeCandidates = cards.filter(c => c.roomId === card.roomId && c.legId && c.legId !== card.legId && c.bookingId);
  const issuedInvoices = (invoices.data ?? []).filter(i => i.status === 'issued' || i.status === 'paid');

  return <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-3">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-bold text-ink">Reservation actions</h3>
      <Link href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}`} className="text-xs font-semibold text-brand hover:underline">Open full reservation</Link>
    </div>

    <div className="flex flex-wrap gap-2">
      {card.bookingStatus === 'Pending' && <Button size="sm" onClick={() => workflow.mutate('approve')}>Approve</Button>}
      {card.bookingStatus === 'Approved' && <Button size="sm" onClick={() => workflow.mutate('check-in')}>Check in</Button>}
      {card.bookingStatus === 'CheckedIn' && <Button size="sm" onClick={() => workflow.mutate('check-out')}>Check out</Button>}
      {(card.bookingStatus === 'Pending' || card.bookingStatus === 'Approved') && <>
        <Button size="sm" variant="secondary" onClick={() => workflow.mutate('cancel')}>Cancel</Button>
        <Button size="sm" variant="secondary" onClick={() => workflow.mutate('unassign')}>Unassign</Button>
      </>}
      {card.bookingStatus === 'Approved' && <Button size="sm" variant="secondary" onClick={() => workflow.mutate('no-show')}>No show</Button>}
      {role === 'OWNER' && (card.bookingStatus === 'Pending' || card.bookingStatus === 'Approved') &&
        <Button size="sm" variant="secondary" onClick={() => workflow.mutate('void')}>Void</Button>}
      <Link href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}&section=folio`} className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface">Payment / folio</Link>
      <Link href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}&section=stay`} className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface">Amend stay / inclusions</Link>
    </div>

    <div className="grid gap-2 sm:grid-cols-2">
      <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={card.doNotDisturb}
        onChange={e => signalMutation.mutate({ doNotDisturb: e.target.checked })} /> Do not disturb</label>
      {(role === 'OWNER' || role === 'OWNER_STAFF') && <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={card.requestedSafetyFlag}
        onChange={e => signalMutation.mutate({ requestedSafetyFlag: e.target.checked })} /> Guest requested safety flag</label>}
    </div>

    {card.legId && <details className="rounded-lg border border-line bg-surface p-2">
      <summary className="cursor-pointer text-sm font-semibold text-ink">Move or exchange room</summary>
      <div className="mt-3 space-y-2">
        <select aria-label="Move to room" value={destination} onChange={e => setDestination(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm">
          <option value="">Choose destination</option>{availableUnits.map(u => <option key={u.id} value={u.id}>{u.code} · {u.roomName}</option>)}
        </select>
        <Input type="date" value={effectiveDate} min={dateISO()} onChange={e => setEffectiveDate(e.target.value)} aria-label="Move date" />
        <Button size="sm" disabled={!destination || moveMutation.isPending} onClick={() => {
          if (window.confirm(`Move ${card.reference} from room ${card.code} to ${availableUnits.find(u => u.id === destination)?.code}?`)) moveMutation.mutate();
        }}>{effectiveDate ? 'Plan move' : 'Move now'}</Button>
        <select aria-label="Exchange with reservation" value={exchangeLeg} onChange={e => setExchangeLeg(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-sm">
          <option value="">Choose room to exchange</option>{exchangeCandidates.map(c => <option key={c.legId!} value={c.legId!}>Room {c.code} · {c.reference}</option>)}
        </select>
        <Button size="sm" variant="secondary" disabled={!exchangeLeg || exchangeMutation.isPending} onClick={() => {
          const other = exchangeCandidates.find(c => c.legId === exchangeLeg);
          if (window.confirm(`Exchange room ${card.code} (${card.reference}) with room ${other?.code} (${other?.reference})?`)) exchangeMutation.mutate();
        }}>Exchange rooms</Button>
        {(moves.data ?? []).filter(m => m.status === 'planned').map(m => <div key={m.id} className="flex items-center justify-between rounded bg-info-soft px-2 py-1 text-xs text-info-ink">
          <span>Planned for {m.effectiveDate}</span><button type="button" className="font-semibold underline" onClick={() => stopMutation.mutate(m.id)}>Stop move</button>
        </div>)}
      </div>
    </details>}

    <details className="rounded-lg border border-line bg-surface p-2" open>
      <summary className="cursor-pointer text-sm font-semibold text-ink">Print and send</summary>
      <div className="mt-3 space-y-3">
        <label className="block text-xs font-semibold text-ink-3">Recipients
          <Input value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="guest@example.com" className="mt-1" />
        </label>
        {voucher.data && <div className="rounded bg-surface-2 p-2 text-xs text-ink-2">
          <div className="font-semibold text-ink">{voucher.data.subject}</div>
          <div className="mt-1 line-clamp-3 whitespace-pre-line">{voucher.data.body}</div>
        </div>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => void print('voucher', bookingId)}>Print reservation voucher</Button>
          <Button size="sm" onClick={() => mail.mutate({ kind: 'voucher' })} disabled={mail.isPending}>Send email</Button>
        </div>
        {issuedInvoices.length ? issuedInvoices.map(invoice => <div key={invoice.id} className="flex flex-wrap items-center gap-2 rounded border border-line p-2 text-xs">
          <span className="mr-auto font-semibold text-ink">{invoice.title} {invoice.number}</span>
          <Button size="sm" variant="secondary" onClick={() => void print('invoice', invoice.id)}>Print invoice</Button>
          <Button size="sm" onClick={() => mail.mutate({ kind: 'invoice', invoiceId: invoice.id })}>Send invoice</Button>
        </div>) : <div className="rounded bg-low-soft p-2 text-xs text-low-ink">
          No issued invoice. <Link href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}&section=folio`} className="font-semibold underline">Review the folio and issue documents</Link> before sending.
        </div>}
      </div>
    </details>
  </div>;
}

function dateISO() {
  return new Date().toLocaleDateString('en-CA');
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
