import type { StayRange } from '@yohobed/ui';
import { addDaysIso } from '@yohobed/locale';
import type {
  BillTo,
  BookingOrigin,
  CreateReservationInput,
  IdDocumentType,
  InclusionInput,
  PriceApproval,
  PrivateFile,
  RemarkInput,
  ReservationConfig,
  ReservationGuestInput,
  ReservationKind,
  ReservationStayInput,
  Residency,
  TaskInput,
  TransferInput,
} from '@/lib/api';
import { emptyPayment, type PaymentDraft } from '@/components/payments/payment-fields';
import {
  emptyLine,
  holdInstant,
  isComplete,
  typedRate,
  type Draft,
  type GuestDraft,
  type LineDraft,
  type Prefill,
} from '../composer/draft';
import { localNowPlus } from '../composer/shared';

/**
 * The full Add Reservation page's working state (Development Phase 02, Sprint 4) — Quick
 * Reservation's draft plus everything "More Options" adds — and how it becomes an API body.
 */

export interface FullLineDraft extends LineDraft {
  childAges: number[];
  extraBeds: number;
  remarks: RemarkInput[];
  tasks: TaskInput[];
  /** Guest List: this room's own guest. Room 1 is always the reservation's guest. */
  guest: GuestDraft | null;
  /** Breakfast, a driver's room … posted by night audit (Sprint 5). */
  inclusions: InclusionInput[];
  /** Pick-ups and drop-offs, charged when done (Sprint 5). */
  transfers: TransferInput[];
}

export interface GuestProfileDraft extends GuestDraft {
  address: string;
  zip: string;
  countryCode: string;
  state: string;
  city: string;
  nationalityCode: string;
  document: {
    type: IdDocumentType | '';
    number: string;
    expiresOn: string;
    issuingCountry: string;
    /** A scan, in the private file store. Never for Aadhaar. */
    file: PrivateFile | null;
  };
}

export interface OtherInfoDraft {
  emailVoucher: boolean;
  /** As typed: comma-separated. */
  voucherEmails: string;
  sendCheckoutEmail: boolean;
  suppressRateOnGrCard: boolean;
  displayInclusionSeparately: boolean;
}

export interface FullDraft {
  stay: StayRange;
  kind: ReservationKind;
  holdDate: string;
  holdTime: string;
  /** A hold that is never released automatically. */
  holdNever: boolean;
  origin: BookingOrigin;
  businessSourceId: string | null;
  /** The travel agent or company. */
  ledgerAccountId: string | null;
  voucherNo: string;
  /** Null: let the server default it (rate plan → account → business source). */
  marketSegmentId: string | null;
  salesPersonId: string | null;
  useContractRates: boolean;
  complimentary: boolean;
  taxExempt: { on: boolean; exemptionId: string; reason: string };
  /**
   * Resident or foreign: filters the rate types. Read from the guest's nationality alone — the
   * desk no longer sets it by hand (owner brief, 2026-09-26). Null until the nationality is known.
   */
  residency: Residency | null;
  /** A VIP stay: a crown on every screen, nothing else (owner brief, 2026-09-26). */
  vip: boolean;
  lines: FullLineDraft[];
  guest: GuestProfileDraft;
  guestList: boolean;
  remarks: RemarkInput[];
  other: OtherInfoDraft;
  couponCode: string;
  referralCode: string;
  priceReason: string;
  approvals: Partial<Record<PriceApproval, string>>;
  groupName: string;
  /** Who pays (Sprint 5). */
  billTo: BillTo;
  /** The desk picked Bill To itself, so a default must not overwrite it. */
  billToChosen: boolean;
  /** Money taken now: a deposit or the whole stay. */
  payment: PaymentDraft;
}

export function fullLine(from?: Partial<FullLineDraft>): FullLineDraft {
  const base = emptyLine(from as LineDraft | undefined);
  return {
    ...base,
    roomUnitId: from?.roomUnitId ?? '',
    rate: from?.rate ?? '',
    childAges: [],
    extraBeds: 0,
    remarks: [],
    tasks: [],
    guest: null,
    inclusions: [],
    transfers: [],
  };
}

export function blankGuest(cfg: ReservationConfig): GuestProfileDraft {
  return {
    customerId: null,
    title: cfg.titles[0] ?? '',
    name: '',
    phone: { number: '', country: cfg.property.countryCode },
    email: '',
    whatsapp: false,
    createNew: false,
    address: '',
    zip: '',
    countryCode: cfg.property.countryCode,
    state: '',
    city: '',
    nationalityCode: '',
    document: { type: '', number: '', expiresOn: '', issuingCountry: '', file: null },
  };
}

function defaultOther(): OtherInfoDraft {
  return {
    emailVoucher: false,
    voucherEmails: '',
    sendCheckoutEmail: false,
    suppressRateOnGrCard: false,
    displayInclusionSeparately: false,
  };
}

/** A fresh page, from the property's own date and times (and a tape-chart prefill). */
export function blankFullDraft(cfg: ReservationConfig, prefill?: Prefill | null): FullDraft {
  const checkin = prefill?.checkin && prefill.checkin >= cfg.today ? prefill.checkin : cfg.today;
  const hold = localNowPlus(cfg.settings.hold.defaultHours);
  return {
    stay: {
      checkin,
      checkout: addDaysIso(checkin, Math.max(1, prefill?.nights ?? 1)),
      checkinTime: cfg.property.checkinTime.slice(0, 5),
      checkoutTime: cfg.property.checkoutTime.slice(0, 5),
    },
    kind: 'confirm',
    holdDate: hold.date,
    holdTime: hold.time,
    holdNever: false,
    origin: 'direct',
    businessSourceId: null,
    ledgerAccountId: null,
    voucherNo: '',
    marketSegmentId: null,
    salesPersonId: null,
    useContractRates: false,
    complimentary: false,
    taxExempt: { on: false, exemptionId: '', reason: '' },
    residency: null,
    vip: false,
    lines: [fullLine({ roomId: prefill?.roomId ?? null, roomUnitId: prefill?.roomUnitId ?? '' })],
    guest: blankGuest(cfg),
    guestList: false,
    remarks: [],
    other: defaultOther(),
    couponCode: '',
    referralCode: '',
    priceReason: '',
    approvals: {},
    groupName: '',
    billTo: 'guest',
    billToChosen: false,
    payment: emptyPayment(),
  };
}

/** "More Options": Quick Reservation's draft, carried over to the full page. */
export function fromQuickDraft(d: Draft, cfg: ReservationConfig): FullDraft {
  const base = blankFullDraft(cfg);
  const source = cfg.businessSources.find((s) => s.id === d.businessSourceId);
  return {
    ...base,
    stay: d.stay,
    kind: d.kind,
    holdDate: d.holdDate,
    holdTime: d.holdTime,
    origin: (source?.category as BookingOrigin | undefined) ?? 'direct',
    businessSourceId: d.businessSourceId,
    lines: d.lines.map((l) => ({ ...fullLine(), ...l })),
    guest: { ...base.guest, ...d.guest },
    couponCode: d.couponCode,
    referralCode: d.referralCode,
    priceReason: d.priceReason,
    approvals: d.approvals,
  };
}

/** Resident or foreign, from the guest's nationality and the hotel's country. */
export function residencyOf(nationality: string, propertyCountry: string): Residency | null {
  if (!nationality) return null;
  return nationality === propertyCountry ? 'local' : 'foreign';
}

const isHoldKind = (k: ReservationKind) => k === 'hold_confirm' || k === 'hold_unconfirm';

/** A Bill To that charges a travel agent or company. */
export const billsCompany = (b: BillTo) => b === 'company' || b === 'company_room_tax';

/**
 * The travel agent or company on the reservation: who booked it (a travel-agent or corporate
 * booking source), or — on any source — who pays when Bill To is a company option. A direct
 * booking a company pays for is common (owner brief, 2026-09-26: "group bookings are mostly
 * corporate").
 */
export function accountOf(d: FullDraft): string | null {
  if (!d.ledgerAccountId) return null;
  const booked = d.origin === 'travel_agent' || d.origin === 'corporate';
  return booked || billsCompany(d.billTo) ? d.ledgerAccountId : null;
}

/** Everything that decides the price — the quote's body. Null until every line is complete. */
export function fullStayBody(propertyId: string, d: FullDraft): ReservationStayInput | null {
  if (d.lines.length === 0 || !d.lines.every(isComplete)) return null;
  const account = accountOf(d);
  // Contract rates are the booker's: only a travel-agent or corporate booking has them.
  const booker = account && (d.origin === 'travel_agent' || d.origin === 'corporate');
  return {
    propertyId,
    checkin: d.stay.checkin,
    checkout: d.stay.checkout,
    arrivalTime: d.stay.checkinTime,
    departureTime: d.stay.checkoutTime,
    kind: d.kind,
    ...(isHoldKind(d.kind)
      ? { holdUntil: d.holdNever ? null : holdInstant(d.holdDate, d.holdTime) }
      : {}),
    origin: d.origin,
    ...(d.businessSourceId ? { businessSourceId: d.businessSourceId } : {}),
    ...(account ? { ledgerAccountId: d.ledgerAccountId! } : {}),
    ...(d.voucherNo.trim() ? { voucherNo: d.voucherNo.trim() } : {}),
    ...(d.marketSegmentId ? { marketSegmentId: d.marketSegmentId } : {}),
    ...(d.salesPersonId ? { salesPersonId: d.salesPersonId } : {}),
    ...(d.residency ? { residency: d.residency } : {}),
    ...(booker && d.useContractRates ? { useContractRates: true } : {}),
    ...(d.complimentary ? { complimentary: true } : {}),
    ...(d.taxExempt.on && d.taxExempt.exemptionId.trim()
      ? {
          taxExempt: {
            exemptionId: d.taxExempt.exemptionId.trim(),
            ...(d.taxExempt.reason.trim() ? { reason: d.taxExempt.reason.trim() } : {}),
          },
        }
      : {}),
    ...(d.couponCode.trim() ? { couponCode: d.couponCode.trim().toUpperCase() } : {}),
    ...(d.referralCode.trim() ? { referralCode: d.referralCode.trim().toUpperCase() } : {}),
    ...(d.priceReason.trim() ? { priceReason: d.priceReason.trim() } : {}),
    ...(Object.keys(d.approvals).length ? { approvals: d.approvals } : {}),
    lines: d.lines.map((l) => {
      const rate = d.complimentary ? null : typedRate(l);
      return {
        roomId: l.roomId!,
        occupancyId: l.occupancyId!,
        ...(l.roomUnitId ? { roomUnitId: l.roomUnitId } : {}),
        adults: l.adults,
        children: l.children,
        ...(l.childAges.length ? { childAges: l.childAges.slice(0, l.children) } : {}),
        ...(l.extraBeds ? { extraBeds: l.extraBeds } : {}),
        cots: l.cots ?? 0,
        ...(l.minimumExceptionReason?.trim()
          ? { minimumExceptionReason: l.minimumExceptionReason.trim() }
          : {}),
        ...(rate !== null ? { rate: { mode: 'total' as const, amount: rate } } : {}),
      };
    }),
  };
}

function guestBody(g: GuestDraft, profile?: GuestProfileDraft): ReservationGuestInput {
  const doc = profile?.document;
  const documents =
    doc && doc.type && doc.number.trim()
      ? [
          {
            type: doc.type,
            number: doc.number.trim(),
            ...(doc.expiresOn ? { expiresOn: doc.expiresOn } : {}),
            ...(doc.issuingCountry ? { issuingCountry: doc.issuingCountry } : {}),
            ...(doc.file && doc.type !== 'aadhaar' ? { fileId: doc.file.id } : {}),
            verification: 'original' as const,
            isPrimary: true,
          },
        ]
      : undefined;
  if (g.customerId) return { customerId: g.customerId, ...(documents ? { documents } : {}) };
  return {
    name: g.name.trim(),
    ...(g.title ? { title: g.title } : {}),
    ...(g.email.trim() ? { email: g.email.trim() } : {}),
    ...(g.phone.number.trim() ? { phone: g.phone.number.trim(), whatsapp: g.whatsapp } : {}),
    ...(g.createNew ? { createNew: true } : {}),
    ...(profile
      ? {
          ...(profile.address.trim() ? { address: profile.address.trim() } : {}),
          ...(profile.zip.trim() ? { zip: profile.zip.trim() } : {}),
          ...(profile.countryCode ? { countryCode: profile.countryCode } : {}),
          ...(profile.state.trim() ? { state: profile.state.trim() } : {}),
          ...(profile.city.trim() ? { city: profile.city.trim() } : {}),
          ...(profile.nationalityCode ? { nationalityCode: profile.nationalityCode } : {}),
        }
      : {}),
    ...(documents ? { documents } : {}),
  };
}

/** A room guest the desk actually filled in (an empty Guest List block means "the main guest"). */
export function roomGuestGiven(g: GuestDraft | null): boolean {
  return Boolean(g && (g.customerId || g.name.trim()));
}

/**
 * The payment methods the reservation can be paid with now. City Ledger only when there is a
 * travel agent or company to charge, on a plan with the city ledger. A method in another currency
 * ("Cash (USD)") is left out: the amount would be recorded in the hotel's currency, and a drawer
 * counted in rupees cannot hold dollars typed as rupees.
 */
export function paymentMethodsFor(
  cfg: ReservationConfig,
  d: FullDraft,
  hasCityLedger: boolean,
): ReservationConfig['paymentMethods'] {
  const account = accountOf(d);
  return cfg.paymentMethods.filter(
    (m) =>
      (!m.currency || m.currency === cfg.property.currency) &&
      (m.category !== 'city_ledger' || (hasCityLedger && Boolean(account))),
  );
}

/**
 * The Bill To actually sent: a company option needs the travel agent or company, and a group owner
 * needs a group. The form only offers what fits; this keeps a stale choice from reaching the API.
 */
export function effectiveBillTo(d: FullDraft): BillTo {
  if (billsCompany(d.billTo) && !d.ledgerAccountId) return 'guest';
  if (d.billTo === 'group_owner' && d.lines.length < 2) return 'guest';
  return d.billTo;
}

/** The full reservation body. `checkIn`: a walk-in, checked in as it is saved. */
export function fullCreateBody(
  propertyId: string,
  d: FullDraft,
  expectedTotal?: number,
  opts: { checkIn?: boolean } = {},
): CreateReservationInput | null {
  const stay = fullStayBody(propertyId, d);
  if (!stay) return null;
  const billTo = effectiveBillTo(d);
  const p = d.payment;
  const emails = d.other.voucherEmails
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  return {
    ...stay,
    lines: stay.lines.map((l, i) => {
      const line = d.lines[i]!;
      const roomGuest = d.guestList && i > 0 && roomGuestGiven(line.guest) ? line.guest : null;
      return {
        ...l,
        ...(roomGuest ? { guest: guestBody(roomGuest) } : {}),
        ...(line.remarks.length ? { remarks: line.remarks } : {}),
        ...(line.tasks.length ? { tasks: line.tasks } : {}),
        ...(line.inclusions.length ? { inclusions: line.inclusions } : {}),
        ...(line.transfers.length ? { transfers: line.transfers } : {}),
      };
    }),
    guest: guestBody(d.guest, d.guest),
    ...(d.remarks.length ? { remarks: d.remarks } : {}),
    options: {
      emailVoucher: d.other.emailVoucher,
      ...(d.other.emailVoucher && emails.length ? { voucherEmails: emails } : {}),
      sendCheckoutEmail: d.other.sendCheckoutEmail,
      suppressRateOnGrCard: d.other.suppressRateOnGrCard,
      displayInclusionSeparately: d.other.displayInclusionSeparately,
    },
    ...(d.groupName.trim() ? { groupName: d.groupName.trim() } : {}),
    ...(expectedTotal !== undefined ? { expectedTotal } : {}),
    ...(billTo !== 'guest' ? { billTo } : {}),
    ...(p.methodId && Number(p.amount) > 0
      ? {
          payment: {
            paymentMethodId: p.methodId,
            amount: Number(Number(p.amount).toFixed(2)),
            ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
            ...(p.file ? { fileId: p.file.id } : {}),
          },
        }
      : {}),
    ...(opts.checkIn ? { checkIn: true } : {}),
    ...(d.vip ? { vip: true } : {}),
  };
}
