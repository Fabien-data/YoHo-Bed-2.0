'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChatText, DoorOpen, Lock, Plus, Trash } from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Checkbox,
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
  Skeleton,
  StayRangeField,
  TagDot,
  TimePicker,
  Tooltip,
  toast,
  cn,
  type ComboboxOption,
} from '@yohobed/ui';
import { formatDate } from '@yohobed/locale';
import {
  ApiError,
  createReservation,
  getRoomAvailability,
  getUser,
  type BookingOrigin,
  type ReservationKind,
  type Residency,
} from '@/lib/api';
import { useHasFeature, useReservationConfig } from '@/lib/queries';
import { useActiveProperty } from '@/components/active-property';
import { money as formatMoney } from '@/lib/format';
import { isComplete, typedRate, type GuestDraft, type Prefill } from '../composer/draft';
import { LINE_GRID, RoomLine } from '../composer/room-line';
import { GuestFields } from '../composer/guest-fields';
import { ApprovalDialog } from '../composer/approval-dialog';
import { useReservationComposer } from '../composer/composer-context';
import {
  CATEGORY_LABEL,
  explain,
  newIdempotencyKey,
  useLiveQuote,
  type ServerError,
} from '../composer/shared';
import {
  blankFullDraft,
  fromQuickDraft,
  fullCreateBody,
  fullLine,
  fullStayBody,
  paymentMethodsFor,
  residencyOf,
  roomGuestGiven,
  type FullDraft,
  type FullLineDraft,
} from './full-draft';
import { LineExtras, LineExtrasSummary, REMARK_LABEL, RemarksDialog } from './line-extras';
import { GuestProfileFields } from './guest-profile';
import { BillingSummary } from './billing-summary';
import { GroupOptions, QuickGroupPanel, allAvailableLines } from './group-tools';
import { MAX_ROOMS } from './limits';
import { paymentProblems } from '@/components/payments/payment-fields';

const ORIGINS: BookingOrigin[] = ['direct', 'ota', 'travel_agent', 'corporate'];
const AUTO = '__auto';
const NONE = '__none';

function blankRoomGuest(country: string, title: string): GuestDraft {
  return {
    customerId: null,
    title,
    name: '',
    phone: { number: '', country },
    email: '',
    whatsapp: false,
    createNew: false,
  };
}

/**
 * Yanolja's Add Reservation — the full page behind Quick Reservation's "More Options"
 * (Development Phase 02, Sprint 4).
 *
 * Everything Quick Reservation does, plus where the booking came from (booking and business
 * source, travel agent or company, voucher, segment, sales person), Rate Offered, per-room
 * remarks, tasks and child ages, a guest per room, the guest's address, nationality and ID, and
 * the Other Information switches — with the Billing Summary live beside it. One request books it
 * all, so a failure anywhere saves nothing.
 */
export function AddReservation({ prefill }: { prefill: Prefill | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { propertyId } = useActiveProperty();
  const config = useReservationConfig(propertyId);
  const cfg = config.data;
  const canTask = useHasFeature('work_orders');
  const hasCityLedger = useHasFeature('cashiering');
  const { takeHandoff } = useReservationComposer();

  const [draft, setDraft] = React.useState<FullDraft | null>(null);
  const [pristine, setPristine] = React.useState('');
  const [serverError, setServerError] = React.useState<ServerError | null>(null);
  const [approvalOpen, setApprovalOpen] = React.useState(false);
  const [approvedBy, setApprovedBy] = React.useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = React.useState(false);
  const [pendingSubmit, setPendingSubmit] = React.useState(false);
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [remarksOpen, setRemarksOpen] = React.useState(false);
  const [quickGroup, setQuickGroup] = React.useState(false);
  /** Lines "Book all available rooms" added, so unticking it takes them away again. */
  const [bookAllKeys, setBookAllKeys] = React.useState<string[]>([]);
  const [bookAllCapped, setBookAllCapped] = React.useState(false);
  const idempotencyKey = React.useRef(newIdempotencyKey());
  /** Which footer button asked: Reserve, or Check-in (a walk-in, checked in as it is saved). */
  const action = React.useRef<'reserve' | 'check_in'>('reserve');
  const userId = React.useMemo(() => getUser()?.id ?? null, []);

  // The starting draft: what Quick Reservation handed over, or a fresh one.
  React.useEffect(() => {
    if (!cfg || draft) return;
    const handoff = takeHandoff();
    const next = handoff ? fromQuickDraft(handoff, cfg) : blankFullDraft(cfg, prefill);
    setDraft(next);
    setPristine(handoff ? '' : JSON.stringify(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const update = React.useCallback((patch: Partial<FullDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setServerError(null);
  }, []);
  const updateLine = React.useCallback((index: number, patch: Partial<FullLineDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      const lines = d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
      // A changed price needs a fresh approval; an old token would approve a different number.
      const approvals = 'rate' in patch ? {} : d.approvals;
      return { ...d, lines, approvals };
    });
    setServerError(null);
  }, []);

  // Nationality decides resident or foreign, unless the desk said otherwise.
  const nationality = draft?.guest.nationalityCode;
  React.useEffect(() => {
    if (!draft || !cfg || draft.residencyManual) return;
    const r = residencyOf(draft.guest.nationalityCode, cfg.property.countryCode);
    if (r !== draft.residency) update({ residency: r });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nationality]);

  // Leaving the tab with unsaved work asks first.
  const dirty = draft !== null && JSON.stringify(draft) !== pristine;
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const grid = useQuery({
    queryKey: [
      'room-availability',
      propertyId,
      draft?.stay.checkin,
      draft?.stay.checkout,
      draft?.residency,
    ],
    queryFn: () =>
      getRoomAvailability(propertyId!, {
        checkin: draft!.stay.checkin,
        checkout: draft!.stay.checkout,
        residency: draft!.residency,
      }),
    enabled: Boolean(propertyId && draft),
    placeholderData: (prev) => prev,
  });

  // A room chosen before the grid arrived (tape chart, handoff): fill its rate type once it does.
  React.useEffect(() => {
    if (!draft || !grid.data) return;
    draft.lines.forEach((l, i) => {
      if (l.roomId && !l.occupancyId) {
        const rt = grid.data!.roomTypes.find((r) => r.roomId === l.roomId);
        const rate = rt?.rateTypes.find((t) => t.priced) ?? rt?.rateTypes[0];
        if (rate) updateLine(i, { occupancyId: rate.occupancyId });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.data]);

  const stay = draft && propertyId ? fullStayBody(propertyId, draft) : null;
  const { quote, current: quoteCurrent } = useLiveQuote(stay, Boolean(draft));

  const save = useMutation({
    mutationFn: () => {
      const expected = quoteCurrent ? Number(quote.data!.totals.due) : undefined;
      return createReservation(
        fullCreateBody(propertyId!, draft!, expected, {
          checkIn: action.current === 'check_in',
        })!,
        idempotencyKey.current,
      );
    },
    onSuccess: (r) => {
      for (const key of [
        'stayview',
        'reservations',
        'reservation-groups',
        'dashboard',
        'room-availability',
        'guest-search',
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      for (const key of ['folio', 'drawer-sessions', 'cashiering']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      const rooms = r.bookings.length;
      const paid = r.payment
        ? ` · ${formatMoney(r.payment.amount, r.currency)} by ${r.payment.method}${r.payment.receiptNo ? ` (${r.payment.receiptNo})` : ''}`
        : '';
      if (r.checkedIn) {
        const codes = r.bookings.map((b) => b.roomCode).filter(Boolean);
        toast.success(`${r.guest.name} is checked in`, {
          description: `${r.reference} · ${codes.length ? `Room ${codes.join(', ')}` : `${rooms} room${rooms === 1 ? '' : 's'}`}${paid}`,
        });
      } else {
        toast.success(`Reservation ${r.reference} saved`, {
          description: `${r.guest.name} · ${rooms} room${rooms === 1 ? '' : 's'} · ${formatMoney(r.due, r.currency)}${paid}`,
        });
      }
      for (const w of r.warnings) toast.warning(w);
      setPristine(JSON.stringify(draft));
      router.push(
        `/app/reservations?tab=${r.checkedIn ? 'inhouse' : 'upcoming'}&q=${encodeURIComponent(r.reference)}`,
      );
    },
    onError: (e) => {
      setServerError(explain(e));
      if (e instanceof ApiError && (e.data as { reason?: string })?.reason === 'price_changed') {
        qc.invalidateQueries({ queryKey: ['reservation-quote'] });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  });

  React.useEffect(() => {
    if (!pendingSubmit) return;
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

  if (!draft || !cfg) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }

  const currency = grid.data?.currency ?? cfg.property.currency;
  const money = (v: string | number) => formatMoney(v, currency);
  const takesRooms = draft.kind !== 'inquiry' && draft.kind !== 'online_failed';
  const isHold = draft.kind === 'hold_confirm' || draft.kind === 'hold_unconfirm';
  const accountOrigin = draft.origin === 'travel_agent' || draft.origin === 'corporate';
  const account = cfg.accounts.find((a) => a.id === draft.ledgerAccountId) ?? null;
  const canContract = Boolean(account?.hasContractRates) && hasCityLedger;

  const typedLines = draft.lines.filter((l) => typedRate(l) !== null);
  const needsReason =
    Boolean(quote.data?.reasonRequired) ||
    (typedLines.length > 0 && !draft.complimentary) ||
    draft.complimentary ||
    draft.taxExempt.on;
  const needApprovals = (quote.data?.approvalsRequired ?? []).filter((a) => !draft.approvals[a]);
  const guestReady = draft.guest.customerId !== null || draft.guest.name.trim() !== '';
  const linesReady = draft.lines.length > 0 && draft.lines.every(isComplete);
  const soldOutLines = quote.data?.lines.filter((l) => !l.available).map((l) => l.index) ?? [];
  const roomGuestErrors = draft.guestList
    ? draft.lines
        .map((l, i) =>
          i > 0 && l.guest && !roomGuestGiven(l.guest) && (l.guest.email || l.guest.phone.number)
            ? i
            : null,
        )
        .filter((i): i is number => i !== null)
    : [];
  const exemptReady = !draft.taxExempt.on || draft.taxExempt.exemptionId.trim() !== '';
  const reasonReady = !needsReason || draft.priceReason.trim().length >= 3;
  const payMethods = paymentMethodsFor(cfg, draft, hasCityLedger);
  const dueNow = quote.data ? Number(quote.data.totals.due) : null;
  const paymentReady =
    !draft.payment.methodId ||
    (payMethods.some((m) => m.id === draft.payment.methodId) &&
      Object.keys(paymentProblems(draft.payment, payMethods, dueNow)).length === 0);
  const formReady =
    guestReady &&
    linesReady &&
    roomGuestErrors.length === 0 &&
    exemptReady &&
    reasonReady &&
    paymentReady;
  // A walk-in: a confirmed stay that starts on the hotel's today.
  const canCheckIn =
    (draft.kind === 'confirm' || draft.kind === 'hold_confirm') && draft.stay.checkin === cfg.today;
  const ready =
    formReady && quoteCurrent && soldOutLines.length === 0 && needApprovals.length === 0;
  const waitingForPrice = formReady && !quoteCurrent && !quote.isError;
  const lineErrors = serverError?.lines ?? {};

  const pax = draft.lines.reduce(
    (s, l) => ({ adults: s.adults + l.adults, children: s.children + l.children }),
    { adults: 0, children: 0 },
  );
  const nights = Math.max(
    1,
    Math.round((Date.parse(draft.stay.checkout) - Date.parse(draft.stay.checkin)) / 86_400_000),
  );

  const sourceOptions: ComboboxOption[] = cfg.businessSources
    .filter((s) => s.category === draft.origin)
    .map((s) => ({
      value: s.id,
      label: s.name,
      hint: s.shortCode,
      keywords: [s.shortCode],
      prefix: <TagDot color={s.palette} />,
    }));
  const accountOptions: ComboboxOption[] = cfg.accounts
    .filter((a) =>
      draft.origin === 'travel_agent' ? a.type === 'travel_agent' : a.type === 'company',
    )
    .map((a) => ({
      value: a.id,
      label: a.name,
      hint: a.hasContractRates ? `${a.code} · contract` : a.code,
      keywords: [a.code],
    }));

  function setRooms(n: number) {
    setDraft((d) => {
      if (!d) return d;
      const count = Math.max(1, Math.min(MAX_ROOMS, n));
      if (count > d.lines.length) {
        const last = d.lines[d.lines.length - 1];
        return {
          ...d,
          lines: [
            ...d.lines,
            ...Array.from({ length: count - d.lines.length }, () => fullLine(last)),
          ],
        };
      }
      return { ...d, lines: d.lines.slice(0, count) };
    });
  }

  function setOrigin(origin: BookingOrigin) {
    const keepSource = cfg!.businessSources.find(
      (s) => s.id === draft!.businessSourceId && s.category === origin,
    );
    const keepAccount = origin === 'travel_agent' || origin === 'corporate';
    update({
      origin,
      businessSourceId: keepSource ? keepSource.id : null,
      ledgerAccountId: keepAccount ? draft!.ledgerAccountId : null,
      useContractRates: keepAccount ? draft!.useContractRates : false,
    });
  }

  function toggleBookAll(on: boolean) {
    if (!grid.data) return;
    if (on) {
      // Replace a first line nobody has touched yet; keep anything the desk already chose.
      const kept = draft!.lines.filter((l) => l.roomId);
      const added = allAvailableLines(grid.data, kept);
      setBookAllKeys(added.lines.map((l) => l.key));
      setBookAllCapped(added.capped);
      update({
        lines: kept.length + added.lines.length ? [...kept, ...added.lines] : draft!.lines,
      });
    } else {
      const left = draft!.lines.filter((l) => !bookAllKeys.includes(l.key));
      update({ lines: left.length ? left : [fullLine()] });
      setBookAllKeys([]);
      setBookAllCapped(false);
    }
  }

  function leave() {
    if (dirty && !save.isSuccess) setConfirmLeave(true);
    else router.push('/app/reservations');
  }

  function attempt(mode: 'reserve' | 'check_in') {
    setTriedSubmit(true);
    if (save.isPending) return;
    action.current = mode;
    if (ready) save.mutate();
    else if (waitingForPrice) setPendingSubmit(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    attempt('reserve');
  }

  const rateOfferedBox = (
    checked: boolean,
    label: string,
    onChange: (on: boolean) => void,
    opts: { disabled?: boolean; why?: string } = {},
  ) => {
    const box = (
      <label
        className={cn(
          'flex items-center gap-2 text-sm',
          opts.disabled ? 'cursor-not-allowed text-ink-3' : 'cursor-pointer text-ink-2',
        )}
      >
        <Checkbox
          checked={checked}
          disabled={opts.disabled}
          onCheckedChange={(c) => onChange(c === true)}
          aria-label={label}
        />
        {label}
        {opts.disabled && opts.why && <Lock size={12} aria-hidden />}
      </label>
    );
    return opts.disabled && opts.why ? (
      <Tooltip label={opts.why}>
        <span>{box}</span>
      </Tooltip>
    ) : (
      box
    );
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={leave}
          aria-label="Back to reservations"
          className="rounded-lg p-1.5 text-ink-2 transition duration-1 hover:bg-surface-2 hover:text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Add Reservation</h1>
        <span className="text-sm text-ink-3">{cfg.property.name}</span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          id="add-reservation"
          onSubmit={submit}
          noValidate
          className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card"
        >
          {serverError && !serverError.guests && (
            <div className="px-5 pt-5">
              <InlineAlert tone="error">{serverError.message}</InlineAlert>
            </div>
          )}

          {/* Stay · rooms · reservation type */}
          <section className="flex flex-col gap-4 border-b border-line px-5 py-5">
            <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
              <StayRangeField
                value={draft.stay}
                onChange={(stay) => update({ stay })}
                today={cfg.today}
                timeFormat={cfg.settings.timeFormat}
                idPrefix="ar"
              />
              <Field label="Room(s)" htmlFor="ar-rooms" className="w-20">
                <NumberStepper
                  id="ar-rooms"
                  aria-label="Rooms"
                  value={draft.lines.length}
                  min={1}
                  max={MAX_ROOMS}
                  onChange={setRooms}
                />
              </Field>
              <Field label="Reservation type" htmlFor="ar-kind" className="w-56">
                <Select
                  value={draft.kind}
                  onValueChange={(kind) => update({ kind: kind as ReservationKind })}
                >
                  <SelectTrigger id="ar-kind" aria-label="Reservation type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cfg.kinds.map((k) => (
                      <SelectItem
                        key={k.kind}
                        value={k.kind}
                        hint={k.holdsInventory ? undefined : 'no room held'}
                      >
                        <span className="flex items-center gap-2">
                          <TagDot color={k.color} />
                          {k.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {isHold && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-2 p-3">
                <div>
                  <label
                    htmlFor="ar-hold-date"
                    className="mb-1.5 block text-sm font-medium text-ink-2"
                  >
                    Release the rooms on
                  </label>
                  <div className="flex">
                    <DatePicker
                      id="ar-hold-date"
                      aria-label="Hold release date"
                      value={draft.holdDate}
                      today={cfg.calendarToday}
                      min={cfg.calendarToday}
                      attach="right"
                      className="w-36"
                      disabled={draft.holdNever}
                      onChange={(holdDate) => update({ holdDate })}
                    />
                    <TimePicker
                      aria-label="Hold release time"
                      value={draft.holdTime}
                      format={cfg.settings.timeFormat}
                      minuteStep={5}
                      attach="left"
                      className="-ml-px w-32"
                      disabled={draft.holdNever}
                      onChange={(holdTime) => update({ holdTime })}
                    />
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-ink-2">
                  <Checkbox
                    checked={draft.holdNever}
                    onCheckedChange={(c) => update({ holdNever: c === true })}
                    aria-label="Never release automatically"
                  />
                  Never release automatically
                </label>
                <p className="max-w-xs pb-2 text-xs text-ink-3">
                  An unconfirmed hold gives its rooms back at this time, and you are told.
                </p>
              </div>
            )}
          </section>

          {/* Where it came from */}
          <section className="grid grid-cols-1 gap-3 border-b border-line px-5 py-5 sm:grid-cols-2 xl:grid-cols-4">
            <Field label="Booking source" htmlFor="ar-origin">
              <Select value={draft.origin} onValueChange={(v) => setOrigin(v as BookingOrigin)}>
                <SelectTrigger id="ar-origin" aria-label="Booking source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORIGINS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {CATEGORY_LABEL[o]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Business source" htmlFor="ar-source">
              <Combobox
                id="ar-source"
                aria-label="Business source"
                value={draft.businessSourceId}
                onChange={(businessSourceId) => update({ businessSourceId })}
                options={sourceOptions}
                clearable
                emptyText={`No ${CATEGORY_LABEL[draft.origin]} sources. Add them in Configuration.`}
                searchPlaceholder="Search sources…"
              />
            </Field>
            <Field label="Market segment" htmlFor="ar-segment">
              <Select
                value={draft.marketSegmentId ?? AUTO}
                onValueChange={(v) => update({ marketSegmentId: v === AUTO ? null : v })}
              >
                <SelectTrigger id="ar-segment" aria-label="Market segment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO} hint="from the rate or source">
                    Automatic
                  </SelectItem>
                  {cfg.marketSegments.map((s) => (
                    <SelectItem key={s.id} value={s.id} hint={s.code}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sales person" htmlFor="ar-sales">
              <Select
                value={draft.salesPersonId ?? NONE}
                onValueChange={(v) => update({ salesPersonId: v === NONE ? null : v })}
              >
                <SelectTrigger id="ar-sales" aria-label="Sales person">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>-None-</SelectItem>
                  {cfg.salesPersons.map((p) => (
                    <SelectItem key={p.id} value={p.id} hint={p.code}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {accountOrigin && (
              <Field
                label={draft.origin === 'travel_agent' ? 'Travel agent' : 'Company'}
                htmlFor="ar-account"
                className="sm:col-span-2"
              >
                <Combobox
                  id="ar-account"
                  aria-label={draft.origin === 'travel_agent' ? 'Travel agent' : 'Company'}
                  value={draft.ledgerAccountId}
                  onChange={(ledgerAccountId) =>
                    update({ ledgerAccountId, useContractRates: false, approvals: {} })
                  }
                  options={accountOptions}
                  clearable
                  emptyText={
                    hasCityLedger
                      ? 'None yet. Add them under Cashiering → City ledger.'
                      : 'Travel agent and company accounts are part of the Pro plan.'
                  }
                  searchPlaceholder="Search accounts…"
                />
              </Field>
            )}
            {(accountOrigin || draft.origin === 'ota') && (
              <Field
                label={draft.origin === 'ota' ? 'OTA booking ID' : 'Voucher no.'}
                htmlFor="ar-voucher"
              >
                <Input
                  id="ar-voucher"
                  value={draft.voucherNo}
                  maxLength={60}
                  placeholder={draft.origin === 'ota' ? 'e.g. 4127738810' : 'e.g. TA-7781'}
                  onChange={(e) => update({ voucherNo: e.target.value })}
                />
              </Field>
            )}
          </section>

          {/* Rate offered and the rooms */}
          <section className="flex flex-col gap-3 border-b border-line px-5 py-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-sm font-medium text-ink-2">Rate offered:</span>
              {rateOfferedBox(
                draft.useContractRates,
                'Contract',
                (on) =>
                  update({ useContractRates: on, complimentary: on ? false : draft.complimentary }),
                {
                  disabled: !canContract,
                  why: !accountOrigin
                    ? 'Choose a travel agent or company first'
                    : !hasCityLedger
                      ? 'Contract rates are part of the Pro plan'
                      : 'This account has no contract rates here',
                },
              )}
              {rateOfferedBox(bookAllKeys.length > 0, 'Book all available rooms', toggleBookAll, {
                disabled: !grid.data,
              })}
              {rateOfferedBox(quickGroup, 'Quick group booking', setQuickGroup)}
              {rateOfferedBox(draft.complimentary, 'Complimentary room', (on) =>
                update({
                  complimentary: on,
                  useContractRates: on ? false : draft.useContractRates,
                  approvals: {},
                  lines: on ? draft.lines.map((l) => ({ ...l, rate: '' })) : draft.lines,
                }),
              )}
            </div>
            {bookAllCapped && (
              <InlineAlert tone="warn">
                More rooms are free than one reservation can hold; the first {MAX_ROOMS} were added.
              </InlineAlert>
            )}
            {quickGroup && (
              <QuickGroupPanel
                grid={grid.data}
                lines={draft.lines}
                money={money}
                onAdd={(added) => {
                  const kept = draft.lines.filter((l) => l.roomId);
                  update({ lines: [...kept, ...added] });
                  setQuickGroup(false);
                }}
              />
            )}

            <div className="flex flex-col gap-2">
              <div className="hidden items-start gap-1.5 sm:flex" aria-hidden>
                <div
                  className={`${LINE_GRID} min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-2 text-xs font-semibold text-ink-2`}
                >
                  <span>Room type</span>
                  <span>Rate type</span>
                  <span>Room</span>
                  <span>Adult</span>
                  <span>Child</span>
                  <span className="text-right">Rate ({currency}) · tax inc.</span>
                  <span />
                </div>
                <span className="w-6 shrink-0" />
              </div>
              {grid.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                draft.lines.map((l, i) => (
                  <div key={l.key} className="flex flex-col gap-1">
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1">
                        <RoomLine
                          index={i}
                          line={l}
                          lines={draft.lines}
                          grid={grid.data}
                          takesRooms={takesRooms}
                          quote={quote.data?.lines[i]}
                          money={money}
                          error={
                            lineErrors[i] ??
                            (quoteCurrent && soldOutLines.includes(i)
                              ? 'Not enough rooms free'
                              : null)
                          }
                          onChange={(patch) =>
                            updateLine(i, {
                              ...patch,
                              // Fewer children: drop the ages that no longer have a child.
                              ...(patch.children !== undefined && {
                                childAges: l.childAges.slice(0, patch.children),
                              }),
                            })
                          }
                          onRemove={
                            draft.lines.length > 1
                              ? () => update({ lines: draft.lines.filter((_, j) => j !== i) })
                              : undefined
                          }
                        />
                      </div>
                      <LineExtras
                        index={i}
                        line={l}
                        canTask={canTask}
                        stayDates={{
                          checkin: draft.stay.checkin,
                          checkout: draft.stay.checkout,
                          today: cfg.calendarToday,
                        }}
                        transportModes={cfg.transportModes}
                        currency={currency}
                        timeFormat={cfg.settings.timeFormat}
                        onChange={(patch) => updateLine(i, patch)}
                      />
                    </div>
                    <LineExtrasSummary
                      line={l}
                      money={money}
                      onChange={(patch) => updateLine(i, patch)}
                      onRemoveTask={(t) =>
                        updateLine(i, { tasks: l.tasks.filter((_, j) => j !== t) })
                      }
                    />
                  </div>
                ))
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={draft.lines.length >= MAX_ROOMS}
                  onClick={() => setRooms(draft.lines.length + 1)}
                >
                  <Plus size={14} /> Add room
                </Button>
                {draft.lines.length > 1 && (
                  <GroupOptions
                    draft={draft}
                    grid={grid.data}
                    titles={cfg.titles}
                    onDraft={update}
                  />
                )}
                <div className="flex-1" />
                {draft.lines.length > 1 && (
                  <Field label="Group name" htmlFor="ar-group-name" className="w-56">
                    <Input
                      id="ar-group-name"
                      value={draft.groupName}
                      maxLength={120}
                      placeholder={draft.guest.name || 'Defaults to the guest'}
                      onChange={(e) => update({ groupName: e.target.value })}
                    />
                  </Field>
                )}
              </div>
            </div>
            {quote.isError && linesReady && (
              <InlineAlert tone="error">{explain(quote.error).message}</InlineAlert>
            )}
            {triedSubmit && !linesReady && (
              <p className="text-xs font-medium text-closed-ink">
                Choose a room type and rate type for every room.
              </p>
            )}
          </section>

          {/* Guest information */}
          <section className="flex flex-col gap-4 border-b border-line px-5 py-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">
                Guest information
              </h2>
              <label
                className={cn(
                  'flex items-center gap-2 text-sm',
                  draft.lines.length > 1 ? 'cursor-pointer text-ink-2' : 'text-ink-3',
                )}
              >
                <Checkbox
                  checked={draft.guestList}
                  disabled={draft.lines.length < 2}
                  onCheckedChange={(c) => update({ guestList: c === true })}
                  aria-label="Guest list: a guest for each room"
                />
                Guest list
                <span className="text-xs text-ink-3">(a guest for each room)</span>
              </label>
            </div>

            {draft.guestList && draft.lines.length > 1 && (
              <h3 className="text-sm font-semibold text-brand">
                Room 1 · the reservation&apos;s guest
              </h3>
            )}
            <GuestFields
              value={draft.guest}
              onChange={(g) => update({ guest: { ...draft.guest, ...g } })}
              titles={cfg.titles}
              country={cfg.property.countryCode}
              conflict={serverError?.guestLine === undefined ? (serverError?.guests ?? null) : null}
              idPrefix="ar"
            />
            {triedSubmit && !guestReady && (
              <p className="-mt-2 text-xs font-medium text-closed-ink">The guest needs a name.</p>
            )}
            <GuestProfileFields
              value={draft.guest}
              onChange={(guest) => update({ guest })}
              propertyCountry={cfg.property.countryCode}
              residency={draft.residency}
              residencyManual={draft.residencyManual}
              onResidency={(r: Residency) => update({ residency: r, residencyManual: true })}
              today={cfg.calendarToday}
            />

            {draft.guestList &&
              draft.lines.slice(1).map((l, j) => {
                const i = j + 1;
                const value =
                  l.guest ?? blankRoomGuest(cfg.property.countryCode, cfg.titles[0] ?? '');
                return (
                  <div key={l.key} className="flex flex-col gap-2 border-t border-line pt-4">
                    <h3 className="text-sm font-semibold text-brand">
                      Room {i + 1}
                      {l.roomId && grid.data && (
                        <span className="ml-2 font-normal text-ink-3">
                          {grid.data.roomTypes.find((r) => r.roomId === l.roomId)?.name}
                        </span>
                      )}
                    </h3>
                    <GuestFields
                      value={value}
                      onChange={(g) => updateLine(i, { guest: g })}
                      titles={cfg.titles}
                      country={cfg.property.countryCode}
                      conflict={serverError?.guestLine === i ? (serverError.guests ?? null) : null}
                      idPrefix={`ar-room-${i}`}
                      label={`Guest name, room ${i + 1}`}
                    />
                    {roomGuestErrors.includes(i) && triedSubmit && (
                      <p className="text-xs font-medium text-closed-ink">
                        Room {i + 1}&apos;s guest needs a name, or clear their details to book it
                        for the reservation&apos;s guest.
                      </p>
                    )}
                  </div>
                );
              })}
          </section>

          {/* Remarks for the whole reservation */}
          <section className="flex flex-col gap-3 border-b border-line px-5 py-5">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">Remarks</h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRemarksOpen(true)}
              >
                <ChatText size={14} /> Add remark
              </Button>
              <span className="text-xs text-ink-3">
                For every room. A room&apos;s own remarks are in its ⌄ menu.
              </span>
            </div>
            {draft.remarks.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {draft.remarks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge tone="muted" dot={false} className="shrink-0">
                      {REMARK_LABEL[r.type]}
                    </Badge>
                    <span className="min-w-0 flex-1 text-ink">{r.text}</span>
                    <button
                      type="button"
                      aria-label="Remove remark"
                      onClick={() => update({ remarks: draft.remarks.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-ink-3 hover:text-closed-ink"
                    >
                      <Trash size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Other information */}
          <section className="flex flex-col gap-3 px-5 py-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-2">
              Other information
            </h2>
            <OtherInfo draft={draft} onDraft={update} guestEmail={draft.guest.email} />
          </section>
        </form>

        <div className="lg:sticky lg:top-[4.5rem]">
          <BillingSummary
            cfg={cfg}
            draft={draft}
            quote={quote.data}
            current={quoteCurrent}
            loading={quote.isLoading}
            money={money}
            onDraft={update}
            needsReason={needsReason}
            needApprovals={needApprovals}
            approvedBy={approvedBy}
            onApprove={() => setApprovalOpen(true)}
            showErrors={triedSubmit}
            hasCityLedger={hasCityLedger}
            userId={userId}
            methods={payMethods}
          />
        </div>
      </div>

      {/* The action bar stays in reach at the foot of a long form. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-line bg-surface px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-3 shadow-overlay sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-ink-3">
            {nights} night{nights === 1 ? '' : 's'} · {draft.lines.length} room
            {draft.lines.length === 1 ? '' : 's'} · {pax.adults} adult{pax.adults === 1 ? '' : 's'}
            {pax.children > 0 && `, ${pax.children} child${pax.children === 1 ? '' : 'ren'}`}
          </span>
          <span className="font-mono text-base font-bold tabular-nums text-ink">
            {money(quote.data?.totals.due ?? 0)}
          </span>
          <div className="flex-1" />
          <Button type="button" variant="outline" onClick={leave}>
            Cancel
          </Button>
          {takesRooms && (
            <Tooltip
              label={
                canCheckIn
                  ? 'Save and check the guest in now, into the first free room of each type'
                  : `Only a confirmed stay arriving today (${formatDate(cfg.today)}) can be checked in`
              }
            >
              <span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canCheckIn || save.isPending || pendingSubmit}
                  loading={(save.isPending || pendingSubmit) && action.current === 'check_in'}
                  onClick={() => attempt('check_in')}
                >
                  <DoorOpen size={16} /> Check-in
                </Button>
              </span>
            </Tooltip>
          )}
          <Button
            type="submit"
            form="add-reservation"
            loading={(save.isPending || pendingSubmit) && action.current === 'reserve'}
            disabled={save.isPending || pendingSubmit}
          >
            Reserve
          </Button>
        </div>
      </div>

      <RemarksDialog
        open={remarksOpen}
        onOpenChange={setRemarksOpen}
        title="Remarks · every room"
        remarks={draft.remarks}
        onChange={(remarks) => update({ remarks })}
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
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Discard this reservation?"
        description="Nothing has been saved. Leaving now loses what you have entered."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setPristine(JSON.stringify(draft));
          router.push('/app/reservations');
        }}
      />
    </div>
  );
}

function OtherInfo({
  draft,
  onDraft,
  guestEmail,
}: {
  draft: FullDraft;
  onDraft: (patch: Partial<FullDraft>) => void;
  guestEmail: string;
}) {
  const o = draft.other;
  const set = (patch: Partial<FullDraft['other']>) => onDraft({ other: { ...o, ...patch } });
  const box = (checked: boolean, label: string, onChange: (on: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(c) => onChange(c === true)}
        aria-label={label}
      />
      {label}
    </label>
  );
  return (
    <div className="flex flex-col gap-3">
      {box(o.emailVoucher, 'Email booking vouchers', (emailVoucher) =>
        set({
          emailVoucher,
          voucherEmails: emailVoucher && !o.voucherEmails ? guestEmail : o.voucherEmails,
        }),
      )}
      {o.emailVoucher && (
        <Input
          aria-label="Voucher email addresses"
          className="max-w-xl"
          placeholder="Use a comma to add more than one address"
          value={o.voucherEmails}
          onChange={(e) => set({ voucherEmails: e.target.value })}
        />
      )}
      {box(o.sendCheckoutEmail, 'Send email at check-out', (sendCheckoutEmail) =>
        set({ sendCheckoutEmail }),
      )}
      {o.sendCheckoutEmail && (
        <p className="max-w-xl rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
          Thank-you email to the guest or booker on checking out
        </p>
      )}
      {box(o.guestPortalAccess, 'Access to guest portal', (guestPortalAccess) =>
        set({ guestPortalAccess }),
      )}
      {box(o.suppressRateOnGrCard, 'Suppress rate on registration card', (suppressRateOnGrCard) =>
        set({ suppressRateOnGrCard }),
      )}
      {box(
        o.displayInclusionSeparately,
        'Display inclusion separately on folio',
        (displayInclusionSeparately) => set({ displayInclusionSeparately }),
      )}
      <p className="text-xs text-ink-3">
        These are saved with the reservation. Vouchers, the check-out email and the guest page are
        sent once email is connected for the property.
      </p>
    </div>
  );
}
