import { z } from 'zod';
import { BILL_TO_OPTIONS, BOOKING_ORIGINS, RESERVATION_KINDS, RESIDENCIES } from '@yohobed/domain';
import { ID_DOCUMENT_TYPES } from '@yohobed/locale';
import { INCLUSION_RHYTHMS, REMARK_TYPES } from '@yohobed/db';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:mm');
const uuid = z.string().uuid();
const money = z.number().finite().min(0).max(100_000_000);
const countryCode = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'expected a two-letter country code')
  .transform((v) => v.toUpperCase());

/** The longest stay one reservation may hold, and the most rooms. */
export const MAX_NIGHTS = 90;
export const MAX_LINES = 50;

function nightsBetween(checkin: string, checkout: string): number {
  return Math.round(
    (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86_400_000,
  );
}

/** A typed rate. Amounts are tax-inclusive, per room. */
export const rateOverrideSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('nightly'), amount: money }),
  z.object({ mode: z.literal('total'), amount: money }),
  z.object({ mode: z.literal('per_night'), amounts: z.record(isoDate, money) }),
  z.object({ mode: z.literal('discount_pct'), pct: z.number().min(0).max(100) }),
]);

/** An identity document the desk looked at. Aadhaar: the last 4 digits (anything longer is cut). */
export const guestDocumentSchema = z.object({
  type: z.enum(ID_DOCUMENT_TYPES),
  number: z.string().trim().min(1).max(40),
  issuingCountry: countryCode.optional(),
  placeOfIssue: z.string().trim().max(120).optional(),
  issuedOn: isoDate.optional(),
  expiresOn: isoDate.optional(),
  visaNumber: z.string().trim().max(40).optional(),
  visaType: z.string().trim().max(60).optional(),
  visaExpiresOn: isoDate.optional(),
  /** How it was checked: the original, a copy, or an official app. */
  verification: z.enum(['original', 'copy', 'digital']).optional(),
  isPrimary: z.boolean().optional(),
  /** A scan, uploaded first to POST /files?purpose=id_document (Sprint 5). */
  fileId: uuid.optional(),
});
export type GuestDocumentInput = z.infer<typeof guestDocumentSchema>;

export const guestSchema = z.object({
  /** An existing guest. Everything else but documents is ignored when this is given. */
  customerId: uuid.optional(),
  title: z.string().trim().max(24).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().max(200).optional(),
  /** As typed; read in the property's country when it has no country prefix. */
  phone: z.string().trim().max(40).optional(),
  whatsapp: z.boolean().optional(),
  nationalityCode: countryCode.optional(),
  countryCode: countryCode.optional(),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  zip: z.string().trim().max(20).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  dateOfBirth: isoDate.optional(),
  /** Added to the guest's profile. */
  documents: z.array(guestDocumentSchema).max(5).optional(),
  /** Create a new guest even though one with this email or phone exists. */
  createNew: z.boolean().optional(),
});
export type GuestInput = z.infer<typeof guestSchema>;

/** A guest who must be identified: an existing one, or a name for a new one. */
export const namedGuestSchema = guestSchema.refine((g) => g.customerId || g.name, {
  message: 'the guest needs a name',
  path: ['name'],
});

/** A typed note on a booking; each type shows in one place (housekeeping board, folio, ...). */
export const remarkSchema = z.object({
  type: z.enum(REMARK_TYPES).default('general'),
  text: z.string().trim().min(1).max(1000),
});
export type RemarkInput = z.infer<typeof remarkSchema>;

/** "Create Task" on a room line: a job for a department, due now or at check-in / check-out. */
export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  department: z
    .enum(['housekeeping', 'maintenance', 'front_desk', 'food_beverage', 'transport', 'other'])
    .default('front_desk'),
  trigger: z.enum(['instant', 'checkin', 'checkout']).default('instant'),
  deadline: isoDate.optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});
export type TaskInput = z.infer<typeof taskSchema>;

/** Something the stay includes: breakfast, dinner, a driver's room (Sprint 5). */
export const inclusionSchema = z.object({
  particularId: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  rhythm: z.enum(INCLUSION_RHYTHMS).default('per_night'),
  /** Tax inclusive, per unit (a night, a guest-night …). */
  unitPrice: money,
  discountPct: z.number().min(0).max(100).default(0),
  taxRatePct: z.number().min(0).max(100).default(0),
  /** Already in the room rate: nothing is posted; the bill may show it separately. */
  includedInRate: z.boolean().default(false),
  itemize: z.boolean().default(true),
});
export type InclusionInput = z.infer<typeof inclusionSchema>;

/** Yanolja's Pick Up / Drop Off (Sprint 5). Charged when marked done. */
export const transferSchema = z.object({
  direction: z.enum(['pickup', 'dropoff']),
  transportModeId: uuid.optional(),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  fromPlace: z.string().trim().max(200).optional(),
  toPlace: z.string().trim().max(200).optional(),
  flightNo: z.string().trim().max(20).optional(),
  pax: z.number().int().min(1).max(60).default(1),
  vehicle: z.string().trim().max(60).optional(),
  driver: z.string().trim().max(120).optional(),
  /** Tax inclusive; 0 for a free transfer. */
  amount: money.default(0),
  notes: z.string().trim().max(500).optional(),
});
export type TransferInput = z.infer<typeof transferSchema>;

/** Money taken with the reservation: a deposit, or the whole stay (Sprint 5). */
export const reservationPaymentSchema = z.object({
  /** One of the property's payment methods. City Ledger bills the reservation's account (Pro). */
  paymentMethodId: uuid,
  amount: z.number().finite().positive().max(100_000_000),
  reference: z.string().trim().max(120).optional(),
  /** A photo of the slip, uploaded first to POST /files?purpose=payment_slip. */
  fileId: uuid.optional(),
  /** The cash drawer shift; the property's open one when omitted. */
  drawerSessionId: uuid.optional(),
});
export type ReservationPaymentInput = z.infer<typeof reservationPaymentSchema>;

/** One room of the reservation — one row of Yanolja's room grid. */
export const reservationLineSchema = z
  .object({
    roomId: uuid,
    /** The rate type: a meal plan's occupancy. */
    occupancyId: uuid,
    /** A specific room. Assigned on a booking that holds rooms; a preference on an inquiry. */
    roomUnitId: uuid.nullable().optional(),
    adults: z.number().int().min(0).max(20).default(1),
    children: z.number().int().min(0).max(20).default(0),
    childAges: z.array(z.number().int().min(0).max(17)).max(20).optional(),
    extraBeds: z.number().int().min(0).max(10).default(0),
    cots: z.number().int().min(0).max(10).optional(),
    minimumExceptionReason: z.string().trim().min(3).max(500).optional(),
    /** A typed rate for this room; omit to sell at the rate calendar's price. */
    rate: rateOverrideSchema.optional(),
    /** Guest List: this room's own guest. Omitted: the reservation's guest. */
    guest: namedGuestSchema.optional(),
    /** Notes for this room only. */
    remarks: z.array(remarkSchema).max(10).optional(),
    /** Tasks raised for this room (Pro: work orders). */
    tasks: z.array(taskSchema).max(10).optional(),
    inclusions: z.array(inclusionSchema).max(10).optional(),
    transfers: z.array(transferSchema).max(4).optional(),
  })
  .refine((l) => l.adults + l.children > 0, { message: 'a room needs at least one guest' })
  .refine((l) => !l.childAges || l.childAges.length <= l.children, {
    message: 'more child ages than children',
    path: ['childAges'],
  });

export const reservationOptionsSchema = z
  .object({
    emailVoucher: z.boolean(),
    voucherEmails: z.array(z.string().trim().email()).max(10),
    sendCheckoutEmail: z.boolean(),
    checkoutTemplate: z.string().trim().max(64).nullable(),
    guestPortalAccess: z.boolean(),
    suppressRateOnGrCard: z.boolean(),
    displayInclusionSeparately: z.boolean(),
  })
  .partial()
  .strict();

const approvalsSchema = z
  .object({
    rate_override: z.string().min(10).optional(),
    complimentary: z.string().min(10).optional(),
    tax_exempt: z.string().min(10).optional(),
  })
  .strict();

/** What a quote and a reservation share: everything that decides the price. */
const pricedStaySchema = z.object({
  propertyId: uuid,
  checkin: isoDate,
  checkout: isoDate,
  arrivalTime: hhmm.optional(),
  departureTime: hhmm.optional(),
  kind: z.enum(RESERVATION_KINDS).default('confirm'),
  /**
   * When a hold gives its rooms back. Omitted: the property's default hold length from now.
   * null: never released automatically. Only for the two hold kinds.
   */
  holdUntil: z.string().datetime({ offset: true }).nullable().optional(),
  /** Yanolja's "Booking Source". Defaults from the business source or the account. */
  origin: z.enum(BOOKING_ORIGINS).optional(),
  businessSourceId: uuid.optional(),
  /** Defaults from the rate plan, then the account, then the business source. */
  marketSegmentId: uuid.optional(),
  salesPersonId: uuid.optional(),
  /** The travel agent or company. */
  ledgerAccountId: uuid.optional(),
  voucherNo: z.string().trim().max(60).optional(),
  residency: z.enum(RESIDENCIES).optional(),
  /** "Rate Offered": price from the account's contract rates (Pro). */
  useContractRates: z.boolean().default(false),
  /** "Rate Offered": a complimentary reservation — every room free. */
  complimentary: z.boolean().default(false),
  taxExempt: z
    .object({
      exemptionId: z.string().trim().min(1).max(60),
      reason: z.string().trim().max(300).optional(),
    })
    .optional(),
  /** Why the price differs from the list — required for a typed rate, complimentary or exemption. */
  priceReason: z.string().trim().min(3).max(300).optional(),
  /** Owner approval tokens from POST /auth/step-up, one per action that needs one. */
  approvals: approvalsSchema.optional(),
  couponCode: z.string().trim().max(40).optional(),
  referralCode: z.string().trim().max(40).optional(),
  lines: z.array(reservationLineSchema).min(1).max(MAX_LINES),
});

function checkStay(v: z.infer<typeof pricedStaySchema>, ctx: z.RefinementCtx) {
  if (v.checkout <= v.checkin) {
    ctx.addIssue({ code: 'custom', path: ['checkout'], message: 'checkout must be after checkin' });
  } else if (nightsBetween(v.checkin, v.checkout) > MAX_NIGHTS) {
    ctx.addIssue({
      code: 'custom',
      path: ['checkout'],
      message: `a reservation can be at most ${MAX_NIGHTS} nights`,
    });
  }
  const units = v.lines.map((l) => l.roomUnitId).filter((u): u is string => Boolean(u));
  if (new Set(units).size !== units.length) {
    ctx.addIssue({ code: 'custom', path: ['lines'], message: 'the same room is chosen twice' });
  }
  if (v.complimentary && v.lines.some((l) => l.rate)) {
    ctx.addIssue({
      code: 'custom',
      path: ['lines'],
      message: 'a complimentary reservation cannot also carry typed rates',
    });
  }
  if (v.complimentary && v.useContractRates) {
    ctx.addIssue({
      code: 'custom',
      path: ['useContractRates'],
      message: 'choose complimentary or contract rates, not both',
    });
  }
  if (v.useContractRates && !v.ledgerAccountId) {
    ctx.addIssue({
      code: 'custom',
      path: ['ledgerAccountId'],
      message: 'contract rates need the travel agent or company',
    });
  }
}

export const quoteReservationSchema = pricedStaySchema
  .extend({ guest: guestSchema.partial().optional() })
  .superRefine(checkStay);
export type QuoteReservationDto = z.infer<typeof quoteReservationSchema>;

export const createReservationSchema = pricedStaySchema
  .extend({
    guest: namedGuestSchema,
    options: reservationOptionsSchema.optional(),
    /** Notes for every room of the reservation. */
    remarks: z.array(remarkSchema).max(10).optional(),
    /**
     * Who pays (Sprint 5). `company` bills everything to the travel agent or company;
     * `company_room_tax` bills room and tax to them and extras to the guest; `group_owner` bills
     * every room to the reservation's guest. The company options are Pro (city ledger).
     */
    billTo: z.enum(BILL_TO_OPTIONS).default('guest'),
    payment: reservationPaymentSchema.optional(),
    /** Check the guest in straight away: a walk-in. Arrival must be today. */
    checkIn: z.boolean().default(false),
    /** The total the desk was quoted. A different total now is refused with 409 price_changed. */
    expectedTotal: z.number().finite().optional(),
    /** A name for the group card of a multi-room reservation. */
    groupName: z.string().trim().max(120).optional(),
  })
  .superRefine(checkStay)
  .superRefine((v, ctx) => {
    if ((v.billTo === 'company' || v.billTo === 'company_room_tax') && !v.ledgerAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['ledgerAccountId'],
        message: 'billing a company needs the travel agent or company',
      });
    }
    if (v.checkIn && v.kind !== 'confirm' && v.kind !== 'hold_confirm') {
      ctx.addIssue({
        code: 'custom',
        path: ['checkIn'],
        message: 'only a confirmed reservation can be checked in',
      });
    }
  });
export type CreateReservationDto = z.infer<typeof createReservationSchema>;

// --- Room availability --------------------------------------------------------

export const roomAvailabilityQuerySchema = z
  .object({
    checkin: isoDate,
    checkout: isoDate,
    residency: z.enum(RESIDENCIES).optional(),
  })
  .refine((v) => v.checkout > v.checkin, {
    message: 'checkout must be after checkin',
    path: ['checkout'],
  })
  .refine((v) => nightsBetween(v.checkin, v.checkout) <= MAX_NIGHTS, {
    message: `at most ${MAX_NIGHTS} nights`,
    path: ['checkout'],
  });
export type RoomAvailabilityQuery = z.infer<typeof roomAvailabilityQuerySchema>;

// --- Lifecycle ----------------------------------------------------------------

export const confirmSchema = z.object({ reason: z.string().trim().max(300).optional() });
export type ConfirmDto = z.infer<typeof confirmSchema>;

export const holdSchema = z.object({
  /** When the hold releases; null = never automatically. */
  until: z.string().datetime({ offset: true }).nullable(),
  kind: z.enum(['hold_confirm', 'hold_unconfirm']).optional(),
});
export type HoldDto = z.infer<typeof holdSchema>;

export const releaseHoldSchema = z.object({ reason: z.string().trim().max(300).optional() });
export type ReleaseHoldDto = z.infer<typeof releaseHoldSchema>;

export const groupCancelSchema = z.object({ reason: z.string().trim().max(300).optional() });
export type GroupCancelDto = z.infer<typeof groupCancelSchema>;

// --- Contract rates -----------------------------------------------------------

const contractRateFields = {
  propertyId: uuid,
  roomId: uuid,
  ratePlanId: uuid.nullable().optional(),
  validFrom: isoDate,
  validTo: isoDate,
  mode: z.enum(['fixed', 'discount_pct']).default('fixed'),
  value: money,
  active: z.boolean().optional(),
  note: z.string().trim().max(300).nullable().optional(),
};

export const createContractRateSchema = z
  .object(contractRateFields)
  .refine((v) => v.validTo >= v.validFrom, {
    message: 'validTo is before validFrom',
    path: ['validTo'],
  })
  .refine((v) => v.mode !== 'discount_pct' || v.value <= 100, {
    message: 'a discount is at most 100%',
    path: ['value'],
  });
export type CreateContractRateDto = z.infer<typeof createContractRateSchema>;

export const updateContractRateSchema = z
  .object({
    ratePlanId: uuid.nullable().optional(),
    validFrom: isoDate.optional(),
    validTo: isoDate.optional(),
    mode: z.enum(['fixed', 'discount_pct']).optional(),
    value: money.optional(),
    active: z.boolean().optional(),
    note: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateContractRateDto = z.infer<typeof updateContractRateSchema>;

// --- Rate plan audience ---------------------------------------------------------

export const updateRatePlanSchema = z
  .object({
    audience: z.enum(['all', 'local', 'foreign']).optional(),
    status: z.enum(['Active', 'Inactive']).optional(),
    marketSegmentId: uuid.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateRatePlanDto = z.infer<typeof updateRatePlanSchema>;

// --- Booking extras: guests, remarks, tasks, documents ----------------------------

export const addBookingGuestSchema = namedGuestSchema;
export type AddBookingGuestDto = z.infer<typeof addBookingGuestSchema>;

export const createRemarkSchema = remarkSchema;
export type CreateRemarkDto = z.infer<typeof createRemarkSchema>;

export const createTaskSchema = taskSchema.extend({
  /** Defaults to the booking's assigned room. */
  roomUnitId: uuid.nullable().optional(),
});
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const createDocumentSchema = guestDocumentSchema;
export type CreateDocumentDto = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = guestDocumentSchema
  .partial()
  .extend({
    issuingCountry: countryCode.nullable().optional(),
    placeOfIssue: z.string().trim().max(120).nullable().optional(),
    issuedOn: isoDate.nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
    visaNumber: z.string().trim().max(40).nullable().optional(),
    visaType: z.string().trim().max(60).nullable().optional(),
    visaExpiresOn: isoDate.nullable().optional(),
    verification: z.enum(['original', 'copy', 'digital']).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateDocumentDto = z.infer<typeof updateDocumentSchema>;

export const createInclusionSchema = inclusionSchema;
export type CreateInclusionDto = z.infer<typeof createInclusionSchema>;

export const createTransferSchema = transferSchema;
export type CreateTransferDto = z.infer<typeof createTransferSchema>;

export const updateTransferSchema = transferSchema
  .partial()
  .extend({ status: z.enum(['planned', 'done', 'cancelled']).optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateTransferDto = z.infer<typeof updateTransferSchema>;

export const transportModeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(16)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(60),
  defaultPrice: money.default(0),
  sort: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().optional(),
});
export type TransportModeDto = z.infer<typeof transportModeSchema>;
export const updateTransportModeSchema = transportModeSchema
  .omit({ code: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateTransportModeDto = z.infer<typeof updateTransportModeSchema>;
