import { z } from 'zod';
import { BOOKING_ORIGINS, RESERVATION_KINDS, RESIDENCIES } from '@yohobed/domain';

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
    /** A typed rate for this room; omit to sell at the rate calendar's price. */
    rate: rateOverrideSchema.optional(),
  })
  .refine((l) => l.adults + l.children > 0, { message: 'a room needs at least one guest' })
  .refine((l) => !l.childAges || l.childAges.length <= l.children, {
    message: 'more child ages than children',
    path: ['childAges'],
  });

export const guestSchema = z.object({
  /** An existing guest. Everything else is ignored when this is given. */
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
  /** Create a new guest even though one with this email or phone exists. */
  createNew: z.boolean().optional(),
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
    guest: guestSchema.refine((g) => g.customerId || g.name, {
      message: 'the guest needs a name',
      path: ['name'],
    }),
    options: reservationOptionsSchema.optional(),
    /** The total the desk was quoted. A different total now is refused with 409 price_changed. */
    expectedTotal: z.number().finite().optional(),
    /** A name for the group card of a multi-room reservation. */
    groupName: z.string().trim().max(120).optional(),
  })
  .superRefine(checkStay);
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
