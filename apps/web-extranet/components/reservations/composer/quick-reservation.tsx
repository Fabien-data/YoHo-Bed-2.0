'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowSquareOut, Plus, ShieldCheck } from '@phosphor-icons/react';
import {
  Button,
  Combobox,
  ConfirmDialog,
  DatePicker,
  Field,
  InlineAlert,
  Input,
  NumberStepper,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Skeleton,
  StayRangeField,
  TagDot,
  TimePicker,
  toast,
  type ComboboxOption,
} from '@yohobed/ui';
import { addDaysIso } from '@yohobed/locale';
import {
  ApiError,
  createReservation,
  getRoomAvailability,
  type GuestMatch,
  type ReservationCreated,
} from '@/lib/api';
import { useReservationConfig } from '@/lib/queries';
import { useUxTask } from '@/lib/ux';
import { useActiveProperty } from '@/components/active-property';
import { money as formatMoney } from '@/lib/format';
import {
  createBody,
  emptyLine,
  isComplete,
  stayBody,
  typedRate,
  type Draft,
  type LineDraft,
  type Prefill,
  type QuickKind,
} from './draft';
import { LINE_GRID, RoomLine } from './room-line';
import { GuestFields } from './guest-fields';
import { ApprovalDialog } from './approval-dialog';
import {
  CATEGORY_LABEL,
  explain,
  localNowPlus,
  newIdempotencyKey,
  useLiveQuote,
  type ServerError,
} from './shared';

const QUICK_KINDS: QuickKind[] = ['confirm', 'inquiry', 'hold_confirm'];

/**
 * Yanolja's Quick Reservation — a half-width sheet that takes a reservation without leaving the
 * screen the desk is on (Development Phase 02, Sprint 3).
 *
 * The price is quoted live as the form changes, by the same pricer that books it, so the total
 * shown is the total saved. Reserve is idempotent per opening of the sheet: a double-click or a
 * lost response cannot book twice.
 */
export function QuickReservationSheet({
  open,
  prefill,
  onOpenChange,
  onCreated,
  onMoreOptions,
}: {
  open: boolean;
  prefill: Prefill | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (r: ReservationCreated) => void;
  /** Carry this draft to the full Add Reservation page. */
  onMoreOptions?: (draft: Draft) => void;
}) {
  const qc = useQueryClient();
  const { propertyId, property } = useActiveProperty();
  const config = useReservationConfig(open ? propertyId : undefined);
  const cfg = config.data;
  // Timed from opening to Reserve (UX-STANDARD budget: new guest ≤ 7C+2T).
  const uxTask = useUxTask('reservation.quick', open);

  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pristine, setPristine] = React.useState<string>('');
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const [approvalOpen, setApprovalOpen] = React.useState(false);
  const [approvedBy, setApprovedBy] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<ServerError | null>(null);
  const [showCoupon, setShowCoupon] = React.useState(false);
  const [triedSubmit, setTriedSubmit] = React.useState(false);
  /** Reserve was pressed while the price was still being re-quoted: book once it lands. */
  const [pendingSubmit, setPendingSubmit] = React.useState(false);
  const idempotencyKey = React.useRef('');

  // A fresh draft each time the sheet opens, from the property's own date and times.
  React.useEffect(() => {
    if (!open || !cfg) return;
    const checkin = prefill?.checkin && prefill.checkin >= cfg.today ? prefill.checkin : cfg.today;
    const hold = localNowPlus(cfg.settings.hold.defaultHours);
    const next: Draft = {
      stay: {
        checkin,
        checkout: addDaysIso(checkin, Math.max(1, prefill?.nights ?? 1)),
        checkinTime: cfg.property.checkinTime.slice(0, 5),
        checkoutTime: cfg.property.checkoutTime.slice(0, 5),
      },
      kind: 'confirm',
      holdDate: hold.date,
      holdTime: hold.time,
      businessSourceId: null,
      lines: [
        { ...emptyLine(), roomId: prefill?.roomId ?? null, roomUnitId: prefill?.roomUnitId ?? '' },
      ],
      guest: {
        customerId: null,
        title: cfg.titles[0] ?? '',
        name: '',
        phone: { number: '', country: cfg.property.countryCode },
        email: '',
        whatsapp: false,
        createNew: false,
      },
      couponCode: '',
      referralCode: '',
      priceReason: '',
      approvals: {},
    };
    setDraft(next);
    setPristine(JSON.stringify(next));
    setServerError(null);
    setApprovedBy(null);
    setShowCoupon(false);
    setTriedSubmit(false);
    setPendingSubmit(false);
    idempotencyKey.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cfg?.property.id]);

  const update = React.useCallback((patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setServerError(null);
  }, []);
  const updateLine = (index: number, patch: Partial<LineDraft>) =>
    setDraft((d) => {
      if (!d) return d;
      const lines = d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
      // A changed price needs a fresh approval; an old token would approve a different number.
      const approvals = 'rate' in patch ? {} : d.approvals;
      return { ...d, lines, approvals };
    });

  // The room grid for these dates.
  const grid = useQuery({
    queryKey: ['room-availability', propertyId, draft?.stay.checkin, draft?.stay.checkout],
    queryFn: () =>
      getRoomAvailability(propertyId!, {
        checkin: draft!.stay.checkin,
        checkout: draft!.stay.checkout,
      }),
    enabled: open && Boolean(propertyId && draft),
    placeholderData: (prev) => prev,
  });

  // A room chosen from the tape chart arrives before the grid does: fill its rate once it lands.
  React.useEffect(() => {
    if (!draft || !grid.data) return;
    const first = draft.lines[0];
    if (first?.roomId && !first.occupancyId) {
      const rt = grid.data.roomTypes.find((r) => r.roomId === first.roomId);
      const rate = rt?.rateTypes.find((t) => t.priced) ?? rt?.rateTypes[0];
      if (rate) updateLine(0, { occupancyId: rate.occupancyId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.data]);

  // The live quote, and whether it is for exactly what the form now says.
  const stay = draft && propertyId ? stayBody(propertyId, draft) : null;
  const { quote, current: quoteCurrent } = useLiveQuote(stay, open);

  const save = useMutation({
    mutationFn: () => {
      const expected = quoteCurrent ? Number(quote.data!.totals.due) : undefined;
      return createReservation(createBody(propertyId!, draft!, expected)!, idempotencyKey.current);
    },
    onSuccess: (r) => {
      for (const key of [
        'stayview',
        'reservations',
        'dashboard',
        'room-availability',
        'guest-search',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      const rooms = r.bookings.length;
      toast.success(`Reservation ${r.reference} saved`, {
        description: `${r.guest.name} · ${rooms} room${rooms === 1 ? '' : 's'} · ${formatMoney(r.due, r.currency)}`,
      });
      uxTask.complete();
      onCreated(r);
      onOpenChange(false);
    },
    onError: (e) => {
      const explained = explain(e);
      setServerError(explained);
      if (e instanceof ApiError && (e.data as { reason?: string })?.reason === 'price_changed') {
        qc.invalidateQueries({ queryKey: ['reservation-quote'] });
      }
    },
  });

  // Book as soon as the price catches up with what the desk last changed.
  React.useEffect(() => {
    if (!pendingSubmit || !draft) return;
    if (quote.isError) {
      setPendingSubmit(false);
      return;
    }
    if (quoteCurrent) {
      setPendingSubmit(false);
      save.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSubmit, quoteCurrent, quote.isError]);

  const currency = grid.data?.currency ?? cfg?.property.currency ?? property?.currency ?? 'LKR';
  const money = (v: string | number) => formatMoney(v, currency);

  if (!draft || !cfg) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent size="half" title="Quick Reservation">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const dirty = JSON.stringify(draft) !== pristine;
  const takesRooms = draft.kind !== 'inquiry';
  const typedLines = draft.lines.filter((l) => typedRate(l) !== null);
  const needsReason = Boolean(quote.data?.reasonRequired) || typedLines.length > 0;
  const needApprovals = (quote.data?.approvalsRequired ?? []).filter((a) => !draft.approvals[a]);
  const guestReady = draft.guest.customerId !== null || draft.guest.name.trim() !== '';
  const linesReady = draft.lines.length > 0 && draft.lines.every(isComplete);
  const soldOutLines = quote.data?.lines.filter((l) => !l.available).map((l) => l.index) ?? [];
  const ready =
    guestReady &&
    linesReady &&
    Boolean(quoteCurrent) &&
    soldOutLines.length === 0 &&
    (!needsReason || draft.priceReason.trim().length >= 3) &&
    needApprovals.length === 0;

  const pax = draft.lines.reduce(
    (s, l) => ({ adults: s.adults + l.adults, children: s.children + l.children }),
    { adults: 0, children: 0 },
  );
  const nights = Math.max(
    1,
    Math.round((Date.parse(draft.stay.checkout) - Date.parse(draft.stay.checkin)) / 86_400_000),
  );

  const kindOptions = cfg.kinds.filter((k) => QUICK_KINDS.includes(k.kind as QuickKind));
  const sourceOptions: ComboboxOption[] = cfg.businessSources.map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.shortCode,
    keywords: [s.shortCode],
    group: CATEGORY_LABEL[s.category] ?? s.category,
    prefix: <TagDot color={s.palette} />,
  }));

  function setRooms(n: number) {
    setDraft((d) => {
      if (!d) return d;
      if (n > d.lines.length) {
        const last = d.lines[d.lines.length - 1];
        return {
          ...d,
          lines: [...d.lines, ...Array.from({ length: n - d.lines.length }, () => emptyLine(last))],
        };
      }
      return { ...d, lines: d.lines.slice(0, Math.max(1, n)) };
    });
  }

  function requestClose(next: boolean) {
    if (next) return onOpenChange(true);
    if (dirty && !save.isPending && !save.isSuccess) setConfirmDiscard(true);
    else onOpenChange(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTriedSubmit(true);
    if (save.isPending) return;
    if (ready) save.mutate();
    else if (waitingForPrice) setPendingSubmit(true);
  }

  const lineErrors = serverError?.lines ?? {};
  // Everything but a fresh price: the desk pressed Reserve a moment after changing something.
  const waitingForPrice =
    guestReady &&
    linesReady &&
    !quoteCurrent &&
    !quote.isError &&
    (!needsReason || draft.priceReason.trim().length >= 3);

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent
          size="half"
          title="Quick Reservation"
          description={`${cfg.property.name} · bookings are priced live from the rate calendar`}
          footer={
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ink-3">
                {nights} night{nights === 1 ? '' : 's'} · {draft.lines.length} room
                {draft.lines.length === 1 ? '' : 's'} · {pax.adults} adult
                {pax.adults === 1 ? '' : 's'}
                {pax.children > 0 && `, ${pax.children} child${pax.children === 1 ? '' : 'ren'}`}
              </span>
              <div className="flex-1" />
              {onMoreOptions && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    onMoreOptions(draft);
                    onOpenChange(false);
                  }}
                >
                  <ArrowSquareOut size={14} />
                  More options
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                form="quick-reservation"
                loading={save.isPending || pendingSubmit}
                disabled={save.isPending || pendingSubmit}
              >
                Reserve
              </Button>
            </div>
          }
        >
          <form id="quick-reservation" onSubmit={submit} className="flex flex-col gap-5" noValidate>
            {/* Stay · rooms · type · source */}
            <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
              <StayRangeField
                value={draft.stay}
                onChange={(stay) => update({ stay })}
                today={cfg.today}
                timeFormat={cfg.settings.timeFormat}
                idPrefix="qr"
              />
              <Field label="Room(s)" htmlFor="qr-rooms" className="w-20">
                <NumberStepper
                  id="qr-rooms"
                  aria-label="Rooms"
                  value={draft.lines.length}
                  min={1}
                  max={50}
                  onChange={setRooms}
                />
              </Field>
              <Field label="Reservation type" htmlFor="qr-kind" className="w-36">
                <Select
                  value={draft.kind}
                  onValueChange={(kind) => update({ kind: kind as QuickKind })}
                >
                  <SelectTrigger id="qr-kind" aria-label="Reservation type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {kindOptions.map((k) => (
                      <SelectItem key={k.kind} value={k.kind}>
                        <span className="flex items-center gap-2">
                          <TagDot color={k.color} />
                          {k.shortLabel}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Business source" htmlFor="qr-source" className="min-w-[12rem] flex-1">
                <Combobox
                  id="qr-source"
                  aria-label="Business source"
                  value={draft.businessSourceId}
                  onChange={(businessSourceId) => update({ businessSourceId })}
                  options={sourceOptions}
                  clearable
                  searchPlaceholder="Search sources…"
                />
              </Field>
            </div>

            {draft.kind === 'hold_confirm' && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-2 p-3">
                <div>
                  <label
                    htmlFor="qr-hold-date"
                    className="mb-1.5 block text-sm font-medium text-ink-2"
                  >
                    Release the rooms on
                  </label>
                  <div className="flex">
                    <DatePicker
                      id="qr-hold-date"
                      aria-label="Hold release date"
                      value={draft.holdDate}
                      today={cfg.calendarToday}
                      min={cfg.calendarToday}
                      attach="right"
                      className="w-36"
                      onChange={(holdDate) => update({ holdDate })}
                    />
                    <TimePicker
                      aria-label="Hold release time"
                      value={draft.holdTime}
                      format={cfg.settings.timeFormat}
                      minuteStep={5}
                      attach="left"
                      className="-ml-px w-32"
                      onChange={(holdTime) => update({ holdTime })}
                    />
                  </div>
                </div>
                <p className="max-w-xs pb-2 text-xs text-ink-3">
                  If the hold is not confirmed by then, its rooms go back on sale automatically and
                  you are told.
                </p>
              </div>
            )}

            {/* The room grid */}
            <div className="flex flex-col gap-2">
              <div
                className={`${LINE_GRID} hidden rounded-lg bg-surface-2 px-2 py-2 text-xs font-semibold text-ink-2 sm:grid`}
                aria-hidden
              >
                <span>Room type</span>
                <span>Rate type</span>
                <span>Room</span>
                <span>Adult</span>
                <span>Child</span>
                <span className="text-right">Rate ({currency}) · tax inc.</span>
                <span />
              </div>
              {grid.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                draft.lines.map((l, i) => (
                  <RoomLine
                    key={l.key}
                    index={i}
                    line={l}
                    lines={draft.lines}
                    grid={grid.data}
                    takesRooms={takesRooms}
                    quote={quote.data?.lines[i]}
                    money={money}
                    error={
                      lineErrors[i] ??
                      (quoteCurrent && soldOutLines.includes(i) ? 'Not enough rooms free' : null)
                    }
                    onChange={(patch) => updateLine(i, patch)}
                    onRemove={
                      draft.lines.length > 1
                        ? () => update({ lines: draft.lines.filter((_, j) => j !== i) })
                        : undefined
                    }
                  />
                ))
              )}
              <div className="mt-1 flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRooms(draft.lines.length + 1)}
                >
                  <Plus size={14} /> Add room
                </Button>
                <button
                  type="button"
                  className="text-xs font-medium text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink"
                  onClick={() => setShowCoupon((s) => !s)}
                >
                  {showCoupon ? 'Hide coupon' : 'Coupon or referral'}
                </button>
                <div className="flex-1" />
                <div className="text-right">
                  <div className="text-xs font-semibold uppercase tracking-wider text-ink-3">
                    Total
                  </div>
                  <div
                    className="font-mono text-lg font-bold tabular-nums text-ink"
                    aria-live="polite"
                    data-testid="qr-total"
                  >
                    {quote.data ? money(quote.data.totals.due) : money(0)}
                  </div>
                  {quote.data && Number(quote.data.totals.taxes) > 0 && (
                    <div className="text-[11px] text-ink-3">
                      incl. taxes {money(quote.data.totals.taxes)}
                    </div>
                  )}
                  {quote.data && Number(quote.data.totals.discount) > 0 && (
                    <div className="text-[11px] text-avail-ink">
                      coupon −{money(quote.data.totals.discount)}
                    </div>
                  )}
                </div>
              </div>
              {showCoupon && (
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                  <Field label="Coupon">
                    <Input
                      value={draft.couponCode}
                      placeholder="SUMMER10"
                      onChange={(e) => update({ couponCode: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="Referral">
                    <Input
                      value={draft.referralCode}
                      placeholder="LANKA"
                      onChange={(e) => update({ referralCode: e.target.value.toUpperCase() })}
                    />
                  </Field>
                </div>
              )}
            </div>

            {quote.isError && linesReady && (
              <InlineAlert tone="error">{explain(quote.error).message}</InlineAlert>
            )}

            {needsReason && (
              <div className="flex flex-col gap-3 rounded-lg border border-brass bg-brass-soft p-3">
                <Field
                  label="Reason for the rate change"
                  required
                  htmlFor="qr-price-reason"
                  error={
                    triedSubmit && draft.priceReason.trim().length < 3
                      ? 'Say why the rate was changed'
                      : undefined
                  }
                >
                  <Input
                    id="qr-price-reason"
                    placeholder="e.g. Repeat guest, long stay"
                    value={draft.priceReason}
                    onChange={(e) => update({ priceReason: e.target.value })}
                  />
                </Field>
                {needApprovals.length > 0 ? (
                  <InlineAlert
                    tone="warn"
                    title="An owner needs to approve this rate"
                    action={
                      <Button type="button" size="sm" onClick={() => setApprovalOpen(true)}>
                        <ShieldCheck size={14} /> Owner approval
                      </Button>
                    }
                  >
                    The discount is more than your limit of{' '}
                    {cfg.settings.rateControl.staffMaxDiscountPct}%.
                  </InlineAlert>
                ) : approvedBy ? (
                  <InlineAlert tone="success">Approved by {approvedBy}.</InlineAlert>
                ) : null}
              </div>
            )}

            {serverError && !serverError.guests && (
              <InlineAlert tone="error">{serverError.message}</InlineAlert>
            )}

            <div className="border-t border-line pt-4">
              <GuestFields
                value={draft.guest}
                onChange={(guest) => update({ guest })}
                titles={cfg.titles}
                country={cfg.property.countryCode}
                conflict={serverError?.guests ?? null}
              />
              {triedSubmit && !guestReady && (
                <p className="mt-2 text-xs font-medium text-closed-ink">The guest needs a name.</p>
              )}
              {triedSubmit && !linesReady && (
                <p className="mt-2 text-xs font-medium text-closed-ink">
                  Choose a room type and rate type for every room.
                </p>
              )}
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard this reservation?"
        description="Nothing has been saved. Closing now loses what you have entered."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => onOpenChange(false)}
      />

      <ApprovalDialog
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        actions={needApprovals}
        reason={draft.priceReason}
        onApproved={(tokens, approver) => {
          setDraft((d) => (d ? { ...d, approvals: { ...d.approvals, ...tokens } } : d));
          setApprovedBy(approver);
        }}
      />
    </>
  );
}

export type { GuestMatch };
