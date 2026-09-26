'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CurrencyCircleDollar, Plus, Trash, Users } from '@phosphor-icons/react';
import { displayMealCode } from '@yohobed/locale';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  NumberStepper,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Skeleton,
  Switch,
  Tooltip,
  cn,
  toast,
} from '@yohobed/ui';
import {
  addGuestConfiguration,
  createPropertyRatePlan,
  deleteGuestConfiguration,
  deleteRatePlan,
  listPropertyRatePlans,
  listRateTypes,
  listRoomTypes,
  updateGuestConfiguration,
  updateRatePlan,
  type RatePlanRow,
  type RoomTypeRow,
} from '@/lib/api';
import { useMarketSegments, usePropertySettings } from '@/lib/queries';
import { rateTypesKey } from './rate-types';
import { roomTypesKey } from './room-types';
import { errorMessage } from './shared';

export const ratePlansKey = (propertyId?: string) => ['config', 'rate-plans', propertyId] as const;

type Audience = RatePlanRow['audience'];
const AUDIENCE: Record<Audience, string> = {
  all: 'Everyone',
  local: 'Residents only',
  foreign: 'Foreign guests only',
};
const NO_SEGMENT = 'none';

/** "Single", "Double", "Triple", "Quad" … or "5 guests". */
export function guestsLabel(n: number): string {
  return ['', 'Single', 'Double', 'Triple', 'Quad'][n] ?? `${n} guests`;
}

/**
 * Yanolja's Rate Plan (Configuration → Rate plans): which room type sells under which rate type,
 * to whom, and in which guest configurations — each one priced on the rates calendar.
 */
export function RatePlansView({ propertyId, canEdit }: { propertyId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ratePlansKey(propertyId);
  const plans = useQuery({ queryKey: key, queryFn: () => listPropertyRatePlans(propertyId) });
  const roomTypes = useQuery({
    queryKey: roomTypesKey(propertyId),
    queryFn: () => listRoomTypes(propertyId),
  });
  const rateTypes = useQuery({
    queryKey: rateTypesKey(propertyId),
    queryFn: () => listRateTypes(propertyId),
  });
  const segments = useMarketSegments();
  const settings = usePropertySettings(propertyId);
  const style = settings.data?.mealCodeStyle ?? 'international';
  const [roomFilter, setRoomFilter] = React.useState('all');
  const [adding, setAdding] = React.useState<RoomTypeRow | null>(null);
  const [switchingOff, setSwitchingOff] = React.useState<RatePlanRow | null>(null);
  const [deleting, setDeleting] = React.useState<RatePlanRow | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: rateTypesKey(propertyId) });
    qc.invalidateQueries({ queryKey: roomTypesKey(propertyId) });
    qc.invalidateQueries({ queryKey: ['room-availability'] });
  };
  const update = useMutation({
    mutationFn: ({
      plan,
      body,
    }: {
      plan: RatePlanRow;
      body: Parameters<typeof updateRatePlan>[1];
      done: string;
    }) => updateRatePlan(plan.id, body),
    onSuccess: (_, { done }) => {
      toast.success(done);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (plan: RatePlanRow) => deleteRatePlan(plan.id),
    onSuccess: (_, plan) => {
      toast.success(
        `${plan.roomName} is no longer sold under ${plan.rateTypeName ?? plan.mealPlanName}`,
      );
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (plans.isLoading || roomTypes.isLoading || rateTypes.isLoading)
    return <Skeleton className="h-64 w-full" />;
  const types = roomTypes.data ?? [];
  if (types.length === 0)
    return (
      <EmptyState
        title="Add a room type first"
        description="A rate plan sells a room type under a rate type."
        action={
          canEdit ? (
            <Button asChild>
              <Link href="/app/configuration/room-types/new">
                <Plus size={16} aria-hidden /> Add room type
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  const allRateTypes = rateTypes.data ?? [];
  const shown = roomFilter === 'all' ? types : types.filter((t) => t.id === roomFilter);
  const planLabel = (p: RatePlanRow) => `${p.roomName} · ${p.rateTypeName ?? p.mealPlanName}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={roomFilter} onValueChange={setRoomFilter}>
          <SelectTrigger aria-label="Room type" className="w-full max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All room types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="outline" asChild>
          <Link href="/app/calendar">
            <CurrencyCircleDollar size={16} aria-hidden /> Rates calendar
          </Link>
        </Button>
      </div>
      {allRateTypes.length === 0 && (
        <InlineAlert
          tone="info"
          className="mb-3"
          title="No rate types yet"
          action={
            canEdit ? (
              <Button size="sm" variant="outline" asChild>
                <Link href="/app/configuration/rate-types/new">Add rate type</Link>
              </Button>
            ) : undefined
          }
        >
          A rate plan sells a room type under a rate type — add one, like Bed and breakfast.
        </InlineAlert>
      )}
      <div className="flex flex-col gap-4">
        {shown.map((room) => {
          const own = (plans.data ?? []).filter((p) => p.roomId === room.id);
          const free = allRateTypes.filter((t) => !own.some((p) => p.rateTypeId === t.id));
          return (
            <Card key={room.id} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
                <Link
                  href={`/app/configuration/room-types/${room.id}`}
                  className="text-sm font-semibold text-ink hover:underline"
                >
                  {room.name}
                </Link>
                {room.shortCode && (
                  <span className="rounded-md border border-line px-1.5 font-mono text-[11px] text-ink-3">
                    {room.shortCode}
                  </span>
                )}
                <span className="text-xs text-ink-3">
                  {room.units} room{room.units === 1 ? '' : 's'}
                </span>
                {room.active === false && <Badge tone="muted">Not sold</Badge>}
                <div className="flex-1" />
                {canEdit && (
                  <Tooltip
                    label={
                      free.length === 0
                        ? allRateTypes.length === 0
                          ? 'Add a rate type first'
                          : 'Sold under every rate type already'
                        : `Sell ${room.name} under another rate type`
                    }
                  >
                    <span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={free.length === 0}
                        onClick={() => setAdding(room)}
                      >
                        <Plus size={14} aria-hidden /> Add rate plan
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </div>
              {own.length === 0 ? (
                <p className="px-4 py-4 text-sm text-ink-3">
                  Not sold under any rate type yet
                  {canEdit && free.length > 0 ? ' — add a rate plan to price it.' : '.'}
                </p>
              ) : (
                <ul>
                  {own.map((p) => (
                    <PlanRow
                      key={p.id}
                      plan={p}
                      maxGuests={Math.max(
                        (room.maxAdults ?? 0) + (room.maxChildren ?? 0),
                        room.maxAdults ?? 0,
                        2,
                      )}
                      canEdit={canEdit}
                      mealCode={displayMealCode(p.mealPlan as never, style)}
                      segments={(segments.data ?? []).filter(
                        (s) => s.active || s.id === p.marketSegmentId,
                      )}
                      busy={update.isPending}
                      onRefresh={refresh}
                      onToggle={(on) =>
                        on
                          ? update.mutate({
                              plan: p,
                              body: { status: 'Active' },
                              done: `${planLabel(p)} is on sale again`,
                            })
                          : setSwitchingOff(p)
                      }
                      onAudience={(audience) =>
                        update.mutate({
                          plan: p,
                          body: { audience },
                          done: `${planLabel(p)} is sold to ${AUDIENCE[audience].toLowerCase()}`,
                        })
                      }
                      onSegment={(marketSegmentId) =>
                        update.mutate({
                          plan: p,
                          body: { marketSegmentId },
                          done: 'Market segment saved',
                        })
                      }
                      onDelete={() => setDeleting(p)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {adding && (
        <AddRatePlanSheet
          propertyId={propertyId}
          room={adding}
          rateTypes={allRateTypes.filter(
            (t) => !(plans.data ?? []).some((p) => p.roomId === adding.id && p.rateTypeId === t.id),
          )}
          segments={(segments.data ?? []).filter((s) => s.active)}
          styleLabel={(plan) => displayMealCode(plan as never, style)}
          onClose={() => setAdding(null)}
          onAdded={refresh}
        />
      )}
      <ConfirmDialog
        open={switchingOff !== null}
        onOpenChange={(open) => !open && setSwitchingOff(null)}
        title={switchingOff ? `Stop selling ${planLabel(switchingOff)}?` : ''}
        description="It is no longer offered for new reservations. Stays already booked on it keep their prices, and you can switch it on again at any time."
        confirmLabel="Stop selling"
        cancelLabel="Keep selling"
        onConfirm={() =>
          switchingOff &&
          update.mutate({
            plan: switchingOff,
            body: { status: 'Inactive' },
            done: `${planLabel(switchingOff)} is no longer sold`,
          })
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${planLabel(deleting)}?` : ''}
        description="Its guest configurations and their prices go with it. A plan that has been booked cannot be deleted — switch it off instead."
        confirmLabel="Delete"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  );
}

function PlanRow({
  plan,
  maxGuests,
  canEdit,
  mealCode,
  segments,
  busy,
  onRefresh,
  onToggle,
  onAudience,
  onSegment,
  onDelete,
}: {
  plan: RatePlanRow;
  maxGuests: number;
  canEdit: boolean;
  mealCode: string;
  segments: Array<{ id: string; name: string }>;
  busy: boolean;
  onRefresh: () => void;
  onToggle: (on: boolean) => void;
  onAudience: (a: Audience) => void;
  onSegment: (id: string | null) => void;
  onDelete: () => void;
}) {
  const booked = plan.occupancies.some((o) => o.booked);
  const unpriced = plan.occupancies.filter((o) => !o.priced).length;
  return (
    <li
      className={cn(
        'flex flex-col gap-3 border-b border-line px-4 py-3 last:border-0',
        plan.status === 'Inactive' && 'bg-surface-2',
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Switch
          aria-label={`Sell ${plan.roomName} under ${plan.rateTypeName ?? plan.mealPlanName}`}
          checked={plan.status === 'Active'}
          disabled={!canEdit || busy}
          onCheckedChange={onToggle}
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {plan.rateTypeName ?? plan.mealPlanName}
          </span>
          {plan.rateTypeCode && (
            <span className="rounded-md border border-line px-1.5 font-mono text-[11px] text-ink-3">
              {plan.rateTypeCode}
            </span>
          )}
          <span className="font-mono text-xs text-ink-2">{mealCode}</span>
          {plan.rateTypeActive === false && (
            <Tooltip label="Switch the rate type on under Rate types to sell this plan">
              <span>
                <Badge tone="muted">Rate type off</Badge>
              </span>
            </Tooltip>
          )}
          {unpriced > 0 && plan.status === 'Active' && (
            <Badge tone="low">
              {unpriced === plan.occupancies.length ? 'No prices yet' : `${unpriced} not priced`}
            </Badge>
          )}
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href={`/app/calendar?room=${plan.roomId}`}>
            <CurrencyCircleDollar size={14} aria-hidden /> Prices
          </Link>
        </Button>
        {canEdit && (
          <Tooltip label={booked ? 'Booked — switch it off instead' : 'Delete this rate plan'}>
            <span>
              <Button
                size="icon"
                variant="outline"
                aria-label={`Delete ${plan.roomName} · ${plan.rateTypeName ?? plan.mealPlanName}`}
                disabled={booked}
                onClick={onDelete}
              >
                <Trash size={15} aria-hidden />
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-[12rem_14rem_minmax(0,1fr)]">
        <Field label="Sold to" htmlFor={`aud-${plan.id}`}>
          <Select
            value={plan.audience}
            disabled={!canEdit || busy}
            onValueChange={(v) => v !== plan.audience && onAudience(v as Audience)}
          >
            <SelectTrigger id={`aud-${plan.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(AUDIENCE) as Audience[]).map((a) => (
                <SelectItem key={a} value={a}>
                  {AUDIENCE[a]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Market segment" htmlFor={`seg-${plan.id}`}>
          <Select
            value={plan.marketSegmentId ?? NO_SEGMENT}
            disabled={!canEdit || busy}
            onValueChange={(v) => {
              const next = v === NO_SEGMENT ? null : v;
              if (next !== plan.marketSegmentId) onSegment(next);
            }}
          >
            <SelectTrigger id={`seg-${plan.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SEGMENT}>From the business source</SelectItem>
              {segments.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-2">Guest configurations</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {plan.occupancies.map((o) => (
              <GuestConfigChip
                key={o.id}
                occ={o}
                maxGuests={maxGuests}
                canEdit={canEdit}
                last={plan.occupancies.length <= 1}
                onChanged={onRefresh}
              />
            ))}
            {canEdit && (
              <AddGuestConfig
                ratePlanId={plan.id}
                maxGuests={maxGuests}
                taken={plan.occupancies.map((o) => o.accommodates)}
                onAdded={onRefresh}
              />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function GuestConfigChip({
  occ,
  maxGuests,
  canEdit,
  last,
  onChanged,
}: {
  occ: RatePlanRow['occupancies'][number];
  maxGuests: number;
  canEdit: boolean;
  last: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState(occ.label);
  const [guests, setGuests] = React.useState(occ.accommodates);
  React.useEffect(() => {
    if (open) {
      setLabel(occ.label);
      setGuests(occ.accommodates);
    }
  }, [open, occ.label, occ.accommodates]);
  const save = useMutation({
    mutationFn: () =>
      updateGuestConfiguration(occ.id, { label: label.trim(), accommodates: guests }),
    onSuccess: () => {
      toast.success(`${label.trim()} is saved`);
      setOpen(false);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteGuestConfiguration(occ.id),
    onSuccess: () => {
      toast.success(`${occ.label} is removed`, { description: 'Its prices went with it.' });
      setOpen(false);
      onChanged();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const chip = (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn('h-1.5 w-1.5 rounded-full', occ.priced ? 'bg-avail' : 'bg-low')}
      />
      {occ.label}
      <span className="inline-flex items-center gap-0.5 font-mono text-ink-3">
        <Users size={11} aria-hidden />
        {occ.accommodates}
      </span>
    </span>
  );
  const chipClass =
    'inline-flex h-7 items-center rounded-full border border-line bg-surface px-2.5 text-xs text-ink-2';
  if (!canEdit)
    return (
      <span className={chipClass} title={occ.priced ? 'Priced' : 'No price yet'}>
        {chip}
      </span>
    );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(chipClass, 'hover:border-ink-3 hover:text-ink')}
          aria-label={`${occ.label}, ${occ.accommodates} guests${occ.priced ? '' : ', no price yet'}. Edit`}
        >
          {chip}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) save.mutate();
          }}
        >
          <Field label="Name" htmlFor={`occ-label-${occ.id}`}>
            <Input
              id={`occ-label-${occ.id}`}
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <Field label="Guests" htmlFor={`occ-guests-${occ.id}`}>
            <NumberStepper
              id={`occ-guests-${occ.id}`}
              value={guests}
              min={1}
              max={Math.max(maxGuests, occ.accommodates)}
              disabled={occ.booked}
              onChange={setGuests}
            />
          </Field>
          {occ.booked && (
            <p className="text-xs text-ink-3">
              Booked, so its number of guests stays — rename it if you like.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Tooltip
              label={
                occ.booked
                  ? 'Booked — it stays'
                  : last
                    ? 'A rate plan needs at least one'
                    : 'Remove this configuration'
              }
            >
              <span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={occ.booked || last}
                  loading={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  <Trash size={14} aria-hidden /> Remove
                </Button>
              </span>
            </Tooltip>
            <div className="flex-1" />
            <Button type="submit" size="sm" loading={save.isPending} disabled={!label.trim()}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AddGuestConfig({
  ratePlanId,
  maxGuests,
  taken,
  onAdded,
}: {
  ratePlanId: string;
  maxGuests: number;
  taken: number[];
  onAdded: () => void;
}) {
  const nextFree = () => {
    for (let n = 1; n <= maxGuests; n++) if (!taken.includes(n)) return n;
    return Math.min(maxGuests + 1, 20);
  };
  const [open, setOpen] = React.useState(false);
  const [guests, setGuests] = React.useState(2);
  const [label, setLabel] = React.useState('');
  const add = useMutation({
    mutationFn: () =>
      addGuestConfiguration(ratePlanId, {
        label: label.trim() || guestsLabel(guests),
        accommodates: guests,
      }),
    onSuccess: () => {
      toast.success(`${label.trim() || guestsLabel(guests)} is added`, {
        description: 'Price it on the rates calendar.',
      });
      setOpen(false);
      onAdded();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          const n = nextFree();
          setGuests(n);
          setLabel(guestsLabel(n));
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7">
          <Plus size={13} aria-hidden /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Guests" htmlFor={`new-occ-guests-${ratePlanId}`}>
            <NumberStepper
              id={`new-occ-guests-${ratePlanId}`}
              value={guests}
              min={1}
              max={20}
              onChange={(n) => {
                if (label === guestsLabel(guests)) setLabel(guestsLabel(n));
                setGuests(n);
              }}
            />
          </Field>
          <Field label="Name" htmlFor={`new-occ-label-${ratePlanId}`}>
            <Input
              id={`new-occ-label-${ratePlanId}`}
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          {taken.includes(guests) && (
            <p className="text-xs text-low-ink">
              This plan already has a {guests}-guest configuration.
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={add.isPending}>
              Add configuration
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AddRatePlanSheet({
  propertyId,
  room,
  rateTypes,
  segments,
  styleLabel,
  onClose,
  onAdded,
}: {
  propertyId: string;
  room: RoomTypeRow;
  rateTypes: Array<{
    id: string;
    name: string;
    shortCode: string;
    mealPlan: string;
    active: boolean;
  }>;
  segments: Array<{ id: string; name: string }>;
  styleLabel: (plan: string) => string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const router = useRouter();
  const most = Math.min(Math.max(room.maxAdults ?? 0, room.baseAdults ?? 0, 2), 8);
  const base = Math.min(Math.max(room.baseAdults ?? 2, 1), most);
  const [rateTypeId, setRateTypeId] = React.useState(
    rateTypes.find((t) => t.active)?.id ?? rateTypes[0]?.id ?? '',
  );
  const [audience, setAudience] = React.useState<Audience>('all');
  const [segment, setSegment] = React.useState(NO_SEGMENT);
  const [guests, setGuests] = React.useState<number[]>([base]);
  const chosen = rateTypes.find((t) => t.id === rateTypeId);

  const add = useMutation({
    mutationFn: () =>
      createPropertyRatePlan(propertyId, {
        roomId: room.id,
        rateTypeId,
        audience,
        marketSegmentId: segment === NO_SEGMENT ? null : segment,
        occupancies: [...guests]
          .sort((a, b) => a - b)
          .map((n) => ({ label: guestsLabel(n), accommodates: n })),
      }),
    onSuccess: () => {
      toast.success(`${room.name} is sold under ${chosen?.name ?? 'the rate type'}`, {
        description: 'Set its prices on the rates calendar.',
        action: {
          label: 'Set prices',
          onClick: () => router.push(`/app/calendar?room=${room.id}`),
        },
      });
      onAdded();
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        title={`Add a rate plan to ${room.name}`}
        description="Sell this room type under a rate type, then price it on the rates calendar."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={add.isPending}
              disabled={!rateTypeId || guests.length === 0}
              onClick={() => add.mutate()}
            >
              Add rate plan
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Rate type" required htmlFor="plan-rate-type">
            <Select value={rateTypeId} onValueChange={setRateTypeId}>
              <SelectTrigger id="plan-rate-type">
                <SelectValue placeholder="Choose a rate type" />
              </SelectTrigger>
              <SelectContent>
                {rateTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} · {styleLabel(t.mealPlan)}
                    {t.active ? '' : ' (switched off)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {chosen && !chosen.active && (
            <InlineAlert tone="warn">
              {chosen.name} is switched off, so this plan is not sold until you switch it on under
              Rate types.
            </InlineAlert>
          )}
          <Field label="Sold to" htmlFor="plan-audience">
            <Select value={audience} onValueChange={(v) => setAudience(v as Audience)}>
              <SelectTrigger id="plan-audience">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIENCE) as Audience[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {AUDIENCE[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Market segment"
            htmlFor="plan-segment"
            hint="A reservation on this plan starts in this segment."
          >
            <Select value={segment} onValueChange={setSegment}>
              <SelectTrigger id="plan-segment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SEGMENT}>From the business source</SelectItem>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-ink">Guest configurations</legend>
            <p className="text-xs text-ink-3">
              The number of guests you price for. You can add more later.
            </p>
            {Array.from({ length: most }, (_, i) => i + 1).map((n) => (
              <label key={n} className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
                <Checkbox
                  checked={guests.includes(n)}
                  onCheckedChange={(c) =>
                    setGuests((g) => (c === true ? [...g, n] : g.filter((x) => x !== n)))
                  }
                />
                {guestsLabel(n)}
                <span className="font-mono text-xs text-ink-3">×{n}</span>
                {n === base && <span className="text-xs text-ink-3">· the room’s base</span>}
              </label>
            ))}
          </fieldset>
        </div>
      </SheetContent>
    </Sheet>
  );
}
