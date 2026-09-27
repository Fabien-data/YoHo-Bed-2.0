'use client';

import * as React from 'react';
import { flushSync } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wheelchair,
  MapPin,
  Broom,
  CaretDown,
  CaretLeft,
  GearSix,
  CaretRight,
  SquaresFour,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  CountedChips,
  DatePicker,
  PageHeader,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Dialog,
  DialogContent,
  Input,
  Sheet,
  SheetContent,
  Skeleton,
  toast,
  cn,
  type Chip,
  type Tone,
} from '@yohobed/ui';
import {
  getRoomView,
  getHouseSummary,
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
  getBookingFolio,
  listWorkOrders,
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
import { useEntitlements, useTenantRole } from '@/lib/queries';
import Link from 'next/link';
import { ViewSwitch } from '@/components/stayview/view-switch';
import { LegendPopover } from '@/components/stayview/controls';
import { RoomTile } from '@/components/roomview/room-tile';
import { DaySummary } from '@/components/roomview/day-summary';
import { dayOfMonth, monthShort, weekday } from '@/components/stayview/model/dates';

/** A date as the desk reads it everywhere else: Mon 29 Sep. */
const deskDate = (iso: string) => `${weekday(iso)} ${dayOfMonth(iso)} ${monthShort(iso)}`;

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

  const today = React.useMemo(() => todayISO(), []);
  const [date, setDate] = React.useState(today);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'rooms' | 'floor'>('rooms');
  const [floor, setFloor] = React.useState('all');
  const [density, setDensity] = React.useState<'comfortable' | 'compact'>('comfortable');
  const [maintenanceOverlay, setMaintenanceOverlay] = React.useState(false);
  const [floorDirection, setFloorDirection] = React.useState(0);
  const viewRootRef = React.useRef<HTMLDivElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const previousRects = React.useRef(new Map<string, DOMRect>());

  const rooms = useQuery({
    queryKey: ['room-view', propertyId, date],
    queryFn: () => getRoomView(propertyId!, date),
    enabled: !!propertyId,
    placeholderData: (prev) => prev,
    refetchInterval: 20_000,
  });
  const layouts = useQuery({
    queryKey: ['floor-layouts', propertyId],
    queryFn: () => listFloorLayouts(propertyId!),
    enabled: !!propertyId,
  });
  // The day's totals, counted by the Stay View's own logic so both screens agree.
  const house = useQuery({
    queryKey: ['house-summary', propertyId, date],
    queryFn: () => getHouseSummary(propertyId!, date),
    enabled: !!propertyId,
    placeholderData: (prev) => prev,
    refetchInterval: 20_000,
  });
  const tasks = useQuery({
    queryKey: ['cleaning-tasks', propertyId, date],
    queryFn: () => listCleaningTasks(propertyId!, date),
    enabled: !!propertyId,
    refetchInterval: 20_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['room-view'] });
    qc.invalidateQueries({ queryKey: ['stayview'] });
    qc.invalidateQueries({ queryKey: ['cleaning-tasks'] });
    qc.invalidateQueries({ queryKey: ['house-summary'] });
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
  const quickStatus = useMutation({
    mutationFn: ({ unitId, status }: { unitId: string; status: HousekeepingState }) =>
      setHousekeeping(propertyId!, { roomUnitId: unitId, date, status }),
    onSuccess: refresh,
    onError: (error) => toast.error((error as Error).message),
  });

  const cards = rooms.data ?? [];
  const selected = cards.find((c) => c.unitId === selectedId) ?? null;
  const floors = Array.from(new Set(cards.map((c) => c.floor ?? 'Unassigned'))).sort();
  const displayedFloor = floor === 'all' ? (floors[0] ?? 'Unassigned') : floor;
  const canEditLayout = role === 'OWNER' || role === 'HOUSEKEEPING_SUPERVISOR';
  const rememberRects = () => {
    previousRects.current = new Map(
      Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-room-id]') ?? []).map(
        (el) => [el.dataset.roomId!, el.getBoundingClientRect()],
      ),
    );
  };
  const switchView = (mode: 'rooms' | 'floor') => {
    if (mode === view) return;
    const selectFirstFloor = mode === 'floor' && floor === 'all';
    const updateView = () => {
      if (selectFirstFloor) setFloor(floors[0] ?? 'Unassigned');
      setView(mode);
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      rememberRects();
      updateView();
      return;
    }

    // The entrance keyframes are for first load. Later switches are driven by
    // the shared-room transition (or its FLIP fallback), so they must not fight it.
    viewRootRef.current?.classList.add('room-view-no-entry');
    if (typeof document.startViewTransition !== 'function') {
      rememberRects();
      updateView();
      return;
    }

    // Both layouts give each room the same view-transition-name. The browser
    // carries its snapshot from the floor coordinate to its card-grid position.
    document.startViewTransition(() => flushSync(updateView));
  };
  React.useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const el of Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>('[data-room-id]') ?? [],
    )) {
      const before = previousRects.current.get(el.dataset.roomId!);
      if (!before) continue;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left,
        dy = before.top - after.top;
      const sx = before.width / after.width,
        sy = before.height / after.height;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(before.width - after.width) < 2) continue;
      // Fallback for browsers without the View Transitions API, and for grid
      // reflows caused by filters or density changes.
      el.style.animation = 'none';
      const animation = el.animate(
        [
          {
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
            opacity: 0.85,
            transformOrigin: 'top left',
          },
          { transform: 'none', opacity: 1, transformOrigin: 'top left' },
        ],
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
      void animation.finished.then(
        () => el.style.removeProperty('animation'),
        () => el.style.removeProperty('animation'),
      );
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

  const visible = cards.filter(
    (c) =>
      (view !== 'floor' || (c.floor ?? 'Unassigned') === displayedFloor) &&
      (floor === 'all' || (c.floor ?? 'Unassigned') === floor) &&
      (filter === 'all'
        ? true
        : filter === 'dirty'
          ? c.housekeeping === 'dirty'
          : c.state === filter),
  );

  const floorLabel = (f: string) =>
    f === 'Unassigned' ? 'No floor set' : /^\d+$/.test(f) ? `Floor ${f}` : f;
  const shiftDate = (days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  return (
    <div ref={viewRootRef} className="min-w-0">
      <PageHeader eyebrow="Front desk" title="Room view" actions={<ViewSwitch current="room" />} />

      {/* Toolbar: which day, how to lay the rooms out, and the day's housekeeping sweep. */}
      <div
        // Pinned below the app bar while the rooms scroll — on a phone it would take the screen.
        className="z-20 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-card md:sticky md:top-16"
        role="toolbar"
        aria-label="Room view toolbar"
      >
        <div
          role="tablist"
          aria-label="Room presentation"
          className="relative grid h-8 grid-cols-2 items-center rounded-lg border border-line-strong bg-surface-2 p-0.5"
        >
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-md bg-surface shadow-card transition-transform duration-3 ease-smooth',
              view === 'rooms' && 'translate-x-full',
            )}
          />
          {(['floor', 'rooms'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={view === mode}
              onClick={() => switchView(mode)}
              className={cn(
                'relative z-10 inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors duration-1',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass',
                view === mode ? 'text-ink' : 'text-ink-3 hover:text-ink',
              )}
            >
              {mode === 'floor' ? (
                <MapPin size={14} aria-hidden />
              ) : (
                <SquaresFour size={14} aria-hidden />
              )}
              {mode === 'floor' ? 'Floor' : 'Rooms'}
            </button>
          ))}
        </div>
        <Select
          value={floor}
          onValueChange={(next) => {
            rememberRects();
            setFloorDirection(Math.sign(floors.indexOf(next) - floors.indexOf(displayedFloor)));
            setFloor(next);
          }}
        >
          <SelectTrigger id="room-floor" aria-label="Floor" className="h-8 w-[9.5rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {view === 'rooms' && <SelectItem value="all">All floors</SelectItem>}
            {floors.map((f) => (
              <SelectItem key={f} value={f}>
                {floorLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous day"
            title="Previous day"
            onClick={() => shiftDate(-1)}
          >
            <CaretLeft size={16} aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setDate(today)}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next day"
            title="Next day"
            onClick={() => shiftDate(1)}
          >
            <CaretRight size={16} aria-hidden />
          </Button>
        </div>
        <DatePicker
          value={date}
          today={today}
          aria-label="Business date"
          className="w-[9.5rem]"
          onChange={(iso) => setDate(iso)}
        />
        {view === 'rooms' && (
          <SegmentedControl
            aria-label="Card density"
            value={density}
            onChange={(d) => {
              rememberRects();
              setDensity(d);
            }}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 px-1 text-sm text-ink-2">
            <Switch
              checked={maintenanceOverlay}
              onCheckedChange={setMaintenanceOverlay}
              aria-label="Maintenance overlay"
            />
            Maintenance
          </label>
          <LegendPopover />
          {role !== 'HOUSEKEEPING_ATTENDANT' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sweep.mutate()}
              disabled={sweep.isPending || !propertyId}
              title="Mark every room whose guest left today as dirty"
            >
              <Broom size={15} aria-hidden />
              {sweep.isPending ? 'Marking…' : 'Mark departures dirty'}
            </Button>
          )}
        </div>
      </div>

      <DaySummary
        date={date}
        today={today}
        day={house.data?.day}
        dirty={count((c) => c.housekeeping === 'dirty')}
        loading={house.isLoading}
        canOpenCalendar={role !== 'HOUSEKEEPING_ATTENDANT' && role !== 'HOUSEKEEPING_SUPERVISOR'}
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <CountedChips
          chips={chips}
          value={filter}
          onChange={(next) => {
            rememberRects();
            setFilter(next);
          }}
          loading={rooms.isLoading}
          aria-label="Room status"
        />
        {sweep.data && (
          <p className="text-sm text-ink-2" role="status">
            Marked {sweep.data.marked} departed room{sweep.data.marked === 1 ? '' : 's'} as dirty.
          </p>
        )}
      </div>

      {role === 'OWNER' && propertyId && (
        <RoomConfiguration propertyId={propertyId} onChanged={refresh} />
      )}

      {rooms.isLoading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <Card className="p-10 text-center text-sm text-ink-3">
          No rooms set up yet. Add them under Configuration &rarr; Room types.
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div ref={gridRef} className="min-w-0">
            {view === 'floor' ? (
              <FloorCanvas
                cards={visible}
                date={date}
                floor={displayedFloor}
                floorName={floorLabel(displayedFloor)}
                layout={layouts.data?.find((l) => l.floor === displayedFloor)}
                propertyId={propertyId}
                canEdit={canEditLayout}
                onSaved={() => {
                  qc.invalidateQueries({ queryKey: ['floor-layouts'] });
                  refresh();
                }}
                onOpen={(id) => setSelectedId(id)}
                maintenanceOverlay={maintenanceOverlay}
                floorDirection={floorDirection}
                selectedId={selectedId}
                onQuickStatus={
                  role === 'HOUSEKEEPING_ATTENDANT'
                    ? undefined
                    : (unitId, status) => quickStatus.mutate({ unitId, status })
                }
                canInspect={canEditLayout}
              />
            ) : (
              <div
                className={cn(
                  'grid gap-3',
                  density === 'compact'
                    ? 'grid-cols-[repeat(auto-fill,minmax(160px,1fr))]'
                    : 'grid-cols-[repeat(auto-fill,minmax(212px,1fr))]',
                )}
                style={{ viewTransitionName: 'room-layout' }}
              >
                {visible.map((c, index) => (
                  <RoomTile
                    key={c.unitId}
                    card={c}
                    date={date}
                    compact={density === 'compact'}
                    maintenanceOverlay={maintenanceOverlay}
                    onOpen={() => setSelectedId(c.unitId)}
                    index={index}
                    onQuickStatus={
                      role === 'HOUSEKEEPING_ATTENDANT'
                        ? undefined
                        : (status) => quickStatus.mutate({ unitId: c.unitId, status })
                    }
                    canInspect={canEditLayout}
                    selected={selectedId === c.unitId}
                    dimmed={selectedId !== null && selectedId !== c.unitId}
                  />
                ))}
              </div>
            )}
          </div>
          <PriorityQueue
            tasks={tasks.data ?? []}
            canManage={canEditLayout}
            onJump={(id) => {
              const target = cards.find((c) => c.unitId === id);
              if (!target) return;
              setFloor(target.floor ?? 'Unassigned');
              setFilter('all');
              window.setTimeout(() => {
                const el = document.querySelector<HTMLElement>(`[data-room-id="${id}"]`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el?.animate(
                  [{ outline: '3px solid var(--brass)' }, { outline: '3px solid transparent' }],
                  { duration: 1400 },
                );
              }, 80);
            }}
            onChanged={refresh}
          />
        </div>
      )}

      <RoomSheet
        card={selected}
        cards={cards}
        tasks={tasks.data ?? []}
        propertyId={propertyId}
        date={date}
        onClose={() => setSelectedId(null)}
        onChanged={refresh}
      />
    </div>
  );
}

function FloorCanvas({
  cards,
  date,
  floor,
  floorName,
  layout,
  propertyId,
  canEdit,
  onSaved,
  onOpen,
  maintenanceOverlay,
  floorDirection,
  selectedId,
  onQuickStatus,
  canInspect,
}: {
  cards: RoomCard[];
  date: string;
  floor: string;
  floorName: string;
  layout?: FloorLayout;
  propertyId?: string;
  canEdit: boolean;
  onSaved: () => void;
  onOpen: (id: string) => void;
  maintenanceOverlay: boolean;
  floorDirection: number;
  selectedId: string | null;
  onQuickStatus?: (unitId: string, status: HousekeepingState) => void;
  canInspect: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({});
  const [landmarks, setLandmarks] = React.useState<FloorLayout['landmarks']>([]);
  const [landmarkKind, setLandmarkKind] =
    React.useState<FloorLayout['landmarks'][number]['kind']>('lift');
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = React.useState(640);
  const columns = Math.max(1, Math.min(6, Math.floor((canvasWidth - 24) / 184)));
  const rows = Math.max(1, Math.ceil(cards.length / columns));
  const upperRows = Math.ceil(rows / 2);
  const canvasHeight = Math.max(
    layout ? 460 : 320,
    48 + rows * 160 + (rows - 1) * 24 + (rows > 1 ? 40 : 0),
  );
  const corridorY = 24 + upperRows * 160 + (upperRows - 1) * 24 + 20;
  const auto = (i: number) => ({
    x: 25 + (i % columns) * (950 / columns),
    y:
      ((24 + Math.floor(i / columns) * 184 + (Math.floor(i / columns) >= upperRows ? 40 : 0)) /
        canvasHeight) *
      1000,
  });
  React.useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(([entry]) => setCanvasWidth(entry.contentRect.width));
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    setPositions(
      Object.fromEntries(
        cards.map((c, i) => [
          c.unitId,
          c.mapX != null && c.mapY != null ? { x: c.mapX, y: c.mapY } : auto(i),
        ]),
      ),
    );
    setLandmarks(layout?.landmarks ?? []);
    setEditing(false);
  }, [
    floor,
    layout?.version,
    columns,
    canvasHeight,
    cards.map((c) => `${c.unitId}:${c.mapX}:${c.mapY}`).join('|'),
  ]);
  const save = useMutation({
    mutationFn: () =>
      saveFloorLayout(propertyId!, {
        floor,
        expectedVersion: layout?.version ?? null,
        rooms: cards.map((c) => ({
          unitId: c.unitId,
          ...(positions[c.unitId] ?? auto(cards.indexOf(c))),
        })),
        landmarks,
      }),
    onSuccess: () => {
      setEditing(false);
      onSaved();
      toast.success('Floor layout saved');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <div
      className="rounded-2xl border border-line bg-surface-2 p-3 sm:p-5"
      style={{ viewTransitionName: 'room-layout' }}
    >
      <div className="mb-3 flex items-center gap-2">
        <MapPin size={18} className="text-brand" />
        <h2 className="font-semibold text-ink">{floorName}</h2>
        <span className="text-xs text-ink-3">{cards.length} rooms</span>
        {canEdit && (
          <div className="ml-auto flex gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                  Save layout
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Arrange
              </Button>
            )}
          </div>
        )}
      </div>
      {editing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-2">
          Drag rooms to position them.{' '}
          <Choice
            aria-label="Landmark type"
            value={landmarkKind}
            onChange={(v) => setLandmarkKind(v as typeof landmarkKind)}
            className="h-8 w-32"
            options={[
              { value: 'lift', label: 'Lift' },
              { value: 'stairs', label: 'Stairs' },
              { value: 'service', label: 'Service' },
              { value: 'corridor', label: 'Corridor' },
            ]}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setLandmarks([
                ...landmarks,
                { id: crypto.randomUUID(), kind: landmarkKind, x: 500, y: 500 },
              ])
            }
          >
            Add landmark
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setPositions(Object.fromEntries(cards.map((c, i) => [c.unitId, auto(i)])))
            }
          >
            Auto arrange
          </Button>
        </div>
      )}
      {editing && landmarks.length > 0 && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2" aria-label="Landmark positions">
          {landmarks.map((landmark) => (
            <div
              key={landmark.id}
              className="flex items-center gap-2 rounded border border-line p-2"
            >
              <span className="w-16 shrink-0 text-xs capitalize text-ink-2">{landmark.kind}</span>
              <Input
                aria-label={`${landmark.kind} label`}
                value={landmark.label ?? ''}
                placeholder="Label"
                onChange={(e) =>
                  setLandmarks((current) =>
                    current.map((item) =>
                      item.id === landmark.id ? { ...item, label: e.target.value } : item,
                    ),
                  )
                }
              />
              {(['x', 'y'] as const).map((axis) => (
                <Input
                  key={axis}
                  type="number"
                  min={0}
                  max={1000}
                  className="w-16"
                  aria-label={`${landmark.kind} ${axis} position`}
                  value={landmark[axis]}
                  onChange={(e) =>
                    setLandmarks((current) =>
                      current.map((item) =>
                        item.id === landmark.id
                          ? { ...item, [axis]: Math.max(0, Math.min(1000, Number(e.target.value))) }
                          : item,
                      ),
                    )
                  }
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <div
        ref={canvasRef}
        className="relative overflow-hidden rounded-xl border border-line bg-surface"
        style={{ height: canvasHeight }}
      >
        {cards.length > columns && (
          <div
            aria-hidden
            className="absolute left-3 right-3 border-t border-dashed border-line-strong text-center text-[10px] uppercase tracking-widest text-ink-3"
            style={{ top: corridorY }}
          >
            Corridor
          </div>
        )}
        {landmarks.map((l) => (
          <div
            key={l.id}
            className={cn(
              'absolute z-10 rounded-md border border-line bg-surface-2 px-2 py-1 text-xs text-ink-2',
              editing && 'touch-none cursor-move',
            )}
            style={{ left: `${l.x / 10}%`, top: `${l.y / 10}%` }}
            onPointerDown={
              editing ? (e) => e.currentTarget.setPointerCapture(e.pointerId) : undefined
            }
            onPointerMove={
              editing
                ? (e) => {
                    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    const x = Math.max(
                      0,
                      Math.min(950, Math.round(((e.clientX - rect.left) / rect.width) * 1000)),
                    );
                    const y = Math.max(
                      0,
                      Math.min(950, Math.round(((e.clientY - rect.top) / rect.height) * 1000)),
                    );
                    setLandmarks((current) =>
                      current.map((item) => (item.id === l.id ? { ...item, x, y } : item)),
                    );
                  }
                : undefined
            }
          >
            {l.label ?? l.kind}
            {editing && (
              <button
                type="button"
                aria-label={`Remove ${l.kind}`}
                className="ml-2"
                onClick={() => setLandmarks(landmarks.filter((x) => x.id !== l.id))}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {cards.map((c, i) => {
          const p = positions[c.unitId] ?? auto(i);
          return (
            <div
              key={c.unitId}
              className={cn(
                'absolute z-20 w-36 touch-none sm:w-40',
                editing && 'cursor-move',
                floorDirection > 0 && 'room-enter-up',
                floorDirection < 0 && 'room-enter-down',
              )}
              style={{ left: `min(${p.x / 10}%, calc(100% - 10rem))`, top: `${p.y / 10}%` }}
              onPointerDown={
                editing ? (e) => e.currentTarget.setPointerCapture(e.pointerId) : undefined
              }
              onPointerMove={
                editing
                  ? (e) => {
                      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                      const rect = canvasRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setPositions((prev) => ({
                        ...prev,
                        [c.unitId]: {
                          x: Math.max(
                            0,
                            Math.min(
                              900,
                              Math.round(((e.clientX - rect.left) / rect.width) * 1000),
                            ),
                          ),
                          y: Math.max(
                            0,
                            Math.min(
                              900,
                              Math.round(((e.clientY - rect.top) / rect.height) * 1000),
                            ),
                          ),
                        },
                      }));
                    }
                  : undefined
              }
            >
              <RoomTile
                card={c}
                date={date}
                compact
                maintenanceOverlay={maintenanceOverlay}
                onOpen={() => {
                  if (!editing) onOpen(c.unitId);
                }}
                index={i}
                onQuickStatus={
                  editing || !onQuickStatus
                    ? undefined
                    : (status) => onQuickStatus(c.unitId, status)
                }
                canInspect={canInspect}
                selected={selectedId === c.unitId}
                dimmed={selectedId !== null && selectedId !== c.unitId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoomConfiguration({
  propertyId,
  onChanged,
}: {
  propertyId: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const units = useQuery({
    queryKey: ['room-units', propertyId],
    queryFn: () => listRoomUnits(propertyId),
  });
  const roomTypes = useQuery({ queryKey: ['rooms'], queryFn: listRooms });
  const [form, setForm] = React.useState({
    roomId: '',
    code: '',
    displayName: '',
    floor: '',
    smokingPolicy: 'unspecified' as 'unspecified' | 'smoking' | 'non_smoking',
    wheelchairAccessible: false,
  });
  const options = (roomTypes.data ?? []).filter((room) => room.propertyId === propertyId);
  React.useEffect(() => {
    if (!form.roomId && options[0]) setForm((current) => ({ ...current, roomId: options[0]!.id }));
  }, [form.roomId, options]);
  const refresh = () => {
    void units.refetch();
    void qc.invalidateQueries({ queryKey: ['room-view'] });
    onChanged();
  };
  const create = useMutation({
    mutationFn: () =>
      createRoomUnit(propertyId, { ...form, floor: form.floor.trim() || undefined }),
    onSuccess: () => {
      setForm((current) => ({ ...current, code: '', displayName: '' }));
      refresh();
      toast.success('Physical room added');
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateRoomUnit>[1] }) =>
      updateRoomUnit(id, body),
    onSuccess: () => {
      refresh();
      toast.success('Room configuration updated');
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const [open, setOpen] = React.useState(false);
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-ink transition-colors duration-1 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brass"
      >
        <CaretDown
          size={14}
          weight="bold"
          aria-hidden
          className={cn(
            'text-ink-3 transition-transform duration-2 ease-smooth',
            !open && '-rotate-90',
          )}
        />
        <GearSix size={15} aria-hidden className="text-ink-3" />
        Configure physical rooms
        <span className="ml-auto font-mono text-xs font-medium tabular-nums text-ink-3">
          {(units.data ?? []).length} rooms
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-4">
          <div className="grid items-center gap-2 lg:grid-cols-[1fr_8rem_9rem_8rem_11rem_auto_auto]">
            <Choice
              aria-label="Room type"
              placeholder="Choose room type"
              value={form.roomId}
              onChange={(v) => setForm({ ...form, roomId: v })}
              options={options.map((room) => ({ value: room.id, label: room.name }))}
            />
            <Input
              aria-label="Room code"
              placeholder="Room 101"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <Input
              aria-label="Optional room name"
              placeholder="Lotus (optional)"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
            <Input
              aria-label="Floor"
              placeholder="Floor"
              value={form.floor}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
            />
            <Choice
              aria-label="Smoking policy"
              value={form.smokingPolicy}
              onChange={(v) => setForm({ ...form, smokingPolicy: v as typeof form.smokingPolicy })}
              options={SMOKING_OPTIONS}
            />
            <label className="flex items-center gap-2 text-xs text-ink-2">
              <Checkbox
                checked={form.wheelchairAccessible}
                onCheckedChange={(v) => setForm({ ...form, wheelchairAccessible: v === true })}
              />
              Accessible
            </label>
            <Button
              size="sm"
              disabled={!form.roomId || !form.code.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              Add room
            </Button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {(units.data ?? []).map((unit) => (
              <div key={unit.id} className="rounded-lg border border-line p-2.5 text-xs">
                <div className="mb-2 flex items-center gap-2">
                  <strong className="font-mono text-ink">{unit.code}</strong>
                  {unit.displayName && (
                    <span className="font-semibold text-ink-2">· {unit.displayName}</span>
                  )}
                  <span className="text-ink-3">
                    {unit.roomName} · {unit.floor ? `Floor ${unit.floor}` : 'No floor'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={`Display name for ${unit.code}`}
                    defaultValue={unit.displayName ?? ''}
                    placeholder="Optional name"
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (unit.displayName ?? ''))
                        update.mutate({ id: unit.id, body: { displayName: value || null } });
                    }}
                  />
                  <Input
                    aria-label={`Notes for ${unit.code}`}
                    defaultValue={unit.notes ?? ''}
                    placeholder="Room notes"
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== (unit.notes ?? ''))
                        update.mutate({ id: unit.id, body: { notes: value || null } });
                    }}
                  />
                  <Choice
                    aria-label={`Smoking policy for ${unit.code}`}
                    value={unit.smokingPolicy}
                    onChange={(v) =>
                      update.mutate({
                        id: unit.id,
                        body: { smokingPolicy: v as typeof unit.smokingPolicy },
                      })
                    }
                    options={SMOKING_OPTIONS}
                  />
                  <Choice
                    aria-label={`Connected room for ${unit.code}`}
                    value={unit.connectedRoomUnitId ?? ''}
                    onChange={(v) =>
                      update.mutate({ id: unit.id, body: { connectedRoomUnitId: v || null } })
                    }
                    options={[
                      { value: '', label: 'No connected room' },
                      ...(units.data ?? [])
                        .filter((other) => other.id !== unit.id)
                        .map((other) => ({ value: other.id, label: `Room ${other.code}` })),
                    ]}
                  />
                </div>
                <label className="mt-2 flex items-center gap-2 text-ink-2">
                  <Checkbox
                    checked={unit.wheelchairAccessible}
                    onCheckedChange={(v) =>
                      update.mutate({ id: unit.id, body: { wheelchairAccessible: v === true } })
                    }
                  />
                  Wheelchair accessible
                </label>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function PriorityQueue({
  tasks,
  canManage,
  onJump,
  onChanged,
}: {
  tasks: CleaningTask[];
  canManage: boolean;
  onJump: (id: string) => void;
  onChanged: () => void;
}) {
  const team = useQuery({
    queryKey: ['team-members'],
    queryFn: listTeamMembers,
    enabled: canManage,
  });
  const housekeepers = (team.data ?? []).filter(
    (member) =>
      member.status !== 'disabled' &&
      (member.role === 'HOUSEKEEPING_ATTENDANT' || member.role === 'HOUSEKEEPING_SUPERVISOR'),
  );
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { status?: string; rush?: boolean; assignedToUserId?: string | null };
    }) => updateCleaningTask(id, body),
    onSuccess: onChanged,
    onError: (e) => toast.error((e as Error).message),
  });
  const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  return (
    <aside
      className="rounded-xl border border-line bg-surface p-3 xl:sticky xl:top-4 xl:self-start"
      aria-label="Priority cleaning queue"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Cleaning queue</h2>
        <Badge tone="low">{open.length}</Badge>
      </div>
      {open.length === 0 ? (
        <p className="text-xs text-ink-3">No cleaning tasks for this date.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((task) => (
            <li key={task.id} className="rounded-lg border border-line p-2 text-xs">
              <button
                type="button"
                className="font-semibold text-ink hover:underline"
                onClick={() => onJump(task.roomUnitId)}
              >
                Room {task.code}
              </button>
              {task.rush && <span className="ml-2 font-semibold text-low-ink">Rush</span>}
              {canManage && (
                <Choice
                  aria-label={`Assign room ${task.code}`}
                  value={task.assignedToUserId ?? ''}
                  onChange={(v) =>
                    update.mutate({ id: task.id, body: { assignedToUserId: v || null } })
                  }
                  className="mt-2 h-8 w-full text-xs"
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...housekeepers.map((member) => ({ value: member.id, label: member.name })),
                  ]}
                />
              )}
              <p className="mt-1 text-ink-3">
                {task.kind.replace('_', ' ')} · {task.status.replace('_', ' ')}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {task.status === 'queued' && (
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: task.id, body: { status: 'in_progress' } })}
                    className="rounded bg-info-soft px-2 py-1 text-info-ink"
                  >
                    Start
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => update.mutate({ id: task.id, body: { status: 'done' } })}
                  className="rounded bg-avail-soft px-2 py-1 text-avail-ink"
                >
                  Clean
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: task.id, body: { rush: !task.rush } })}
                    className="rounded bg-low-soft px-2 py-1 text-low-ink"
                  >
                    {task.rush ? 'Unrush' : 'Rush'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** Room detail: set housekeeping, read the stay, leave a remark. */
function RoomSheet({
  card,
  cards,
  tasks,
  propertyId,
  date,
  onClose,
  onChanged,
}: {
  card: RoomCard | null;
  cards: RoomCard[];
  tasks: CleaningTask[];
  propertyId?: string;
  date: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [remarks, setRemarks] = React.useState('');
  const { openComposer } = useReservationComposer();
  const role = useTenantRole();
  const entitlements = useEntitlements();
  const canUseFolio = role === 'OWNER' || role === 'OWNER_STAFF';
  const activeTask = tasks.find(
    (task) => task.roomUnitId === card?.unitId && task.status !== 'cancelled',
  );
  const folio = useQuery({
    queryKey: ['room-folio', card?.bookingId],
    queryFn: () => getBookingFolio(card!.bookingId!),
    enabled: !!card?.bookingId && canUseFolio,
  });
  const orders = useQuery({
    queryKey: ['room-work-orders', propertyId],
    queryFn: () => listWorkOrders(propertyId!),
    enabled: !!propertyId && entitlements.data?.features.work_orders === true && card !== null,
  });
  const roomOrders = (orders.data ?? []).filter(
    (order) =>
      order.roomUnitId === card?.unitId &&
      (order.status === 'open' || order.status === 'in_progress'),
  );
  const housekeepingStates: HousekeepingState[] =
    role === 'HOUSEKEEPING_ATTENDANT'
      ? ['clean']
      : role === 'OWNER' || role === 'HOUSEKEEPING_SUPERVISOR'
        ? ['dirty', 'clean', 'inspected']
        : ['dirty', 'clean'];

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
    },
  });

  return (
    <Sheet modal={false} open={card !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        showOverlay={false}
        onInteractOutside={(event) => event.preventDefault()}
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
                <Info label="Arrival" value={card.checkin ? deskDate(card.checkin) : '—'} />
                <Info label="Departure" value={card.checkout ? deskDate(card.checkout) : '—'} />
              </div>
            )}

            {card.source && <Info label="Booking source" value={card.source} />}

            {card.nextReservation && (
              <div className="rounded-lg border border-info bg-info-soft p-3 text-sm text-info-ink">
                <div className="font-semibold">Next arrival</div>
                <div>
                  {card.nextReservation.guestName} · {deskDate(card.nextReservation.checkin)}
                </div>
              </div>
            )}

            {canUseFolio && card.bookingId && (
              <div className="rounded-lg border border-line p-3">
                <h3 className="mb-2 text-sm font-bold text-ink">Folio</h3>
                {folio.isLoading ? (
                  <p className="text-xs text-ink-3">Loading folio…</p>
                ) : folio.data ? (
                  <>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <Info
                        label="Charges"
                        value={`${folio.data.currency} ${folio.data.totals.charges}`}
                      />
                      <Info
                        label="Paid"
                        value={`${folio.data.currency} ${folio.data.totals.paid}`}
                      />
                      <Info
                        label="Balance"
                        value={`${folio.data.currency} ${folio.data.totals.balance}`}
                      />
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-ink-2">
                      {folio.data.windows.map((window) => (
                        <p key={window.id}>
                          {window.label}: {window.lines.filter((line) => !line.voidedAt).length}{' '}
                          charges · balance {folio.data?.currency} {window.totals.balance}
                        </p>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-closed-ink">Folio could not be loaded.</p>
                )}
              </div>
            )}

            {card.bookingId && (role === 'OWNER' || role === 'OWNER_STAFF') && (
              <ReservationActions
                card={card}
                cards={cards}
                propertyId={propertyId}
                onChanged={onChanged}
              />
            )}

            {card.state === 'Vacant' && card.unitStatus === 'active' && canUseFolio && (
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

            <div className="rounded-lg border border-line p-3 text-sm">
              <h3 className="mb-2 font-bold text-ink">Room operations</h3>
              <p className="text-ink-2">
                Assigned housekeeper: {card.assignedToName ?? 'Unassigned'}
              </p>
              {activeTask ? (
                <p className="mt-1 text-ink-2">
                  {activeTask.kind.replace('_', ' ')} · {activeTask.status.replace('_', ' ')}
                  {activeTask.rush ? ' · Rush Clean' : ''}
                </p>
              ) : (
                <p className="mt-1 text-ink-3">No cleaning task for this date.</p>
              )}
              {activeTask?.notes && (
                <p className="mt-2 text-ink-2">Task note: {activeTask.notes}</p>
              )}
              {card.remarks && <p className="mt-2 text-ink-2">Housekeeping note: {card.remarks}</p>}
            </div>

            {roomOrders.length > 0 && (
              <div className="rounded-lg border border-line p-3 text-sm">
                <h3 className="mb-2 font-bold text-ink">Maintenance work orders</h3>
                {roomOrders.map((order) => (
                  <div
                    key={order.id}
                    className="border-t border-line py-2 first:border-0 first:pt-0"
                  >
                    <p className="font-semibold">
                      {order.title} · {order.status.replace('_', ' ')}
                    </p>
                    {order.description && <p className="text-ink-2">{order.description}</p>}
                    {order.assignedToName && (
                      <p className="text-xs text-ink-3">Assigned to {order.assignedToName}</p>
                    )}
                  </div>
                ))}
              </div>
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

function ReservationActions({
  card,
  cards,
  propertyId,
  onChanged,
}: {
  card: RoomCard;
  cards: RoomCard[];
  propertyId?: string;
  onChanged: () => void;
}) {
  const role = useTenantRole();
  const { openComposer } = useReservationComposer();
  const bookingId = card.bookingId!;
  const [destination, setDestination] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [exchangeLeg, setExchangeLeg] = React.useState('');
  const [recipient, setRecipient] = React.useState(card.guestEmail ?? '');
  const [sendPreview, setSendPreview] = React.useState<{
    kind: 'voucher' | 'invoice';
    id: string;
    title: string;
  } | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!sendPreview) {
      setPreviewUrl(null);
      setPreviewError(null);
      return;
    }
    let active = true;
    let url: string | null = null;
    setPreviewUrl(null);
    setPreviewError(null);
    void fetchDocumentPdf(sendPreview.kind, sendPreview.id)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        if (active) setPreviewUrl(url);
        else URL.revokeObjectURL(url);
      })
      .catch((error) => {
        if (active) setPreviewError((error as Error).message);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sendPreview]);

  React.useEffect(() => {
    setRecipient(card.guestEmail ?? '');
    setDestination('');
    setEffectiveDate('');
    setExchangeLeg('');
  }, [bookingId, card.guestEmail]);

  const legs = useQuery({
    queryKey: ['booking-legs', bookingId],
    queryFn: () => getBookingLegs(bookingId),
  });
  const units = useQuery({
    queryKey: ['room-units', propertyId],
    queryFn: () => listRoomUnits(propertyId!),
    enabled: !!propertyId,
  });
  const moves = useQuery({
    queryKey: ['room-moves', bookingId],
    queryFn: () => listRoomMoves(bookingId),
  });
  const invoices = useQuery({
    queryKey: ['invoices', bookingId],
    queryFn: () => listInvoices({ bookingId }),
  });
  const voucher = useQuery({
    queryKey: ['voucher-preview', bookingId],
    queryFn: () => previewVoucher(bookingId),
  });

  const refresh = () => {
    onChanged();
    void legs.refetch();
    void moves.refetch();
    void invoices.refetch();
  };
  const roomList = (legs.data ?? [])
    .filter((l) => !l.releasedAt)
    .map((l) => l.code ?? 'Unassigned')
    .join(', ');
  const confirmReservation = (label: string) =>
    window.confirm(
      `${label} reservation ${card.reference ?? ''}?\nAffected rooms: ${roomList || card.code}`,
    );

  const workflow = useMutation({
    mutationFn: async (
      action: 'approve' | 'cancel' | 'no-show' | 'check-in' | 'check-out' | 'void' | 'unassign',
    ) => {
      if (!confirmReservation(action === 'void' ? 'Void' : action.replace('-', ' ')))
        throw new Error('cancelled');
      if (action === 'void') return voidBooking(bookingId);
      if (action === 'unassign') {
        if (!card.legId) throw new Error('No active room assignment');
        return assignRooms(bookingId, [{ legId: card.legId, roomUnitId: null }]);
      }
      return bookingTransition(bookingId, action);
    },
    onSuccess: () => {
      toast.success('Reservation updated');
      refresh();
    },
    onError: (e) => {
      if ((e as Error).message !== 'cancelled') toast.error((e as Error).message);
    },
  });
  const moveMutation = useMutation({
    mutationFn: () =>
      moveRoom(bookingId, {
        legId: card.legId!,
        toRoomUnitId: destination,
        ...(effectiveDate ? { effectiveDate } : {}),
      }),
    onSuccess: () => {
      toast.success(effectiveDate ? 'Room move planned' : 'Room moved');
      refresh();
      setDestination('');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const exchangeMutation = useMutation({
    mutationFn: () => exchangeRooms(card.legId!, exchangeLeg),
    onSuccess: () => {
      toast.success('Rooms exchanged');
      refresh();
      setExchangeLeg('');
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const stopMutation = useMutation({
    mutationFn: stopRoomMove,
    onSuccess: () => {
      toast.success('Planned move stopped');
      refresh();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const signalMutation = useMutation({
    mutationFn: (body: { doNotDisturb?: boolean; requestedSafetyFlag?: boolean }) =>
      setRoomSignals(bookingId, body),
    onSuccess: refresh,
    onError: (e) => toast.error((e as Error).message),
  });
  const mail = useMutation({
    mutationFn: ({ kind, invoiceId }: { kind: 'voucher' | 'invoice'; invoiceId?: string }) => {
      const emails = recipient
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      if (!emails.length) throw new Error('Enter at least one recipient');
      return kind === 'voucher' ? sendVoucher(bookingId, emails) : sendInvoice(invoiceId!, emails);
    },
    onSuccess: () => {
      toast.success('Document queued for delivery');
      setSendPreview(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const print = async (kind: 'voucher' | 'invoice', id: string) => {
    try {
      const blob = await fetchDocumentPdf(kind, id);
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) toast.error('Allow pop-ups to open the PDF');
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const availableUnits = (units.data ?? []).filter(
    (u) => u.roomId === card.roomId && u.id !== card.unitId && u.status === 'active',
  );
  const exchangeCandidates = cards.filter(
    (c) => c.roomId === card.roomId && c.legId && c.legId !== card.legId && c.bookingId,
  );
  const issuedInvoices = (invoices.data ?? []).filter(
    (i) => i.status === 'issued' || i.status === 'paid',
  );

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Reservation actions</h3>
        <Link
          href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}`}
          className="text-xs font-semibold text-brand hover:underline"
        >
          Open full reservation
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {card.bookingStatus === 'Pending' && (
          <Button size="sm" onClick={() => workflow.mutate('approve')}>
            Approve
          </Button>
        )}
        {card.bookingStatus === 'Approved' && (
          <Button size="sm" onClick={() => workflow.mutate('check-in')}>
            Check in
          </Button>
        )}
        {card.bookingStatus === 'CheckedIn' && (
          <Button size="sm" onClick={() => workflow.mutate('check-out')}>
            Check out
          </Button>
        )}
        {(card.bookingStatus === 'Pending' || card.bookingStatus === 'Approved') && (
          <>
            <Button size="sm" variant="secondary" onClick={() => workflow.mutate('cancel')}>
              Cancel
            </Button>
            <Button size="sm" variant="secondary" onClick={() => workflow.mutate('unassign')}>
              Unassign
            </Button>
          </>
        )}
        {card.bookingStatus === 'Approved' && (
          <Button size="sm" variant="secondary" onClick={() => workflow.mutate('no-show')}>
            No show
          </Button>
        )}
        {role === 'OWNER' &&
          (card.bookingStatus === 'Pending' || card.bookingStatus === 'Approved') && (
            <Button size="sm" variant="secondary" onClick={() => workflow.mutate('void')}>
              Void
            </Button>
          )}
        <Link
          href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}&section=folio`}
          className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface"
        >
          Payment / folio
        </Link>
        <Link
          href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}&section=stay`}
          className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface"
        >
          Amend stay / inclusions
        </Link>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            openComposer({
              checkin: card.checkout && card.checkout > todayISO() ? card.checkout : todayISO(),
              roomId: card.roomId,
              roomUnitId: card.unitId,
            })
          }
        >
          Add new booking
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs text-ink-2">
          <Checkbox
            checked={card.doNotDisturb}
            onCheckedChange={(v) => signalMutation.mutate({ doNotDisturb: v === true })}
          />
          Do not disturb
        </label>
        {(role === 'OWNER' || role === 'OWNER_STAFF') && (
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <Checkbox
              checked={card.requestedSafetyFlag}
              onCheckedChange={(v) => signalMutation.mutate({ requestedSafetyFlag: v === true })}
            />
            Guest requested safety flag
          </label>
        )}
      </div>

      {card.legId && (
        <details className="rv-disclosure">
          <summary>Move or exchange room</summary>
          <div className="mt-3 space-y-2">
            <Choice
              aria-label="Move to room"
              placeholder="Choose destination"
              value={destination}
              onChange={setDestination}
              className="w-full"
              options={availableUnits.map((u) => ({
                value: u.id,
                label: `Room ${u.code} · ${u.roomName}`,
              }))}
            />
            <Input
              type="date"
              value={effectiveDate}
              min={dateISO()}
              onChange={(e) => setEffectiveDate(e.target.value)}
              aria-label="Move date"
            />
            <Button
              size="sm"
              disabled={!destination || moveMutation.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Move ${card.reference} from room ${card.code} to ${availableUnits.find((u) => u.id === destination)?.code}?`,
                  )
                )
                  moveMutation.mutate();
              }}
            >
              {effectiveDate ? 'Plan move' : 'Move now'}
            </Button>
            <Choice
              aria-label="Exchange with reservation"
              placeholder="Choose room to exchange"
              value={exchangeLeg}
              onChange={setExchangeLeg}
              className="w-full"
              options={exchangeCandidates.map((c) => ({
                value: c.legId!,
                label: `Room ${c.code} · ${c.reference}`,
              }))}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!exchangeLeg || exchangeMutation.isPending}
              onClick={() => {
                const other = exchangeCandidates.find((c) => c.legId === exchangeLeg);
                if (
                  window.confirm(
                    `Exchange room ${card.code} (${card.reference}) with room ${other?.code} (${other?.reference})?`,
                  )
                )
                  exchangeMutation.mutate();
              }}
            >
              Exchange rooms
            </Button>
            {(moves.data ?? [])
              .filter((m) => m.status === 'planned')
              .map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded bg-info-soft px-2 py-1 text-xs text-info-ink"
                >
                  <span>Planned for {deskDate(m.effectiveDate)}</span>
                  <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => stopMutation.mutate(m.id)}
                  >
                    Stop move
                  </button>
                </div>
              ))}
          </div>
        </details>
      )}

      <details className="rv-disclosure" open>
        <summary>Print and send</summary>
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-semibold text-ink-3">
            Recipients
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="guest@example.com"
              className="mt-1"
            />
          </label>
          {voucher.data && (
            <div className="rounded bg-surface-2 p-2 text-xs text-ink-2">
              <div className="font-semibold text-ink">{voucher.data.subject}</div>
              <div className="mt-1 line-clamp-3 whitespace-pre-line">{voucher.data.body}</div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void print('voucher', bookingId)}>
              Print reservation voucher
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setSendPreview({ kind: 'voucher', id: bookingId, title: 'Reservation voucher' })
              }
            >
              Send email
            </Button>
          </div>
          {issuedInvoices.length ? (
            issuedInvoices.map((invoice) => (
              <div
                key={invoice.id}
                className="flex flex-wrap items-center gap-2 rounded border border-line p-2 text-xs"
              >
                <span className="mr-auto font-semibold text-ink">
                  {invoice.title} {invoice.number}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void print('invoice', invoice.id)}
                >
                  Print invoice
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    setSendPreview({
                      kind: 'invoice',
                      id: invoice.id,
                      title: `${invoice.title} ${invoice.number}`,
                    })
                  }
                >
                  Send invoice
                </Button>
              </div>
            ))
          ) : (
            <div className="rounded bg-low-soft p-2 text-xs text-low-ink">
              No issued invoice.{' '}
              <Link
                href={`/app/reservations?bookingId=${bookingId}&q=${encodeURIComponent(card.reference ?? '')}&section=folio`}
                className="font-semibold underline"
              >
                Review the folio and issue documents
              </Link>{' '}
              before sending.
            </div>
          )}
        </div>
      </details>
      <Dialog open={sendPreview !== null} onOpenChange={(open) => !open && setSendPreview(null)}>
        <DialogContent
          title={`Review and send ${sendPreview?.title ?? 'document'}`}
          className="max-h-[80dvh] max-w-4xl"
        >
          <div className="max-h-[calc(80dvh-3.75rem)] space-y-3 overflow-y-auto p-4">
            <p className="text-sm text-ink-2">
              Review the exact PDF that will be attached to the email.
            </p>
            {previewError && <p className="text-sm text-closed-ink">{previewError}</p>}
            {previewUrl ? (
              <iframe
                title={`${sendPreview?.title ?? 'Document'} PDF preview`}
                src={previewUrl}
                className="h-[55vh] w-full rounded-lg border border-line bg-white"
              />
            ) : !previewError ? (
              <p className="text-sm text-ink-3">Preparing PDF preview…</p>
            ) : null}
            <label className="block text-sm font-medium text-ink">
              Recipients (comma separated)
              <Input
                className="mt-1"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
            </label>
            {sendPreview?.kind === 'voucher' && voucher.data && (
              <div className="rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
                <p className="font-semibold text-ink">{voucher.data.subject}</p>
                <p className="mt-1 whitespace-pre-line">{voucher.data.body}</p>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSendPreview(null)}>
                Cancel
              </Button>
              <Button
                disabled={!previewUrl || mail.isPending}
                loading={mail.isPending}
                onClick={() =>
                  sendPreview &&
                  mail.mutate({
                    kind: sendPreview.kind,
                    ...(sendPreview.kind === 'invoice' ? { invoiceId: sendPreview.id } : {}),
                  })
                }
              >
                Queue email
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
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

const SMOKING_OPTIONS = [
  { value: 'unspecified', label: 'Smoking not set' },
  { value: 'non_smoking', label: 'Non smoking' },
  { value: 'smoking', label: 'Smoking' },
];

/**
 * The kit's select for a plain list of choices. Radix cannot hold an empty value, so "none" (the
 * empty string the API expects) travels as a placeholder value and comes back as ''.
 */
const NONE = '__none';
function Choice({
  value,
  onChange,
  options,
  placeholder,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  className?: string;
  'aria-label': string;
}) {
  return (
    <Select
      value={value === '' && !placeholder ? NONE : value || undefined}
      onValueChange={(v) => onChange(v === NONE ? '' : v)}
    >
      <SelectTrigger aria-label={ariaLabel} className={cn('h-9', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value || NONE} value={o.value || NONE}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
