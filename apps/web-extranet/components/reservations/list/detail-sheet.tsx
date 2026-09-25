'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AirplaneLanding,
  AirplaneTakeoff,
  ChatText,
  ClipboardText,
  Copy,
  Crown,
  Envelope,
  ForkKnife,
  IdentificationCard,
  Link as LinkIcon,
  Plus,
  Receipt,
  Trash,
  UserPlus,
  WhatsappLogo,
} from '@phosphor-icons/react';
import {
  Badge,
  Button,
  Field,
  InlineAlert,
  Input,
  PhoneInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
  type PhoneValue,
} from '@yohobed/ui';
import { ID_DOCUMENT_LABELS, displayMealCode, formatDate, idTypesFor } from '@yohobed/locale';
import Link from 'next/link';
import {
  ApiError,
  createProforma,
  createVoucherLink,
  getUser,
  issueBookingInvoice,
  listInvoices,
  previewVoucher,
  revokeVoucherLink,
  sendVoucher,
  addBookingGuest,
  addBookingInclusion,
  addBookingRemark,
  addBookingTask,
  addBookingTransfer,
  addGuestDocument,
  deleteBookingRemark,
  deleteGuestDocument,
  getBookingGuests,
  getBookingInclusions,
  getBookingRemarks,
  getBookingTasks,
  getBookingTransfers,
  getGuestDocuments,
  removeBookingGuest,
  removeBookingInclusion,
  setBookingVip,
  updateBookingTransfer,
  type BookingTransfer,
  type IdDocumentType,
  type RemarkType,
  type ReservationConfig,
  type ReservationRow,
  type TaskDepartment,
  type TaskTrigger,
  type TransferStatus,
} from '@/lib/api';
import { useHasFeature, useTenantRole } from '@/lib/queries';
import { FolioPanel } from '@/components/folio/folio-panel';
import {
  DEPARTMENT_LABEL,
  DIRECTION_LABEL,
  InclusionDialog,
  REMARK_LABEL,
  RHYTHM_LABEL,
  TRIGGER_LABEL,
  TransferDialog,
} from '../full/line-extras';
import { Pax, StatusChip, StayWhen, bookedAt } from './bits';
import { RowActions, useInvalidateReservations } from './row-actions';
import { DeskActionBar } from '@/components/booking/desk-action-bar';
import { SectionTick } from '../section-tick';

const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : 'That did not work. Try again.';

/**
 * One reservation, opened from the list: the stay, the money, and what hangs off it — the other
 * guests in the room, remarks, tasks and the guest's ID documents — each editable here. The folio
 * is a tab away for plans that have one.
 */
export function ReservationDetailSheet({
  row,
  cfg,
  money,
  onClose,
  onCard,
  initialTab = 'details',
}: {
  row: ReservationRow | null;
  cfg: ReservationConfig;
  money: (v: string | number) => string;
  onClose: () => void;
  onCard: (id: string) => void;
  initialTab?: 'details' | 'folio';
}) {
  const hasFolio = useHasFeature('folio');
  return (
    <Sheet open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        size="wide"
        title={row ? `Reservation ${row.reference}` : 'Reservation'}
        description={
          row
            ? `${row.guestName} · ${formatDate(row.checkin)} → ${formatDate(row.checkout)}`
            : undefined
        }
      >
        {row && (
          <Tabs
            key={`${row.id}:${initialTab}`}
            defaultValue={initialTab === 'folio' && hasFolio ? 'folio' : 'details'}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              {hasFolio && <TabsTrigger value="folio">Folio</TabsTrigger>}
            </TabsList>
            <TabsContent value="details">
              <Details
                row={row}
                cfg={cfg}
                money={money}
                onCard={() => onCard(row.id)}
                onClose={onClose}
              />
            </TabsContent>
            {hasFolio && (
              <TabsContent value="folio">
                <FolioPanel bookingId={row.id} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({
  row,
  cfg,
  money,
  onCard,
  onClose,
}: {
  row: ReservationRow;
  cfg: ReservationConfig;
  money: (v: string | number) => string;
  onCard: () => void;
  onClose: () => void;
}) {
  const booked = bookedAt(row.createdAt, cfg.property.timezone);
  const due = Number(row.balance) > 0.004;
  const refresh = useInvalidateReservations();
  // A VIP stay is a label the desk puts on the reservation (owner brief, 2026-09-26).
  const vip = useMutation({
    mutationFn: (on: boolean) => setBookingVip(row.id, on),
    onSuccess: (r) => {
      refresh();
      toast.success(r.vip ? `${row.reference} is a VIP stay` : `${row.reference} is no longer VIP`);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const live = row.status !== 'Cancelled' && row.status !== 'Rejected';
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip row={row} kinds={cfg.kinds} />
          {row.vip && (
            <Badge tone="brass" dot={false}>
              <Crown size={12} weight="fill" aria-hidden /> {row.vipStay ? 'VIP stay' : 'VIP guest'}
            </Badge>
          )}
          {live && (
            <Button
              variant="ghost"
              size="sm"
              loading={vip.isPending}
              onClick={() => vip.mutate(!row.vipStay)}
            >
              <Crown size={14} weight={row.vipStay ? 'fill' : 'regular'} aria-hidden />
              {row.vipStay ? 'Remove VIP' : 'Mark VIP'}
            </Button>
          )}
        </div>
        <RowActions row={row} today={cfg.today} onCard={onCard} />
      </div>
      <DeskActionBar
        status={row.status}
        booking={{
          id: row.id,
          reference: row.reference,
          guestName: row.guestName,
          checkin: row.checkin,
          checkout: row.checkout,
        }}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <Item label="Arrival">
          <StayWhen
            date={row.checkin}
            time={row.arrivalTime}
            fallback={cfg.property.checkinTime}
            format={cfg.settings.timeFormat}
          />
        </Item>
        <Item label="Departure">
          <StayWhen
            date={row.checkout}
            time={row.departureTime}
            fallback={cfg.property.checkoutTime}
            format={cfg.settings.timeFormat}
          />
        </Item>
        <Item label="Room">
          <span className="text-ink">
            {row.roomCodes.length ? row.roomCodes.join(', ') : 'Unassigned'}
          </span>
          <span className="block text-xs text-ink-3">
            {row.roomTypeName}
            {row.rateCode && ` · ${displayMealCode(row.rateCode, cfg.settings.mealCodeStyle)}`}
          </span>
        </Item>
        <Item label="Guests">
          <Pax adults={row.adults} children={row.children} />
        </Item>
        <Item label="Source">
          <span className="text-ink">{row.sourceName ?? row.channel ?? row.source}</span>
          {row.segmentName && <span className="block text-xs text-ink-3">{row.segmentName}</span>}
        </Item>
        <Item label="Voucher">{row.voucherNo ?? '—'}</Item>
        <Item label="Taken">
          <span className="text-ink">{row.createdByName ?? '—'}</span>
          <span className="block font-mono text-xs text-ink-3">
            {booked.date} {booked.time}
          </span>
        </Item>
        <Item label="Group">{row.groupCode ?? '—'}</Item>
      </dl>

      <dl className="grid grid-cols-3 gap-3 rounded-lg bg-surface-2 px-4 py-3 text-sm">
        <Item label="Total">
          <span className="font-mono tabular-nums text-ink">{money(row.total)}</span>
        </Item>
        <Item label="Paid">
          <span className="font-mono tabular-nums text-ink">{money(row.paid)}</span>
        </Item>
        <Item label="Balance">
          <span
            className={`font-mono tabular-nums ${due ? 'font-semibold text-closed-ink' : 'text-ink'}`}
          >
            {money(row.balance)}
          </span>
        </Item>
      </dl>

      <GuestsBlock bookingId={row.id} country={cfg.property.countryCode} />
      <StayServicesBlock row={row} cfg={cfg} money={money} />
      <VoucherBlock row={row} />
      <InvoicesBlock row={row} />
      <RemarksBlock bookingId={row.id} />
      <TasksBlock bookingId={row.id} />
      <DocumentsBlock
        customerId={row.customerId}
        country={cfg.property.countryCode}
        required={cfg.settings.requireDocumentsAtCheckin}
      />
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function Block({
  icon,
  title,
  tick,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  /** The section's completion tick (owner brief, 2026-09-26). */
  tick?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
        {icon}
        {title}
        {tick}
      </h3>
      {children}
    </section>
  );
}

function GuestsBlock({ bookingId, country }: { bookingId: string; country: string }) {
  const refresh = useInvalidateReservations();
  const guests = useQuery({
    queryKey: ['booking-extras', bookingId, 'guests'],
    queryFn: () => getBookingGuests(bookingId),
  });
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState<PhoneValue>({ number: '', country });
  const add = useMutation({
    mutationFn: () =>
      addBookingGuest(bookingId, {
        name: name.trim(),
        ...(phone.number.trim() ? { phone: phone.number.trim() } : {}),
      }),
    onSuccess: () => {
      setName('');
      setPhone({ number: '', country });
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (customerId: string) => removeBookingGuest(bookingId, customerId),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  // The guest the stay is booked for: a name, a way to reach them, and a nationality.
  const primary = guests.data?.primary;
  const missing = primary
    ? [
        !(primary.phone || primary.email) && 'phone or email',
        !primary.nationalityCode && 'nationality',
      ].filter((m): m is string => Boolean(m))
    : ['the guest'];
  return (
    <Block
      icon={<UserPlus size={16} />}
      title="Guests in the room"
      tick={
        guests.isLoading ? null : (
          <SectionTick
            done={missing.length === 0}
            todo={`Add ${missing.join(', ')}`}
            hint="A complete guest has a name, a phone or email, and a nationality. Fill them in on the guest's profile."
          />
        )
      }
    >
      {guests.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {guests.data?.primary && (
            <li className="flex items-center gap-2">
              <span className="text-ink">{guests.data.primary.name}</span>
              <Badge tone="brand" dot={false}>
                Booked for
              </Badge>
            </li>
          )}
          {guests.data?.others.map((g) => (
            <li key={g.id} className="flex items-center gap-2">
              <span className="text-ink">{g.name}</span>
              {g.phone && <span className="text-xs text-ink-3">{g.phone}</span>}
              <button
                type="button"
                aria-label={`Remove ${g.name}`}
                onClick={() => remove.mutate(g.id)}
                className="ml-auto rounded p-1 text-ink-3 hover:text-closed-ink"
              >
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Field
          label="Add a guest"
          htmlFor={`bg-name-${bookingId}`}
          className="min-w-[12rem] flex-1"
        >
          <Input
            id={`bg-name-${bookingId}`}
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="w-56">
          <PhoneInput value={phone} onChange={setPhone} aria-label="Mobile" />
        </div>
        <Button type="submit" variant="outline" disabled={!name.trim()} loading={add.isPending}>
          Add
        </Button>
      </form>
    </Block>
  );
}

const TRANSFER_STATUS: Record<
  TransferStatus,
  { label: string; tone: 'muted' | 'avail' | 'closed' }
> = {
  planned: { label: 'Planned', tone: 'muted' },
  done: { label: 'Done · charged', tone: 'avail' },
  cancelled: { label: 'Cancelled', tone: 'closed' },
};

/**
 * What the stay includes besides the room: inclusions night audit posts, and pick-ups and
 * drop-offs, charged to the guest when marked done (Development Phase 02, Sprint 5).
 */
function StayServicesBlock({
  row,
  cfg,
  money,
}: {
  row: ReservationRow;
  cfg: ReservationConfig;
  money: (v: string | number) => string;
}) {
  const refresh = useInvalidateReservations();
  const [panel, setPanel] = React.useState<'inclusion' | 'transfer' | null>(null);
  const inclusions = useQuery({
    queryKey: ['booking-extras', row.id, 'inclusions'],
    queryFn: () => getBookingInclusions(row.id),
  });
  const transfers = useQuery({
    queryKey: ['booking-extras', row.id, 'transfers'],
    queryFn: () => getBookingTransfers(row.id),
  });
  const open = row.status === 'Pending' || row.status === 'Approved' || row.status === 'CheckedIn';
  const addInclusion = useMutation({
    mutationFn: (body: Parameters<typeof addBookingInclusion>[1]) =>
      addBookingInclusion(row.id, body),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  const removeInclusion = useMutation({
    mutationFn: removeBookingInclusion,
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  const addTransfer = useMutation({
    mutationFn: (body: Parameters<typeof addBookingTransfer>[1]) =>
      addBookingTransfer(row.id, body),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  const setStatus = useMutation({
    mutationFn: ({ t, status }: { t: BookingTransfer; status: TransferStatus }) =>
      updateBookingTransfer(t.id, { status }),
    onSuccess: (t) => {
      toast.success(
        t.status === 'done'
          ? `${DIRECTION_LABEL[t.direction]} done${Number(t.amount) > 0 ? ` · ${money(t.amount)} on the bill` : ''}`
          : `${DIRECTION_LABEL[t.direction]} cancelled`,
      );
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const empty = !inclusions.data?.length && !transfers.data?.length;

  return (
    <Block icon={<ForkKnife size={16} />} title="Inclusions and transfers">
      {inclusions.isLoading || transfers.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : empty ? (
        <p className="text-sm text-ink-3">No inclusions, pick-ups or drop-offs.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {inclusions.data?.map((inc) => (
            <li key={inc.id} className="flex flex-wrap items-center gap-2">
              <ForkKnife size={14} className="text-ink-3" aria-hidden />
              <span className="text-ink">{inc.name}</span>
              <span className="text-xs text-ink-3">
                {RHYTHM_LABEL[inc.rhythm]} ·{' '}
                {inc.includedInRate ? 'in the room rate' : money(inc.unitPrice)}
                {Number(inc.discountPct) > 0 && ` · ${Number(inc.discountPct)}% off`}
              </span>
              {open && (
                <button
                  type="button"
                  aria-label={`Stop ${inc.name}`}
                  onClick={() => removeInclusion.mutate(inc.id)}
                  className="ml-auto rounded p-1 text-ink-3 hover:text-closed-ink"
                >
                  <Trash size={14} />
                </button>
              )}
            </li>
          ))}
          {transfers.data?.map((t) => {
            const st = TRANSFER_STATUS[t.status];
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                {t.direction === 'pickup' ? (
                  <AirplaneLanding size={14} className="text-ink-3" aria-hidden />
                ) : (
                  <AirplaneTakeoff size={14} className="text-ink-3" aria-hidden />
                )}
                <span className="text-ink">
                  {DIRECTION_LABEL[t.direction]}
                  {t.modeName && ` · ${t.modeName}`}
                </span>
                <span className="text-xs text-ink-3">
                  {t.scheduledAt ? new Date(t.scheduledAt).toLocaleString() : 'time to confirm'}
                  {t.flightNo && ` · ${t.flightNo}`}
                  {(t.fromPlace || t.toPlace) && ` · ${t.fromPlace ?? t.toPlace}`}
                  {' · '}
                  {Number(t.amount) > 0 ? money(t.amount) : 'free'}
                </span>
                <Badge tone={st.tone} dot={false}>
                  {st.label}
                </Badge>
                <span className="ml-auto flex gap-1.5">
                  {t.status === 'planned' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      loading={setStatus.isPending && setStatus.variables?.t.id === t.id}
                      onClick={() => setStatus.mutate({ t, status: 'done' })}
                    >
                      Mark done
                    </Button>
                  )}
                  {t.status !== 'cancelled' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setStatus.mutate({ t, status: 'cancelled' })}
                    >
                      Cancel
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPanel('inclusion')}>
            <Plus size={14} /> Inclusion
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPanel('transfer')}>
            <Plus size={14} /> Pick-up / drop-off
          </Button>
        </div>
      )}
      <InclusionDialog
        open={panel === 'inclusion'}
        onOpenChange={(o) => setPanel(o ? 'inclusion' : null)}
        roomNumber={row.siblingIndex ?? 1}
        inclusions={[]}
        currency={row.currency}
        onChange={(next) => {
          const added = next[next.length - 1];
          if (added) addInclusion.mutate(added);
          setPanel(null);
        }}
      />
      <TransferDialog
        open={panel === 'transfer'}
        onOpenChange={(o) => setPanel(o ? 'transfer' : null)}
        roomNumber={row.siblingIndex ?? 1}
        transfers={[]}
        stayDates={{ checkin: row.checkin, checkout: row.checkout, today: cfg.calendarToday }}
        transportModes={cfg.transportModes}
        currency={row.currency}
        timeFormat={cfg.settings.timeFormat}
        onChange={(next) => {
          const added = next[next.length - 1];
          if (added) addTransfer.mutate(added);
        }}
      />
    </Block>
  );
}

/**
 * The booking voucher (Development Phase 02, Sprint 6): email it, or share the guest's own page —
 * the link a guest opens with no login, over WhatsApp or however they were reached.
 */
function VoucherBlock({ row }: { row: ReservationRow }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState('');
  const voucher = useQuery({
    queryKey: ['voucher', row.id],
    queryFn: () => previewVoucher(row.id),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['voucher', row.id] });

  React.useEffect(() => {
    if (open && voucher.data && !to) setTo(voucher.data.recipients.join(', '));
  }, [open, voucher.data, to]);

  const send = useMutation({
    mutationFn: () =>
      sendVoucher(
        row.id,
        to
          .split(/[,;\s]+/)
          .map((e) => e.trim())
          .filter(Boolean),
      ),
    onSuccess: (r) => {
      toast.success(`Voucher sent to ${r.queued} address${r.queued === 1 ? '' : 'es'}`);
      setOpen(false);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const makeLink = useMutation({
    mutationFn: () => createVoucherLink(row.id),
    onSuccess: (r) => {
      navigator.clipboard?.writeText(r.url).catch(() => undefined);
      toast.success(r.created ? 'Guest link created and copied' : 'Guest link copied');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const revoke = useMutation({
    mutationFn: () => revokeVoucherLink(row.id),
    onSuccess: () => {
      toast.success('Guest link closed');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const link = voucher.data?.link ?? null;
  return (
    <Block icon={<Envelope size={16} />} title="Voucher and guest page">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Envelope size={14} /> Send voucher
        </Button>
        {link ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(link.url).catch(() => undefined);
                toast.success('Guest link copied');
              }}
            >
              <Copy size={14} /> Copy guest link
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={revoke.isPending}
              onClick={() => revoke.mutate()}
            >
              Close link
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            loading={makeLink.isPending}
            onClick={() => makeLink.mutate()}
          >
            <LinkIcon size={14} /> Create guest link
          </Button>
        )}
        {voucher.data && (
          <a
            href={voucher.data.whatsappUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1.5 text-sm text-ink-2 transition duration-1 hover:border-ink-3 hover:text-ink"
          >
            <WhatsappLogo size={14} /> WhatsApp
          </a>
        )}
      </div>
      {link && (
        <p className="text-xs text-ink-3">
          The guest page is open until {formatDate(link.expiresAt.slice(0, 10))}.
        </p>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          title="Send the booking voucher"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button loading={send.isPending} disabled={!to.trim()} onClick={() => send.mutate()}>
                Send
              </Button>
            </div>
          }
        >
          {voucher.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="flex flex-col gap-4">
              <Field
                label="To"
                hint="One email per line or separated by commas; each gets its own email."
              >
                <Textarea rows={2} value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Field label="Subject">
                <Input readOnly value={voucher.data?.subject ?? ''} />
              </Field>
              <Field label="Message" hint="Edit the wording under Comms → Templates.">
                <Textarea
                  rows={14}
                  readOnly
                  value={voucher.data?.body ?? ''}
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </Block>
  );
}

/** The documents issued for this booking, and the two the desk can raise from here. */
function InvoicesBlock({ row }: { row: ReservationRow }) {
  const qc = useQueryClient();
  const documents = useQuery({
    queryKey: ['invoices', 'booking', row.id],
    queryFn: () => listInvoices({ bookingId: row.id }),
  });
  const done = (label: string) => (doc: { id: string; number: string }) => {
    toast.success(`${label} ${doc.number} issued`);
    qc.invalidateQueries({ queryKey: ['invoices'] });
  };
  const proforma = useMutation({
    mutationFn: () => createProforma(row.id),
    onSuccess: done('Pro-forma'),
    onError: (e) => toast.error(errorText(e)),
  });
  const invoice = useMutation({
    mutationFn: () => issueBookingInvoice(row.id),
    onSuccess: (r) => done('Invoice')(r.documents[0]!),
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Block icon={<Receipt size={16} />} title="Invoices">
      {documents.data?.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {documents.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <Link
                href={`/app/invoices/${d.id}`}
                className="font-mono text-ink underline-offset-2 hover:underline"
              >
                {d.number}
              </Link>
              <Badge tone={d.creditedAt ? 'closed' : 'muted'} dot={false}>
                {d.creditedAt ? 'credited' : d.title.toLowerCase()}
              </Badge>
              <span className="text-xs text-ink-3">
                {formatDate(d.invoiceDate ?? d.issuedAt.slice(0, 10))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !documents.isLoading && <p className="text-sm text-ink-3">Nothing issued yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={invoice.isPending}
          onClick={() => invoice.mutate()}
        >
          <Receipt size={14} /> Invoice
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={proforma.isPending}
          onClick={() => proforma.mutate()}
        >
          Pro-forma
        </Button>
      </div>
    </Block>
  );
}

function RemarksBlock({ bookingId }: { bookingId: string }) {
  const refresh = useInvalidateReservations();
  const me = getUser()?.id;
  const role = useTenantRole();
  const remarks = useQuery({
    queryKey: ['booking-extras', bookingId, 'remarks'],
    queryFn: () => getBookingRemarks(bookingId),
  });
  const [type, setType] = React.useState<RemarkType>('general');
  const [text, setText] = React.useState('');
  const add = useMutation({
    mutationFn: () => addBookingRemark(bookingId, { type, text: text.trim() }),
    onSuccess: () => {
      setText('');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteBookingRemark(id),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Block icon={<ChatText size={16} />} title="Remarks">
      {remarks.data?.length ? (
        <ul className="flex flex-col gap-2">
          {remarks.data.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-sm">
              <Badge tone="muted" dot={false} className="shrink-0">
                {REMARK_LABEL[r.type]}
              </Badge>
              <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink">
                {r.text}
                <span className="block text-xs text-ink-3">
                  {r.createdByName ?? 'Someone'} · {new Date(r.createdAt).toLocaleString()}
                </span>
              </span>
              {(role === 'OWNER' || r.createdByUserId === me) && (
                <button
                  type="button"
                  aria-label="Delete remark"
                  onClick={() => remove.mutate(r.id)}
                  className="rounded p-1 text-ink-3 hover:text-closed-ink"
                >
                  <Trash size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        !remarks.isLoading && <p className="text-sm text-ink-3">No remarks yet.</p>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <div className="flex flex-wrap gap-2">
          <Select value={type} onValueChange={(v) => setType(v as RemarkType)}>
            <SelectTrigger aria-label="Remark type" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(REMARK_LABEL) as RemarkType[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {REMARK_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            aria-label="Remark"
            rows={1}
            maxLength={1000}
            className="min-w-[14rem] flex-1"
            placeholder="Add a remark"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!text.trim()} loading={add.isPending}>
            Add
          </Button>
        </div>
      </form>
    </Block>
  );
}

function TasksBlock({ bookingId }: { bookingId: string }) {
  const canTask = useHasFeature('work_orders');
  const refresh = useInvalidateReservations();
  const tasks = useQuery({
    queryKey: ['booking-extras', bookingId, 'tasks'],
    queryFn: () => getBookingTasks(bookingId),
    enabled: canTask,
  });
  const [title, setTitle] = React.useState('');
  const [department, setDepartment] = React.useState<TaskDepartment>('housekeeping');
  const [trigger, setTrigger] = React.useState<TaskTrigger>('instant');
  const add = useMutation({
    mutationFn: () => addBookingTask(bookingId, { title: title.trim(), department, trigger }),
    onSuccess: () => {
      setTitle('');
      refresh();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  if (!canTask) {
    return (
      <Block icon={<ClipboardText size={16} />} title="Tasks">
        <p className="text-sm text-ink-3">Tasks for other departments are part of the Pro plan.</p>
      </Block>
    );
  }
  return (
    <Block icon={<ClipboardText size={16} />} title="Tasks">
      {tasks.data?.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {tasks.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2">
              <span className="text-ink">{t.title}</span>
              <Badge tone="muted" dot={false}>
                {DEPARTMENT_LABEL[t.department]}
              </Badge>
              <span className="text-xs text-ink-3">
                {TRIGGER_LABEL[t.trigger]}
                {t.deadline && ` · by ${formatDate(t.deadline)}`} · {t.status.replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        !tasks.isLoading && <p className="text-sm text-ink-3">No tasks.</p>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) add.mutate();
        }}
      >
        <Input
          aria-label="Task"
          placeholder="e.g. Airport pick-up at 6 AM"
          className="min-w-[14rem] flex-1"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Select value={department} onValueChange={(v) => setDepartment(v as TaskDepartment)}>
          <SelectTrigger aria-label="Department" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DEPARTMENT_LABEL) as TaskDepartment[]).map((k) => (
              <SelectItem key={k} value={k}>
                {DEPARTMENT_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={trigger} onValueChange={(v) => setTrigger(v as TaskTrigger)}>
          <SelectTrigger aria-label="Due" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TRIGGER_LABEL) as TaskTrigger[]).map((k) => (
              <SelectItem key={k} value={k}>
                {TRIGGER_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline" disabled={!title.trim()} loading={add.isPending}>
          Add
        </Button>
      </form>
    </Block>
  );
}

function DocumentsBlock({
  customerId,
  country,
  required,
}: {
  customerId: string;
  country: string;
  /** The hotel refuses check-in without one. */
  required: boolean;
}) {
  const refresh = useInvalidateReservations();
  const docs = useQuery({
    queryKey: ['booking-extras', customerId, 'documents'],
    queryFn: () => getGuestDocuments(customerId),
  });
  // The hotel's local documents, then a foreigner's (passport first): the guest could be either.
  const types = Array.from(new Set([...idTypesFor(country, null), ...idTypesFor(country, 'XX')]));
  const [type, setType] = React.useState<IdDocumentType | ''>('');
  const [number, setNumber] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      addGuestDocument(customerId, {
        type: type as IdDocumentType,
        number: number.trim(),
        verification: 'original',
        isPrimary: !docs.data?.length,
      }),
    onSuccess: () => {
      setNumber('');
      setError(null);
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteGuestDocument(id),
    onSuccess: refresh,
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Block
      icon={<IdentificationCard size={16} />}
      title="ID documents"
      tick={
        docs.isLoading ? null : (
          <SectionTick
            done={(docs.data?.length ?? 0) > 0}
            doneLabel="Recorded"
            todo={required ? 'Needed before check-in' : 'None yet'}
            required={required}
          />
        )
      }
    >
      {docs.data?.length ? (
        <ul className="flex flex-col gap-1.5 text-sm">
          {docs.data.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2">
              <span className="text-ink">{ID_DOCUMENT_LABELS[d.type]}</span>
              <span className="font-mono text-ink">
                {d.type === 'aadhaar' ? `XXXX XXXX ${d.number}` : d.number}
              </span>
              {d.isPrimary && (
                <Badge tone="brand" dot={false}>
                  Primary
                </Badge>
              )}
              {d.expiresOn && (
                <span className="text-xs text-ink-3">expires {formatDate(d.expiresOn)}</span>
              )}
              {d.verifiedByName && (
                <span className="text-xs text-ink-3">checked by {d.verifiedByName}</span>
              )}
              <button
                type="button"
                aria-label="Delete document"
                onClick={() => remove.mutate(d.id)}
                className="ml-auto rounded p-1 text-ink-3 hover:text-closed-ink"
              >
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !docs.isLoading && <p className="text-sm text-ink-3">No documents recorded.</p>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (type && number.trim()) add.mutate();
        }}
      >
        <Select value={type || undefined} onValueChange={(v) => setType(v as IdDocumentType)}>
          <SelectTrigger aria-label="Document type" className="w-52">
            <SelectValue placeholder="Document type" />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {ID_DOCUMENT_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="Document number"
          placeholder={type === 'aadhaar' ? 'Last 4 digits' : 'Number'}
          className="w-48"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!type || !number.trim()}
          loading={add.isPending}
        >
          Add
        </Button>
      </form>
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
    </Block>
  );
}
