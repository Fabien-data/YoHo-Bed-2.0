'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  ArrowSquareOut,
  ArrowsLeftRight,
  CalendarBlank,
  CaretDown,
  Crown,
  DoorOpen,
  EnvelopeSimple,
  Lock,
  MagicWand,
  Phone,
  PencilSimple,
  SquaresFour,
  Trash,
  UsersThree,
  Wrench,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  InlineAlert,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Sheet,
  SheetContent,
  Skeleton,
  cn,
  toast,
  type Tone,
} from '@yohobed/ui';
import {
  autoAssignRooms,
  bookingTransition,
  confirmBooking,
  describeError,
  getBookingGuests,
  getBookingLegs,
  releaseBlock,
  releaseHold,
  setHousekeeping,
  type StayBar,
  type StayUnit,
  type StayView,
} from '@/lib/api';
import { useMoney } from '@/components/currency';
import { FolioPanel } from '@/components/folio/folio-panel';
import { useDesk, type DeskAction } from '@/components/booking/desk-dialogs';
import { useRefreshDesk } from '@/components/booking/refresh';
import { ReservationNotes } from './reservation-notes';
import { HK_ICON, STATE_ICON } from './icons';
import { daysBetween, nightsLabel, shortDate, stayRange } from './model/dates';
import { HK_META, STATE_META, sourceLabel, stateOf, type StayState } from './model/status';
import { ACTION_LABEL, stayActions, type StayAction } from './model/actions';
import type { HotelPermission } from '@/lib/api';

export type PanelTarget =
  | { kind: 'bar'; barId: string; bookingId?: string }
  | { kind: 'unit'; unitId: string }
  | { kind: 'unassigned'; date?: string };

const STATE_TONE: Record<StayState, Tone> = {
  inhouse: 'avail',
  confirmed: 'brand',
  pending: 'low',
  hold: 'low',
  tentative: 'info',
  checkedout: 'muted',
  noshow: 'closed',
  cancelled: 'closed',
  out_of_service: 'closed',
  blocked: 'muted',
};

export function StateBadge({ bar }: { bar: StayBar }) {
  const state = stateOf(bar);
  const Icon = STATE_ICON[state];
  return (
    <Badge tone={STATE_TONE[state]} dot={false}>
      <Icon size={12} weight="bold" aria-hidden /> {STATE_META[state].label}
    </Badge>
  );
}

/**
 * The one side panel. It stays open while the desk works on the grid behind it, and switching
 * from one reservation (or room) to another swaps its content in place rather than closing and
 * re-opening — the grid never loses its place.
 */
export function PanelHost({
  target,
  width,
  title,
  description,
  onClose,
  children,
}: {
  target: PanelTarget | null;
  width: 'normal' | 'wide';
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const swapKey = target
    ? target.kind === 'bar'
      ? target.barId
      : target.kind === 'unit'
        ? target.unitId
        : `u:${target.date ?? ''}`
    : '';
  return (
    <Sheet modal={false} open={!!target} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        data-sv-panel=""
        showOverlay={false}
        autoFocusField={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          // Esc inside a menu or field is theirs; on the panel itself it closes the panel.
          if ((e.target as HTMLElement | null)?.closest?.('[role="menu"],input,textarea'))
            e.preventDefault();
        }}
        title={title}
        description={description}
        className={cn(width === 'wide' ? 'sm:max-w-xl' : 'sm:max-w-[27rem]')}
      >
        <div key={swapKey} className="sv-panel-swap">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-sm text-ink">{children}</div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-line pt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Reservation                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export function ReservationPanelBody({
  bar,
  data,
  today,
  permissions,
  onChangeDates,
  onShowRooms,
  onDone,
}: {
  bar: StayBar;
  data: StayView;
  today: string;
  permissions: HotelPermission[] | null;
  onChangeDates: (bar: StayBar) => void;
  onShowRooms: (bar: StayBar) => void;
  onDone: (bookingId: string, message: string) => void;
}) {
  const desk = useDesk();
  const refresh = useRefreshDesk();
  const { money } = useMoney();
  const currency = data.property.currency;
  const [danger, setDanger] = React.useState<'release' | 'no-show' | null>(null);
  const can = (...need: HotelPermission[]) =>
    permissions === null || need.every((p) => permissions.includes(p));
  const { primary, secondary } = stayActions(bar, today, { permissions });
  const nights = daysBetween(bar.from, bar.to);
  const roomType = data.roomTypes.find((rt) => rt.roomId === bar.roomId);
  const unit = data.roomTypes.flatMap((rt) => rt.units).find((u) => u.id === bar.roomUnitId);

  const legs = useQuery({
    queryKey: ['booking-legs', bar.bookingId],
    queryFn: () => getBookingLegs(bar.bookingId!),
    enabled: !!bar.bookingId,
  });
  const guests = useQuery({
    queryKey: ['booking-guests', bar.bookingId],
    queryFn: () => getBookingGuests(bar.bookingId!),
    enabled: !!bar.bookingId && can('reservation_read', 'financial_read'),
  });

  const act = useMutation({
    mutationFn: (what: 'confirm' | 'release' | 'no-show' | 'assign'): Promise<unknown> => {
      const id = bar.bookingId!;
      if (what === 'confirm') return confirmBooking(id);
      if (what === 'release') return releaseHold(id);
      if (what === 'assign') return autoAssignRooms(id);
      return bookingTransition(id, 'no-show');
    },
    onSuccess: (result, what) => {
      refresh();
      if (what === 'assign') {
        const r = result as { assigned: number };
        if (!r.assigned) {
          toast.error(
            'No free room of this type for every night. Drag it onto a highlighted room.',
          );
          return;
        }
      }
      const done = {
        confirm: 'is confirmed',
        release: 'is released; its rooms are back on sale',
        'no-show': 'is marked as a no-show',
        assign: 'has a room',
      }[what];
      onDone(bar.bookingId!, `${bar.reference ?? 'The reservation'} ${done}`);
    },
    onError: (e) => toast.error(describeError(e, 'That did not work')),
  });

  const target = {
    id: bar.bookingId!,
    reference: bar.reference ?? '',
    guestName: bar.guestName ?? 'the guest',
    checkin: bar.from,
    checkout: bar.to,
    currency,
  };
  const run = (action: StayAction) => {
    switch (action) {
      case 'confirm':
        return act.mutate('confirm');
      case 'assign':
        return act.mutate('assign');
      case 'release':
      case 'no-show':
        return setDanger(action);
      case 'change-dates':
        return onChangeDates(bar);
      case 'change-departure':
        return onChangeDates(bar);
      default:
        return desk(action as DeskAction, target);
    }
  };
  const visibleSecondary = secondary.slice(0, 2);
  const moreActions = secondary.slice(2);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <StateBadge bar={bar} />
        {bar.vip && (
          <Badge tone="brass" dot={false}>
            <Crown size={12} weight="fill" aria-hidden /> VIP
          </Badge>
        )}
        {bar.groupId && (
          <Badge tone="muted" dot={false}>
            <UsersThree size={12} aria-hidden /> Group {bar.groupCode ?? ''}
          </Badge>
        )}
        {(bar.segment?.of ?? 1) > 1 && (
          <Badge tone="muted" dot={false}>
            <ArrowsLeftRight size={12} aria-hidden /> Split stay
          </Badge>
        )}
        {bar.balanceDue && <Badge tone="low">Payment due</Badge>}
      </div>

      {(primary || secondary.length > 0) && (
        <div className="flex flex-col gap-2">
          {primary && (
            <Button
              className="w-full"
              onClick={() => run(primary)}
              loading={act.isPending && (primary === 'confirm' || primary === 'assign')}
            >
              {ACTION_LABEL[primary]}
            </Button>
          )}
          {secondary.length > 0 && (
            <div className="flex gap-2">
              {visibleSecondary.map((a) => (
                <Button
                  key={a}
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => run(a)}
                >
                  {ACTION_LABEL[a]}
                </Button>
              ))}
              {moreActions.length > 0 && (
                <Menu>
                  <MenuTrigger asChild>
                    <Button variant="secondary" size="sm" aria-label="More actions">
                      More <CaretDown size={12} aria-hidden />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end" className="w-52">
                    {moreActions.map((a) => (
                      <MenuItem
                        key={a}
                        onSelect={() => run(a)}
                        destructive={a === 'cancel' || a === 'no-show' || a === 'release'}
                      >
                        {ACTION_LABEL[a]}
                      </MenuItem>
                    ))}
                  </MenuContent>
                </Menu>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Stay">
          {stayRange(bar.from, bar.to)} · {nightsLabel(nights)}
        </Fact>
        <Fact label="Room">
          {unit
            ? `${unit.code}${unit.displayName ? ` · ${unit.displayName}` : ''}`
            : 'Not assigned'}
        </Fact>
        <Fact label="Room type">{roomType?.name ?? '—'}</Fact>
        <Fact label="Guests">
          {bar.adults ?? 0} adult{bar.adults === 1 ? '' : 's'}
          {bar.children ? `, ${bar.children} child${bar.children === 1 ? '' : 'ren'}` : ''}
        </Fact>
        <Fact label="Source">{sourceLabel(bar) || '—'}</Fact>
        {bar.holdUntil && (
          <Fact label="Hold until">
            {new Date(bar.holdUntil).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Fact>
        )}
      </div>

      {bar.amount !== undefined && (
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3">
          <Fact label="Total">
            <span className="font-mono tabular-nums">{money(bar.amount, currency)}</span>
          </Fact>
          <Fact label="Paid">
            <span className="font-mono tabular-nums">
              {money((Number(bar.amount) - Number(bar.balance ?? 0)).toFixed(2), currency)}
            </span>
          </Fact>
          {/* A negative balance is the guest's money on account, so it says so. */}
          <Fact label={Number(bar.balance) < 0 ? 'In credit' : 'Balance'}>
            <span
              className={cn(
                'font-mono tabular-nums',
                Number(bar.balance) > 0 && 'font-semibold text-low-ink',
                Number(bar.balance) < 0 && 'text-avail-ink',
              )}
            >
              {money(Math.abs(Number(bar.balance ?? 0)).toFixed(2), currency)}
            </span>
          </Fact>
        </div>
      )}

      {guests.data?.primary && (guests.data.primary.email || guests.data.primary.phone) && (
        <div className="flex flex-col gap-1 text-sm text-ink-2">
          {guests.data.primary.phone && (
            <a
              className="inline-flex items-center gap-2 hover:text-ink"
              href={`tel:${guests.data.primary.phone}`}
            >
              <Phone size={14} aria-hidden /> {guests.data.primary.phone}
            </a>
          )}
          {guests.data.primary.email && (
            <a
              className="inline-flex items-center gap-2 truncate hover:text-ink"
              href={`mailto:${guests.data.primary.email}`}
            >
              <EnvelopeSimple size={14} aria-hidden /> {guests.data.primary.email}
            </a>
          )}
        </div>
      )}

      <Section
        title="Rooms"
        action={
          can('room_assignment') &&
          (bar.status === 'Approved' || bar.status === 'Pending' || bar.status === 'CheckedIn') ? (
            <Button variant="ghost" size="sm" onClick={() => onShowRooms(bar)}>
              <DoorOpen size={14} aria-hidden /> Show free rooms
            </Button>
          ) : undefined
        }
      >
        {legs.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(legs.data ?? [])
              .filter((l) => !l.releasedAt)
              .sort((a, b) => a.legIndex - b.legIndex || a.checkin.localeCompare(b.checkin))
              .map((leg) => (
                <li
                  key={leg.id}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <span className="font-mono font-semibold text-ink">{leg.code ?? '—'}</span>
                  <span className="text-ink-3">{leg.displayName ?? ''}</span>
                  <span className="ml-auto text-xs text-ink-2">
                    {stayRange(leg.checkin, leg.checkout)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Section>

      {bar.bookingId && (
        <div className="border-t border-line pt-4">
          <ReservationNotes bookingId={bar.bookingId} editable={can('reservation_change')} />
        </div>
      )}

      {bar.bookingId && permissions === null && (
        <details className="group border-t border-line pt-4">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-ink">
            Bill and payments
            <CaretDown
              size={13}
              className="transition-transform duration-2 group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-3">
            <FolioPanel bookingId={bar.bookingId} />
          </div>
        </details>
      )}

      {bar.bookingId && (
        <Link
          href={`/app/reservations?bookingId=${bar.bookingId}&q=${encodeURIComponent(bar.reference ?? '')}`}
          className="inline-flex items-center gap-1.5 border-t border-line pt-4 text-sm font-medium text-brand-ink hover:underline"
        >
          <ArrowSquareOut size={14} aria-hidden /> Open the full reservation
        </Link>
      )}

      <ConfirmDialog
        open={danger !== null}
        onOpenChange={(o) => !o && setDanger(null)}
        title={
          danger === 'release' ? `Release ${bar.reference}?` : `Mark ${bar.reference} as a no-show?`
        }
        description={
          danger === 'release'
            ? 'The hold ends now and its rooms go back on sale.'
            : 'The guest did not arrive. The nights after tonight go back on sale. If they turn up later, bring the reservation back.'
        }
        confirmLabel={danger === 'release' ? 'Release' : 'Mark no-show'}
        cancelLabel="Keep it"
        destructive
        onConfirm={() => {
          if (danger) act.mutate(danger);
          setDanger(null);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Block                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export function BlockPanelBody({
  bar,
  unit,
  canChange,
  onEdit,
  onDone,
}: {
  bar: StayBar;
  unit?: StayUnit;
  canChange: boolean;
  onEdit: (bar: StayBar) => void;
  onDone: (message: string) => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const refresh = useRefreshDesk();
  const lift = useMutation({
    mutationFn: () => releaseBlock(bar.id),
    onSuccess: () => {
      refresh();
      onDone(`Room ${unit?.code ?? ''} is back on sale`.replace('  ', ' '));
    },
    onError: (e) => toast.error(describeError(e, 'The block was not lifted')),
  });
  const Icon = bar.blockKind === 'blocked' ? Lock : Wrench;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StateBadge bar={bar} />
      </div>
      <div className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
        <Icon size={18} className="mt-0.5 text-ink-3" aria-hidden />
        <div>
          <div className="text-sm font-semibold text-ink">{bar.reason}</div>
          <div className="text-xs text-ink-3">
            Room {unit?.code} · {stayRange(bar.from, bar.to)} ·{' '}
            {nightsLabel(daysBetween(bar.from, bar.to))}
            {bar.blockedBy ? ` · by ${bar.blockedBy}` : ''}
          </div>
        </div>
      </div>
      <p className="text-xs text-ink-3">
        {STATE_META[stateOf(bar)].hint}. Channels see the room as unavailable.
      </p>
      {canChange && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onEdit(bar)}>
            <PencilSimple size={14} aria-hidden /> Edit
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => setConfirming(true)}
            loading={lift.isPending}
          >
            <Trash size={14} aria-hidden /> Lift block
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Put room ${unit?.code ?? ''} back on sale?`}
        description={`The ${nightsLabel(daysBetween(bar.from, bar.to))} from ${shortDate(bar.from)} become available to book here and on every connected channel.`}
        confirmLabel="Lift block"
        cancelLabel="Keep it"
        onConfirm={() => {
          setConfirming(false);
          lift.mutate();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Room                                                                                        */
/* ------------------------------------------------------------------------------------------ */

export function UnitPanelBody({
  unit,
  typeName,
  today,
  propertyId,
  canHousekeeping,
  canBlock,
  onOpenBar,
  onNewBlock,
}: {
  unit: StayUnit;
  typeName?: string;
  today: string;
  propertyId: string;
  canHousekeeping: boolean;
  canBlock: boolean;
  onOpenBar: (bar: StayBar) => void;
  onNewBlock: (unit: StayUnit) => void;
}) {
  const refresh = useRefreshDesk();
  const save = useMutation({
    mutationFn: (status: StayUnit['housekeeping']) =>
      setHousekeeping(propertyId, { roomUnitId: unit.id, date: today, status }),
    onSuccess: (_, status) => {
      refresh();
      toast.success(`Room ${unit.code} is ${HK_META[status].label.toLowerCase()}`);
    },
    onError: (e) => toast.error(describeError(e, 'Housekeeping was not saved')),
  });
  const bookings = unit.bars.filter((b) => b.kind === 'booking');
  const current = bookings.find((b) => b.from <= today && today < b.to);
  const next = bookings
    .filter((b) => b.from > today)
    .sort((a, b) => a.from.localeCompare(b.from))[0];
  const blocks = unit.bars.filter((b) => b.kind === 'block');
  const Hk = HK_ICON[unit.housekeeping];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Room type">{typeName ?? '—'}</Fact>
        <Fact label="Floor">{unit.floor || 'Not set'}</Fact>
        <Fact label="Status">{unit.status === 'active' ? 'In service' : 'Out of service'}</Fact>
        <Fact label="Access">
          {unit.wheelchairAccessible ? 'Wheelchair accessible' : 'Standard'}
        </Fact>
      </div>
      {unit.notes && <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">{unit.notes}</p>}

      <Section title="Housekeeping today">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <Hk size={16} weight="bold" className="text-ink-3" aria-hidden />
          <span className="font-semibold text-ink">{HK_META[unit.housekeeping].label}</span>
          <span className="text-ink-3">· {HK_META[unit.housekeeping].hint}</span>
        </div>
        {unit.housekeepingNotes && (
          <p className="mb-3 text-xs text-ink-2">Note: {unit.housekeepingNotes}</p>
        )}
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={`Set housekeeping for room ${unit.code}`}
        >
          {(['clean', 'dirty', 'inspected'] as const).map((status) => {
            const Icon = HK_ICON[status];
            return (
              <Button
                key={status}
                size="sm"
                variant={unit.housekeeping === status ? 'primary' : 'secondary'}
                disabled={!canHousekeeping || save.isPending || unit.housekeeping === status}
                onClick={() => save.mutate(status)}
              >
                <Icon size={14} aria-hidden /> {HK_META[status].label}
              </Button>
            );
          })}
        </div>
        {!canHousekeeping && (
          <p className="mt-2 text-xs text-ink-3">Your role cannot change housekeeping.</p>
        )}
      </Section>

      <Section title="Guests">
        {current ? (
          <button
            type="button"
            onClick={() => onOpenBar(current)}
            className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            <StateBadge bar={current} />
            <span className="min-w-0 flex-1 truncate font-medium text-ink">
              {current.guestName}
            </span>
            <span className="text-xs text-ink-3">until {shortDate(current.to)}</span>
          </button>
        ) : (
          <p className="mb-1.5 text-sm text-ink-3">Vacant tonight.</p>
        )}
        {next && (
          <button
            type="button"
            onClick={() => onOpenBar(next)}
            className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-2"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Next</span>
            <span className="min-w-0 flex-1 truncate font-medium text-ink">{next.guestName}</span>
            <span className="text-xs text-ink-3">{shortDate(next.from)}</span>
          </button>
        )}
      </Section>

      <Section
        title="Blocks"
        action={
          canBlock && unit.status === 'active' ? (
            <Button variant="ghost" size="sm" onClick={() => onNewBlock(unit)}>
              <Lock size={14} aria-hidden /> Block dates
            </Button>
          ) : undefined
        }
      >
        {blocks.length === 0 ? (
          <p className="text-sm text-ink-3">No blocks in this window.</p>
        ) : (
          blocks.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpenBar(b)}
              className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <StateBadge bar={b} />
              <span className="min-w-0 flex-1 truncate">{b.reason}</span>
              <span className="text-xs text-ink-3">{stayRange(b.from, b.to)}</span>
            </button>
          ))
        )}
      </Section>

      <Link
        href="/app/roomview"
        className="inline-flex items-center gap-1.5 border-t border-line pt-4 text-sm font-medium text-brand-ink hover:underline"
      >
        <SquaresFour size={14} aria-hidden /> Open Room View
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Unassigned                                                                                  */
/* ------------------------------------------------------------------------------------------ */

export function UnassignedPanelBody({
  data,
  date,
  selectedBookingId,
  canAssign,
  onPick,
  onDone,
}: {
  data: StayView;
  date?: string;
  selectedBookingId: string | null;
  canAssign: boolean;
  onPick: (bar: StayBar) => void;
  onDone: (bookingId: string, message: string) => void;
}) {
  const refresh = useRefreshDesk();
  const bars = data.unassigned.filter((b) => !date || (b.from <= date && date < b.to));
  const auto = useMutation({
    mutationFn: (bar: StayBar) => autoAssignRooms(bar.bookingId!),
    onSuccess: (r, bar) => {
      refresh();
      if (r.assigned) onDone(bar.bookingId!, `${bar.guestName ?? 'The stay'} has a room`);
      else
        toast.error('No free room of this type for every night. Drag it onto a highlighted room.');
    },
    onError: (e) => toast.error(describeError(e, 'No room was assigned')),
  });
  if (bars.length === 0)
    return (
      <EmptyState
        icon={<DoorOpen size={28} />}
        title="Every stay has a room"
        description={
          date
            ? `Nothing is waiting for a room on ${shortDate(date)}.`
            : 'Nothing in this window is waiting for a room.'
        }
      />
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        Pick a stay to light up the rooms that can take it, then drag its bar onto one — or let the
        system choose.
      </p>
      {data.roomTypes.map((rt) => {
        const pending = bars.filter((b) => b.roomId === rt.roomId);
        if (!pending.length) return null;
        return (
          <section key={rt.roomId}>
            <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
              {rt.name}
              <span className="font-mono text-xs tabular-nums text-ink-3">{pending.length}</span>
            </h3>
            <ul className="flex flex-col gap-1.5">
              {pending.map((bar) => (
                <li
                  key={bar.id}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    selectedBookingId === bar.bookingId
                      ? 'border-brass bg-brass-soft'
                      : 'border-line',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onPick(bar)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    <StateBadge bar={bar} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {bar.guestName}
                    </span>
                  </button>
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-3">
                    <CalendarBlank size={12} aria-hidden />
                    {stayRange(bar.from, bar.to)} · {(bar.adults ?? 0) + (bar.children ?? 0)} guests
                    · {sourceLabel(bar)}
                    {canAssign && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto h-7"
                        onClick={() => auto.mutate(bar)}
                        loading={auto.isPending && auto.variables?.id === bar.id}
                      >
                        <MagicWand size={13} aria-hidden /> Auto-assign
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {auto.isError && <InlineAlert tone="error">{describeError(auto.error)}</InlineAlert>}
    </div>
  );
}
