'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowsClockwise,
  CalendarBlank,
  CaretLeft,
  CaretRight,
  DoorOpen,
  List,
  UsersThree,
  WifiSlash,
} from '@phosphor-icons/react';
import {
  Button,
  ContextMenu,
  ContextMenuTrigger,
  CountedChips,
  DatePicker,
  EmptyState,
  InlineAlert,
  PageHeader,
  Skeleton,
  cn,
  toast,
  type Chip,
} from '@yohobed/ui';
import {
  autoAssignRooms,
  confirmBooking,
  describeError,
  getStayView,
  moveRoom,
  setHousekeeping,
  subscribeStayUpdates,
  type StreamStatus,
  type SearchReservation,
  type StayBar,
  type StayUnit,
} from '@/lib/api';
import { useActiveProperty } from '@/components/active-property';
import { useRefreshDesk } from '@/components/booking/refresh';
import { useDesk, type DeskAction } from '@/components/booking/desk-dialogs';
import { CalendarContextMenu, type MenuTarget } from '@/components/stayview/context-menu';
import { stayActions, type StayAction } from '@/components/stayview/model/actions';
import { dayAt } from '@/components/stayview/model/layout';
import {
  useOnReservationCreated,
  useReservationComposer,
} from '@/components/reservations/composer/composer-context';
import { CalendarGrid } from '@/components/stayview/calendar-grid';
import { StayHoverCard } from '@/components/stayview/hover-card';
import {
  BlockPanelBody,
  PanelHost,
  ReservationPanelBody,
  UnassignedPanelBody,
  UnitPanelBody,
  type PanelTarget,
} from '@/components/stayview/panels';
import {
  BlockDialog,
  QuickActionsMenu,
  RangeActionBar,
  defaultBlockDraft,
  saved,
  type BlockDraft,
  type RangeAction,
} from '@/components/stayview/quick-actions';
import {
  DateChangeReview,
  RoomMoveReview,
  type DateProposal,
  type MoveProposal,
} from '@/components/stayview/review-dialogs';
import {
  FilterChips,
  FiltersPopover,
  GroupToggles,
  LegendPopover,
  RangeControl,
  SettingsPopover,
} from '@/components/stayview/controls';
import { StaySearch } from '@/components/stayview/stay-search';
import { MobileDayList } from '@/components/stayview/mobile-day-list';
import { ViewSwitch } from '@/components/stayview/view-switch';
import {
  useCalendarAccess,
  useCalendarPreferences,
  useCollapsedGroups,
} from '@/components/stayview/hooks';
import {
  InteractionContext,
  createInteractionStore,
  useInteraction,
  type RangeSelection,
} from '@/components/stayview/interaction/store';
import {
  addDays,
  daysBetween,
  isIsoDate,
  todayIn,
  windowLabel,
} from '@/components/stayview/model/dates';
import { groupRooms } from '@/components/stayview/model/layout';
import {
  EMPTY_FILTERS,
  hasBarFilters,
  matchesBar,
  roomChipMatches,
  unitVisible,
  type CalendarFilters,
  type RoomChip,
} from '@/components/stayview/model/filters';
import { barMatches } from '@/components/stayview/model/search';
import { dayStats } from '@/components/stayview/model/stats';
import { destinationIssue } from '@/components/stayview/model/validity';

/**
 * Stay View — the front desk's workspace. The grid stays in view while the desk works: stays
 * open in a side panel, empty nights turn into reservations or blocks where they are selected,
 * and rooms and dates change by dragging, always through a review that says what will change.
 */
export default function StayViewPage() {
  const store = React.useMemo(() => createInteractionStore(), []);
  return (
    <InteractionContext.Provider value={store}>
      <StayViewScreen />
    </InteractionContext.Provider>
  );
}

function readUrl() {
  if (typeof window === 'undefined') return { from: null, booking: null, unit: null };
  const p = new URLSearchParams(window.location.search);
  return { from: p.get('from'), booking: p.get('booking'), unit: p.get('unit') };
}

function StayViewScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const refreshDesk = useRefreshDesk();
  const { propertyId, property } = useActiveProperty();
  const { openComposer } = useReservationComposer();
  const access = useCalendarAccess();
  const prefs = useCalendarPreferences(propertyId);
  const p = prefs.preferences;
  const store = React.useContext(InteractionContext)!;
  const [stream, setStream] = React.useState<StreamStatus>('connecting');

  // --- where the calendar is looking -------------------------------------------------------
  const fallbackToday = todayIn(property?.timezone ?? 'UTC');
  const [from, setFrom] = React.useState<string>('');
  const windowFrom = from || fallbackToday;
  const days = p.days;
  const to = addDays(windowFrom, days);

  const chart = useQuery({
    queryKey: ['stayview', propertyId, windowFrom, to],
    queryFn: ({ signal }) => getStayView(propertyId!, windowFrom, to, signal),
    enabled: !!propertyId && prefs.loaded,
    // Keep the old window on screen while the next loads — but never another property's.
    placeholderData: (previous) => (previous?.property.id === propertyId ? previous : undefined),
    // Live stream first; a slow poll only while it is down.
    refetchInterval: stream === 'live' ? false : 60_000,
    refetchOnWindowFocus: true,
  });
  const data = chart.data?.property.id === propertyId ? chart.data : undefined;
  const settled = !!data && data.from === windowFrom && data.to === to;
  const today = data?.today ?? fallbackToday;
  const operatingDate = data?.operatingDate ?? today;
  const anchor = data?.counts.date ?? windowFrom;

  // Look one window either way while the desk reads this one.
  React.useEffect(() => {
    if (!propertyId || !settled) return;
    const t = window.setTimeout(() => {
      for (const start of [addDays(windowFrom, -days), addDays(windowFrom, days)])
        void qc.prefetchQuery({
          queryKey: ['stayview', propertyId, start, addDays(start, days)],
          queryFn: ({ signal }) => getStayView(propertyId, start, addDays(start, days), signal),
          staleTime: 30_000,
        });
    }, 900);
    return () => window.clearTimeout(t);
  }, [propertyId, settled, windowFrom, days, qc]);

  // Another desk's change arrives by the live stream. While this desk is mid-gesture or reviewing
  // a change, the refresh waits, so rows never shift under the pointer; it runs the moment the
  // desk is done.
  const busy = React.useRef(false);
  const pendingRefresh = React.useRef(false);
  const refreshLive = React.useCallback(() => {
    if (busy.current) {
      pendingRefresh.current = true;
      return;
    }
    void qc.invalidateQueries({ queryKey: ['stayview', propertyId] });
    void qc.invalidateQueries({ queryKey: ['booking-legs'] });
    void qc.invalidateQueries({ queryKey: ['booking-remarks'] });
  }, [qc, propertyId]);
  React.useEffect(() => {
    if (!propertyId) return;
    const c = subscribeStayUpdates(propertyId, { onChange: refreshLive, onStatus: setStream });
    return () => c.abort();
  }, [propertyId, refreshLive]);

  // --- panels, reviews and selection ----------------------------------------------------------
  const [panel, setPanel] = React.useState<PanelTarget | null>(null);
  const [pick, setPick] = React.useState<StayBar | null>(null);
  const [moveProposal, setMoveProposal] = React.useState<MoveProposal | null>(null);
  const [dateProposal, setDateProposal] = React.useState<DateProposal | null>(null);
  const [blockDraft, setBlockDraft] = React.useState<BlockDraft | null>(null);
  React.useEffect(() => {
    const update = () => {
      const s = store.get();
      const now = !!(s.drag || (s.range && !s.range.done) || moveProposal || dateProposal);
      busy.current = now;
      if (!now && pendingRefresh.current) {
        pendingRefresh.current = false;
        refreshLive();
      }
    };
    update();
    return store.subscribe(update);
  }, [store, moveProposal, dateProposal, refreshLive]);
  const [flash, setFlash] = React.useState<{ key: string; n: number } | null>(null);
  const [flashToday, setFlashToday] = React.useState(0);
  const pendingLocate = React.useRef<{ bookingId: string; open: boolean } | null>(null);
  const flashKey = React.useCallback(
    (key: string) => setFlash((f) => ({ key, n: (f?.n ?? 0) + 1 })),
    [],
  );

  // --- the URL: window, open reservation or room (never guest details) ------------------------
  const writeUrl = React.useCallback(
    (patch: { from?: string; booking?: string | null; unit?: string | null }, push = false) => {
      const url = new URL(window.location.href);
      if (patch.from !== undefined) url.searchParams.set('from', patch.from);
      for (const key of ['booking', 'unit'] as const)
        if (patch[key] !== undefined) {
          if (patch[key]) url.searchParams.set(key, patch[key]!);
          else url.searchParams.delete(key);
        }
      if (url.href === window.location.href) return;
      if (push) window.history.pushState(null, '', url);
      else window.history.replaceState(null, '', url);
    },
    [],
  );
  React.useEffect(() => {
    const restore = () => {
      const u = readUrl();
      setFrom(isIsoDate(u.from) ? u.from : '');
      if (u.booking) pendingLocate.current = { bookingId: u.booking, open: true };
      else setPanel((p) => (p?.kind === 'bar' ? null : p));
      if (u.unit) setPanel({ kind: 'unit', unitId: u.unit });
      else setPanel((p) => (p?.kind === 'unit' ? null : p));
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  const navigate = React.useCallback(
    (next: string) => {
      setFrom(next);
      store.set({ range: null });
      writeUrl({ from: next });
    },
    [store, writeUrl],
  );
  const goToday = React.useCallback(() => {
    navigate(today);
    setFlashToday((n) => n + 1);
  }, [navigate, today]);

  // --- what is on screen -----------------------------------------------------------------------
  const [chip, setChip] = React.useState<RoomChip>('all');
  const [filters, setFilters] = React.useState<CalendarFilters>(EMPTY_FILTERS);
  const [search, setSearch] = React.useState('');
  const deferredSearch = React.useDeferredValue(search.trim());
  React.useEffect(() => {
    setPanel(null);
    setFilters(EMPTY_FILTERS);
    setChip('all');
    store.set({ range: null, hover: null });
  }, [propertyId, store]);

  const units = React.useMemo(() => data?.roomTypes.flatMap((rt) => rt.units) ?? [], [data]);
  const unitsById = React.useMemo(() => new Map(units.map((u) => [u.id, u])), [units]);
  const allBars = React.useMemo(
    () =>
      data ? [...units.flatMap((u) => u.bars), ...data.unassigned, ...(data.tentative ?? [])] : [],
    [data, units],
  );
  const barsById = React.useMemo(() => new Map(allBars.map((b) => [b.id, b])), [allBars]);
  const typeName = React.useCallback(
    (roomId?: string) => data?.roomTypes.find((rt) => rt.roomId === roomId)?.name,
    [data],
  );

  const visibleTypes = React.useMemo(
    () =>
      data?.roomTypes
        .map((rt) => ({
          ...rt,
          units: rt.units.filter(
            (u) => unitVisible(u, filters) && roomChipMatches(u, chip, anchor),
          ),
        }))
        .filter((rt) => rt.units.length > 0) ?? [],
    [data, filters, chip, anchor],
  );
  const groups = React.useMemo(
    () => groupRooms(visibleTypes, p.groupBy),
    [visibleTypes, p.groupBy],
  );
  const stats = React.useMemo(() => (data ? dayStats(data) : []), [data]);
  const searching = deferredSearch.length >= 2;
  const visibleIds = React.useMemo(() => {
    if (!hasBarFilters(filters) && !searching) return null;
    return new Set(
      allBars
        .filter(
          (b) => matchesBar(b, filters, anchor) && (!searching || barMatches(b, deferredSearch)),
        )
        .map((b) => b.id),
    );
  }, [allBars, filters, anchor, searching, deferredSearch]);

  const { collapsed, setCollapsed } = useCollapsedGroups(prefs.storageKey);
  const toggleGroup = React.useCallback(
    (key: string) => {
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setCollapsed(next);
    },
    [collapsed, setCollapsed],
  );

  // A reservation to find once it is on screen: a search result elsewhere, a link, a new booking.
  React.useEffect(() => {
    const want = pendingLocate.current;
    if (!want || !settled) return;
    const bar = allBars.find((b) => b.bookingId === want.bookingId);
    pendingLocate.current = null;
    if (!bar) {
      if (want.open)
        toast.error('That reservation is not in these dates. Search for it to jump to its stay.');
      return;
    }
    const group = groups.find((g) => g.units.some((u) => u.id === bar.roomUnitId));
    if (group && collapsed.has(group.key)) {
      const next = new Set(collapsed);
      next.delete(group.key);
      setCollapsed(next);
    }
    flashKey(bar.bookingId!);
    if (want.open) setPanel({ kind: 'bar', barId: bar.id, bookingId: bar.bookingId });
  }, [allBars, settled, groups, collapsed, setCollapsed, flashKey]);

  useOnReservationCreated((created) => {
    void qc.invalidateQueries({ queryKey: ['stayview'] });
    const first = created.bookings[0];
    if (first) pendingLocate.current = { bookingId: first.id, open: false };
  });

  // --- permissions ------------------------------------------------------------------------------
  const canCreate = access.can('reservation_change', 'financial_read');
  const canBlock = access.can('reservation_change');
  const canAssign = access.can('room_assignment');
  const canChangeDates = access.can('reservation_change', 'financial_read');
  const online = useOnline();

  // --- opening things ---------------------------------------------------------------------------
  const openBar = React.useCallback(
    (bar: StayBar) => {
      store.set({ range: null });
      setPanel({ kind: 'bar', barId: bar.id, bookingId: bar.bookingId });
      if (bar.kind === 'booking' && bar.bookingId)
        writeUrl({ booking: bar.bookingId, unit: null }, true);
    },
    [store, writeUrl],
  );
  const openUnit = React.useCallback(
    (unit: StayUnit) => {
      store.set({ range: null });
      setPanel({ kind: 'unit', unitId: unit.id });
      writeUrl({ unit: unit.id, booking: null }, true);
    },
    [store, writeUrl],
  );
  const closePanel = React.useCallback(() => {
    setPanel(null);
    setPick(null);
    writeUrl({ booking: null, unit: null });
  }, [writeUrl]);

  const done = React.useCallback(
    (bookingId: string | null, message: string, undo?: () => void) => {
      saved(message, undo);
      refreshDesk();
      if (bookingId) {
        pendingLocate.current = { bookingId, open: false };
        flashKey(bookingId);
      }
    },
    [refreshDesk, flashKey],
  );

  const refuse = React.useCallback((bar: StayBar, message: string) => {
    toast.error(message);
    document
      .querySelectorAll<HTMLElement>(`[data-bar-id="${CSS.escape(bar.id)}"]`)
      .forEach((el) => {
        delete el.dataset.shake;
        void el.offsetWidth;
        el.dataset.shake = 'true';
        window.setTimeout(() => delete el.dataset.shake, 400);
      });
  }, []);

  const proposeMove = React.useCallback(
    (bar: StayBar, toUnitId: string) => {
      const target = unitsById.get(toUnitId);
      if (!target) return;
      const origin = bar.roomUnitId ? (unitsById.get(bar.roomUnitId) ?? null) : null;
      // A simple move of a stay not yet arrived saves at once when the desk has asked for that,
      // with Undo; an in-house move (it splits the stay and turns a room over) is always reviewed.
      if (
        !p.dragWarnings &&
        origin &&
        bar.status !== 'CheckedIn' &&
        bar.bookingId &&
        bar.legUpdatedAt
      ) {
        moveRoom(bar.bookingId, {
          legId: bar.id,
          toRoomUnitId: target.id,
          expectedUpdatedAt: bar.legUpdatedAt,
        })
          .then(() =>
            done(
              bar.bookingId!,
              `${bar.guestName ?? 'The guest'} moved to room ${target.code}`,
              () =>
                void getStayView(propertyId!, windowFrom, to)
                  .then((fresh) => {
                    const moved = fresh.roomTypes
                      .flatMap((rt) => rt.units)
                      .flatMap((u) => u.bars)
                      .find((b) => b.bookingId === bar.bookingId && b.legIndex === bar.legIndex);
                    if (!moved?.legUpdatedAt) return;
                    return moveRoom(bar.bookingId!, {
                      legId: moved.id,
                      toRoomUnitId: origin.id,
                      expectedUpdatedAt: moved.legUpdatedAt,
                    }).then(() =>
                      done(
                        bar.bookingId!,
                        `${bar.guestName ?? 'The guest'} is back in room ${origin.code}`,
                      ),
                    );
                  })
                  .catch((e) => toast.error(describeError(e, 'The move could not be undone'))),
            ),
          )
          .catch((e) => {
            toast.error(describeError(e, 'The move was not saved'));
            refreshDesk();
          });
        return;
      }
      setMoveProposal({ bar, from: origin, to: target });
    },
    [unitsById, p.dragWarnings, done, refreshDesk, propertyId, windowFrom, to],
  );

  const startRangeAction = React.useCallback(
    (action: RangeAction, range: { unitId?: string; from: string; to: string }) => {
      store.set({ range: null });
      const unit = range.unitId ? unitsById.get(range.unitId) : undefined;
      if (action === 'reserve' || action === 'hold')
        openComposer({
          checkin: range.from,
          nights: Math.max(1, daysBetween(range.from, range.to)),
          roomId: unit?.roomId,
          roomUnitId: unit?.id,
          kind: action === 'hold' ? 'hold_confirm' : undefined,
        });
      else if (range.unitId)
        setBlockDraft({ kind: action, unitId: range.unitId, from: range.from, to: range.to });
      else setBlockDraft(defaultBlockDraft(action, units, range.from));
    },
    [store, unitsById, units, openComposer],
  );

  const onRange = React.useCallback(
    (range: RangeSelection) => {
      if (!p.selectionActions) return;
      const unit = unitsById.get(range.unitId);
      const start = Math.min(range.start, range.end);
      const end = Math.max(range.start, range.end);
      const fromDate = addDays(windowFrom, start);
      const toDate = addDays(windowFrom, end + 1);
      if (unit && unit.bars.some((b) => b.from < toDate && fromDate < b.to)) {
        store.set({ range: null });
        toast.error(`Room ${unit.code} is not free on all those nights. Select empty nights only.`);
      }
    },
    [p.selectionActions, unitsById, windowFrom, store],
  );

  // Picking a stay in the Unassigned panel lights up the rooms that could take it.
  const compatibleUnitIds = React.useMemo(() => {
    if (!pick) return null;
    return new Set(
      units.filter((u) => !destinationIssue(pick, u, { today: operatingDate })).map((u) => u.id),
    );
  }, [pick, units, operatingDate]);

  // --- the right-click menu (a shortcut to what the panel and + menu already offer) -----------
  const desk = useDesk();
  const [menuTarget, setMenuTarget] = React.useState<MenuTarget | null>(null);
  const runAction = React.useCallback(
    (action: StayAction, bar: StayBar) => {
      if (!bar.bookingId) return;
      const id = bar.bookingId;
      const fail = (e: unknown) => toast.error(describeError(e, 'That did not work'));
      switch (action) {
        case 'confirm':
          return void confirmBooking(id)
            .then(() => done(id, `${bar.reference ?? 'The reservation'} is confirmed`))
            .catch(fail);
        case 'assign':
          return void autoAssignRooms(id)
            .then((r) =>
              r.assigned
                ? done(id, `${bar.guestName ?? 'The stay'} has a room`)
                : toast.error('No free room of this type for every night. Drag it onto one.'),
            )
            .catch(fail);
        case 'change-dates':
        case 'change-departure':
          return setDateProposal({ bar, from: bar.from, to: bar.to });
        case 'release':
        case 'no-show':
          return openBar(bar);
        default:
          return desk(action as DeskAction, {
            id,
            reference: bar.reference ?? '',
            guestName: bar.guestName ?? 'the guest',
            checkin: bar.from,
            checkout: bar.to,
            currency: data?.property.currency,
          });
      }
    },
    [done, openBar, desk, data?.property.currency],
  );
  const onGridContextMenu = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = e.target as HTMLElement;
      const barEl = el.closest<HTMLElement>('[data-bar-id]');
      const bar = barEl ? barsById.get(barEl.dataset.barId!) : undefined;
      if (bar) {
        const { primary, secondary } = stayActions(bar, operatingDate, {
          permissions: access.permissions,
        });
        const actions = [primary, ...secondary].filter(
          (a): a is StayAction => !!a && a !== 'release' && a !== 'no-show',
        );
        return setMenuTarget({ kind: 'bar', bar, actions });
      }
      const label = el.closest<HTMLElement>('[data-unit-label]');
      const labelUnit = label ? unitsById.get(label.dataset.unitLabel!) : undefined;
      if (labelUnit) return setMenuTarget({ kind: 'unit', unit: labelUnit });
      const strip = el.closest<HTMLElement>('[data-unit-id]');
      const unit = strip ? unitsById.get(strip.dataset.unitId!) : undefined;
      const grid = el.closest<HTMLElement>('.sv-grid');
      if (strip && unit && grid && data) {
        const colW = Number(grid.dataset.colWidth) || 60;
        const date = addDays(
          data.from,
          dayAt(e.clientX - strip.getBoundingClientRect().left, colW, data.dates.length),
        );
        if (unit.status === 'active' && !unit.bars.some((b) => b.from <= date && date < b.to))
          return setMenuTarget({ kind: 'night', unit, date });
      }
      // Nothing to offer here: no menu at all rather than an empty one.
      e.preventDefault();
      setMenuTarget(null);
    },
    [barsById, unitsById, operatingDate, access.permissions, data],
  );
  const coarse = useCoarsePointer();

  // --- keyboard ---------------------------------------------------------------------------------
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [quickOpen, setQuickOpen] = React.useState(false);
  React.useEffect(() => {
    if (!p.shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (
        el.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"] [role="combobox"]',
        )
      )
        return;
      if (
        document.querySelector('[role="dialog"][data-state="open"]:not([data-sv-panel])') &&
        e.key !== 'Escape'
      )
        return;
      const act: Record<string, () => void> = {
        '/': () => searchRef.current?.focus(),
        t: goToday,
        '[': () => navigate(addDays(windowFrom, -days)),
        ']': () => navigate(addDays(windowFrom, days)),
        n: () => canCreate && openComposer({ checkin: anchor }),
        '+': () => setQuickOpen(true),
        u: () => setPanel({ kind: 'unassigned' }),
        ',': () => setSettingsOpen(true),
      };
      const run = act[e.key];
      if (run) {
        e.preventDefault();
        run();
      } else if (e.key === 'Escape' && store.get().range) {
        store.set({ range: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p.shortcuts, goToday, navigate, windowFrom, days, canCreate, openComposer, anchor, store]);

  // --- the panel's content ------------------------------------------------------------------------
  const panelBar =
    panel?.kind === 'bar'
      ? (barsById.get(panel.barId) ??
        allBars.find((b) => b.bookingId && b.bookingId === panel.bookingId))
      : undefined;
  const panelUnit = panel?.kind === 'unit' ? unitsById.get(panel.unitId) : undefined;
  const selectedBookingId = panelBar?.bookingId ?? pick?.bookingId ?? null;
  let panelTitle = 'Details';
  let panelDescription: string | undefined;
  let panelBody: React.ReactNode = null;
  if (data && panel?.kind === 'bar' && panelBar) {
    if (panelBar.kind === 'block') {
      panelTitle = panelBar.blockKind === 'blocked' ? 'Blocked room' : 'Out of service';
      panelDescription = panelBar.reason;
      panelBody = (
        <BlockPanelBody
          bar={panelBar}
          unit={units.find((u) => u.bars.some((b) => b.id === panelBar.id))}
          canChange={canBlock}
          onEdit={(bar) => {
            const unit = units.find((u) => u.bars.some((b) => b.id === bar.id));
            setBlockDraft({
              block: bar,
              kind: bar.blockKind ?? 'out_of_service',
              unitId: unit?.id,
              from: bar.from,
              to: bar.to,
            });
          }}
          onDone={(message) => {
            done(null, message);
            closePanel();
          }}
        />
      );
    } else {
      panelTitle = panelBar.guestName ?? 'Reservation';
      panelDescription = panelBar.reference;
      panelBody = (
        <ReservationPanelBody
          bar={panelBar}
          data={data}
          today={operatingDate}
          permissions={access.permissions}
          onChangeDates={(bar) => setDateProposal({ bar, from: bar.from, to: bar.to })}
          onShowRooms={(bar) => {
            setPick(bar);
            toast.message('Free rooms of this type are highlighted. Drag the stay onto one.');
          }}
          onDone={(id, message) => done(id, message)}
        />
      );
    }
  } else if (data && panel?.kind === 'unit' && panelUnit) {
    panelTitle = `Room ${panelUnit.code}${panelUnit.displayName ? ` · ${panelUnit.displayName}` : ''}`;
    panelDescription = typeName(panelUnit.roomId);
    panelBody = (
      <UnitPanelBody
        unit={panelUnit}
        typeName={typeName(panelUnit.roomId)}
        today={today}
        propertyId={propertyId!}
        canHousekeeping={access.can('housekeeping')}
        canBlock={canBlock}
        onOpenBar={openBar}
        onNewBlock={(unit) =>
          setBlockDraft({ kind: 'blocked', unitId: unit.id, from: anchor, to: addDays(anchor, 1) })
        }
      />
    );
  } else if (data && panel?.kind === 'unassigned') {
    panelTitle = 'Unassigned stays';
    panelDescription = panel.date
      ? `Waiting for a room on ${panel.date}`
      : 'Waiting for a room in these dates';
    panelBody = (
      <UnassignedPanelBody
        data={data}
        date={panel.date}
        selectedBookingId={pick?.bookingId ?? null}
        canAssign={canAssign}
        onPick={(bar) => {
          setPick((current) => (current?.id === bar.id ? null : bar));
          flashKey(bar.id);
        }}
        onDone={(id, message) => {
          setPick(null);
          done(id, message);
        }}
      />
    );
  }

  const chips: Chip<RoomChip>[] = [
    { value: 'all', label: 'All', count: data?.counts.all, tone: 'muted' },
    { value: 'vacant', label: 'Vacant', count: data?.counts.vacant, tone: 'avail' },
    { value: 'occupied', label: 'Occupied', count: data?.counts.occupied, tone: 'brand' },
    { value: 'reserved', label: 'Reserved', count: data?.counts.reserved, tone: 'info' },
    { value: 'blocked', label: 'Blocked', count: data?.counts.blocked, tone: 'closed' },
    { value: 'dueOut', label: 'Due out', count: data?.counts.dueOut, tone: 'low' },
  ];

  // Phones get the day list first; the timeline is one switch away.
  const [mobileView, setMobileView] = React.useState<'list' | 'grid'>('list');
  const panelOpen = !!panel && !!panelBody;

  return (
    <div
      className={cn(
        'sv-view-enter min-w-0 transition-[padding] duration-3 ease-smooth',
        panelOpen && (p.panelWidth === 'wide' ? 'xl:pr-[37rem]' : 'xl:pr-[28rem]'),
      )}
    >
      <PageHeader
        eyebrow="Front desk"
        title="Stay view"
        actions={
          <>
            <ViewSwitch current="stay" />
            <Button
              size="sm"
              disabled={!canCreate || !online}
              onClick={() => openComposer({ checkin: anchor })}
              title="New reservation (N)"
            >
              New reservation
            </Button>
          </>
        }
      />

      {/* Toolbar: where, how far, find, filter, act. */}
      <div
        className="sticky top-0 z-30 -mx-1 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-card"
        role="toolbar"
        aria-label="Calendar toolbar"
      >
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous dates"
            title="Previous dates ([)"
            onClick={() => navigate(addDays(windowFrom, -days))}
          >
            <CaretLeft size={16} aria-hidden />
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday} title="Today (T)">
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next dates"
            title="Next dates (])"
            onClick={() => navigate(addDays(windowFrom, days))}
          >
            <CaretRight size={16} aria-hidden />
          </Button>
        </div>
        <DatePicker
          value={windowFrom}
          today={today}
          aria-label="Window start date"
          className="w-[9.5rem]"
          onChange={(iso) => navigate(iso)}
        />
        <span className="hidden text-sm font-medium text-ink-2 2xl:inline">
          {windowLabel(windowFrom, days)}
        </span>
        <RangeControl value={days} onChange={(d) => prefs.update({ days: d })} />
        <StaySearch
          propertyId={propertyId}
          units={units}
          lanes={data ? [...data.unassigned, ...(data.tentative ?? [])] : []}
          value={search}
          onChange={setSearch}
          inputRef={searchRef}
          onPickStay={(bar) => {
            if (bar.bookingId) flashKey(bar.bookingId);
            openBar(bar);
          }}
          onPickRoom={(unit) => {
            flashKey(unit.id);
            openUnit(unit);
          }}
          onPickRemote={(r: SearchReservation) => {
            pendingLocate.current = { bookingId: r.id, open: true };
            navigate(r.checkin > today ? addDays(r.checkin, -1) : r.checkin);
          }}
        />
        <div className="ml-auto flex items-center gap-1">
          <FiltersPopover
            data={data}
            value={filters}
            onChange={setFilters}
            showMoney={access.can('financial_read')}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPanel({ kind: 'unassigned' })}
            aria-label={`Unassigned stays: ${data?.unassigned.length ?? 0}`}
            title="Unassigned stays (U)"
          >
            <UsersThree size={15} aria-hidden />
            <span className="hidden 2xl:inline">Unassigned</span>
            <span
              className={cn(
                'rounded-full px-1.5 font-mono text-[11px] tabular-nums',
                (data?.unassigned.length ?? 0) > 0
                  ? 'bg-low text-white'
                  : 'bg-surface-2 text-ink-3',
              )}
            >
              {data?.unassigned.length ?? 0}
            </span>
          </Button>
          <QuickActionsMenu
            open={quickOpen}
            onOpenChange={setQuickOpen}
            disabled={!online || !data}
            canReserve={canCreate}
            canBlock={canBlock}
            onAction={(action) =>
              startRangeAction(action, { from: anchor, to: addDays(anchor, 1) })
            }
          />
          <GroupToggles
            onExpand={() => setCollapsed(new Set())}
            onCollapse={() => setCollapsed(new Set(groups.map((g) => g.key)))}
          />
          <LegendPopover />
          <SettingsPopover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            value={p}
            onChange={prefs.update}
            onReset={prefs.reset}
            storageError={prefs.storageError}
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <CountedChips
          chips={chips}
          value={chip}
          onChange={setChip}
          loading={chart.isLoading}
          aria-label="Room status"
        />
        <FilterChips value={filters} onChange={setFilters} categoryName={typeName} />
      </div>

      <StatusLine
        online={online}
        fetching={chart.isFetching && !chart.isLoading}
        live={stream === 'live'}
        businessDate={data?.businessDate}
        today={today}
        empty={!!data && allBars.every((b) => b.kind !== 'booking')}
        onRefresh={() => void chart.refetch()}
      />

      {chart.isError && (
        <InlineAlert tone="error" className="mb-3">
          {describeError(chart.error, 'The calendar could not refresh')}. What you see may be out of
          date.{' '}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void chart.refetch()}
          >
            Try again
          </button>
        </InlineAlert>
      )}

      <div className="md:hidden mb-3 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileView(mobileView === 'list' ? 'grid' : 'list')}
        >
          {mobileView === 'list' ? (
            <CalendarBlank size={14} aria-hidden />
          ) : (
            <List size={14} aria-hidden />
          )}
          {mobileView === 'list' ? 'Timeline' : 'Day list'}
        </Button>
      </div>

      {!data ? (
        chart.isError ? null : (
          <GridSkeleton />
        )
      ) : data.roomTypes.length === 0 ? (
        <EmptyState
          icon={<DoorOpen size={28} />}
          title="No rooms set up yet"
          description="Add room types and numbered rooms in Property setup, and they appear here."
          className="rounded-xl border border-line bg-surface"
        />
      ) : (
        <>
          {mobileView === 'list' && (
            <div className="md:hidden">
              <MobileDayList data={data} date={anchor} onOpen={openBar} />
            </div>
          )}
          <ContextMenu onOpenChange={(open) => !open && setMenuTarget(null)}>
            <ContextMenuTrigger asChild disabled={coarse}>
              <div
                className={cn(
                  'overflow-hidden rounded-xl border border-line bg-surface shadow-card transition-opacity duration-2',
                  mobileView === 'list' && 'hidden md:block',
                  !settled && 'opacity-60',
                )}
                aria-busy={!settled}
              >
                {groups.length === 0 ? (
                  <EmptyState
                    title="No rooms match"
                    description="Nothing fits these filters in these dates."
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setChip('all');
                          setFilters(EMPTY_FILTERS);
                        }}
                      >
                        Clear filters
                      </Button>
                    }
                  />
                ) : (
                  <CalendarGrid
                    data={data}
                    groups={groups}
                    windowFrom={data.from}
                    days={data.dates.length}
                    prefs={p}
                    stats={stats}
                    today={today}
                    operatingDate={operatingDate}
                    collapsed={collapsed}
                    visibleIds={visibleIds}
                    selectedBookingId={selectedBookingId}
                    compatibleUnitIds={compatibleUnitIds}
                    flash={flash}
                    flashToday={flashToday}
                    canAssign={canAssign && online}
                    canChangeDates={canChangeDates && online}
                    canCreate={(canCreate || canBlock) && online}
                    scrollKey={`${propertyId}:${days}`}
                    handlers={{
                      onOpenBar: openBar,
                      onOpenUnit: openUnit,
                      onRange,
                      onOpenEmpty: (unitId, date) => {
                        if (!canCreate) return;
                        const unit = unitsById.get(unitId);
                        openComposer({ checkin: date, roomId: unit?.roomId, roomUnitId: unitId });
                      },
                      onProposeMove: proposeMove,
                      onProposeDates: (bar, f, t) => setDateProposal({ bar, from: f, to: t }),
                      onProposeResize: (bar, t) => setDateProposal({ bar, from: bar.from, to: t }),
                      onRefuse: refuse,
                      onUnassignedOn: (date) => setPanel({ kind: 'unassigned', date }),
                      onToggleGroup: toggleGroup,
                    }}
                    onContextMenu={onGridContextMenu}
                  />
                )}
              </div>
            </ContextMenuTrigger>
            <CalendarContextMenu
              target={menuTarget}
              canReserve={canCreate && online}
              canBlock={canBlock && online}
              canHousekeeping={access.can('housekeeping') && online}
              onOpenBar={openBar}
              onAction={runAction}
              onEditBlock={(bar) => {
                const unit = units.find((u) => u.bars.some((b) => b.id === bar.id));
                setBlockDraft({
                  block: bar,
                  kind: bar.blockKind ?? 'out_of_service',
                  unitId: unit?.id,
                  from: bar.from,
                  to: bar.to,
                });
              }}
              onOpenUnit={openUnit}
              onHousekeeping={(unit, status) =>
                void setHousekeeping(propertyId!, { roomUnitId: unit.id, date: today, status })
                  .then(() => done(null, `Room ${unit.code} marked ${status}`))
                  .catch((e) => toast.error(describeError(e, 'Housekeeping was not saved')))
              }
              onNight={(action, unit, date) =>
                startRangeAction(action, { unitId: unit.id, from: date, to: addDays(date, 1) })
              }
              onRoomView={() => router.push('/app/roomview')}
            />
          </ContextMenu>
        </>
      )}

      {data && (
        <>
          <StayHoverCard
            currency={data.property.currency}
            roomTypeName={typeName}
            roomLabel={(id) => (id ? unitsById.get(id)?.code : undefined)}
          />
          <RangeActions
            windowFrom={data.from}
            unitsById={unitsById}
            canReserve={canCreate && online}
            canBlock={canBlock && online}
            enabled={p.selectionActions}
            onAction={startRangeAction}
          />
        </>
      )}

      <PanelHost
        target={panelOpen ? panel : null}
        width={p.panelWidth}
        title={panelTitle}
        description={panelDescription}
        onClose={closePanel}
      >
        {panelBody}
      </PanelHost>

      <RoomMoveReview
        proposal={moveProposal}
        typeName={typeName}
        today={operatingDate}
        onClose={() => setMoveProposal(null)}
        onDone={(id, message) => {
          setMoveProposal(null);
          setPick(null);
          done(id, message);
        }}
      />
      <DateChangeReview
        proposal={dateProposal}
        today={operatingDate}
        currency={data?.property.currency ?? ''}
        onClose={() => setDateProposal(null)}
        onDone={(id, message) => {
          setDateProposal(null);
          done(id, message);
        }}
      />
      <BlockDialog
        draft={blockDraft}
        units={units}
        propertyId={propertyId}
        today={today}
        onClose={() => setBlockDraft(null)}
        onSaved={(unitId, message) => {
          setBlockDraft(null);
          done(null, message);
          flashKey(unitId);
        }}
      />
    </div>
  );
}

/** The action bar under selected empty nights, positioned on the selection itself. */
function RangeActions({
  windowFrom,
  unitsById,
  canReserve,
  canBlock,
  enabled,
  onAction,
}: {
  windowFrom: string;
  unitsById: Map<string, StayUnit>;
  canReserve: boolean;
  canBlock: boolean;
  enabled: boolean;
  onAction: (action: RangeAction, range: { unitId?: string; from: string; to: string }) => void;
}) {
  const range = useInteraction((s) => s.range);
  const store = React.useContext(InteractionContext)!;
  const [, bump] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => {
    const grid = document.querySelector('.sv-grid');
    if (!range?.done || !grid) return;
    const onScroll = () => bump();
    grid.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      grid.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [range]);
  if (!enabled || !range?.done || typeof document === 'undefined') return null;
  const strip = document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(range.unitId)}"]`);
  const grid = document.querySelector<HTMLElement>('.sv-grid');
  if (!strip || !grid) return null;
  const colW = Number(grid.dataset.colWidth) || 60;
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const from = addDays(windowFrom, start);
  const to = addDays(windowFrom, end + 1);
  const unit = unitsById.get(range.unitId);
  if (unit && unit.bars.some((b) => b.from < to && from < b.to)) return null;
  const s = strip.getBoundingClientRect();
  const g = grid.getBoundingClientRect();
  const top = s.bottom + 6;
  if (top < g.top || top > g.bottom) return null;
  const left = Math.max(g.left + 8, Math.min(s.left + start * colW, window.innerWidth - 480));
  return createPortal(
    <div className="fixed z-40" style={{ top, left }}>
      <RangeActionBar
        range={{ unitId: range.unitId, from, to }}
        unit={unit}
        canReserve={canReserve}
        canBlock={canBlock}
        onAction={(a) => onAction(a, { unitId: range.unitId, from, to })}
        onClear={() => store.set({ range: null })}
      />
    </div>,
    document.body,
  );
}

function StatusLine({
  online,
  fetching,
  live,
  businessDate,
  today,
  empty,
  onRefresh,
}: {
  online: boolean;
  fetching: boolean;
  live: boolean;
  businessDate?: string;
  today: string;
  empty: boolean;
  onRefresh: () => void;
}) {
  return (
    <div
      className="mb-2 flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3"
      role="status"
      aria-live="polite"
    >
      {!online ? (
        <span className="inline-flex items-center gap-1.5 font-semibold text-closed-ink">
          <WifiSlash size={13} aria-hidden /> Offline — changes are paused until you reconnect.
        </span>
      ) : (
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 hover:text-ink"
        >
          <ArrowsClockwise size={12} className={cn(fetching && 'animate-spin')} aria-hidden />
          {fetching ? 'Updating…' : live ? 'Live' : 'Up to date'}
          {live && !fetching && <span className="h-1.5 w-1.5 rounded-full bg-avail" aria-hidden />}
        </button>
      )}
      {businessDate && businessDate < today && (
        <span className="text-low-ink">
          Night audit last closed {businessDate} — run it to roll the business date forward.
        </span>
      )}
      {empty && <span>No stays in these dates yet.</span>}
    </div>
  );
}

function GridSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl border border-line bg-surface"
      aria-busy="true"
      aria-label="Loading the calendar"
    >
      <div className="flex h-14 border-b border-line">
        <div className="w-[196px] shrink-0 border-r border-line" />
        <div className="flex flex-1 gap-3 px-3 py-3">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-full flex-1" shimmer />
          ))}
        </div>
      </div>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex h-11 items-center border-b border-line">
          <div className="w-[196px] shrink-0 border-r border-line px-3">
            <Skeleton className="h-4 w-16" />
          </div>
          <div className="relative flex-1 px-2">
            <Skeleton
              className="h-6"
              style={{ width: `${18 + ((i * 37) % 45)}%`, marginLeft: `${(i * 23) % 40}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A touch-first device: the long-press there opens the stay, not a menu. */
function useCoarsePointer() {
  const [coarse, setCoarse] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return coarse;
}

function useOnline() {
  const [online, setOnline] = React.useState(true);
  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
