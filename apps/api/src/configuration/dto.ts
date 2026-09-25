import { z } from 'zod';
import {
  COMMISSION_PLANS,
  RESERVATION_KINDS,
  SUPPORTED_CURRENCIES,
  TAG_COLORS,
  UNCONFIRMED_POLICIES,
  NIGHT_AUDIT_MODES,
  MEAL_PLANS,
  isPropertyAmenity,
} from '@yohobed/domain';
import {
  HOME_MARKETS,
  MARKET_SEGMENT_GROUPS,
  PAYMENT_CATEGORIES,
  SOURCE_CATEGORIES,
  isCountryCode,
} from '@yohobed/locale';

/** An owner-typed short code: letters, digits, dash and underscore, stored upper-case. */
const shortCode = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, 'use letters, digits, - or _ only')
    .transform((s) => s.toUpperCase());

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected a 24-hour time like 14:00');

/**
 * Registration numbers, checked for shape only. Sri Lanka's TIN is nine digits (Gazette 2481/22);
 * a GSTIN is the standard 15-character structure; the Malaysian numbers vary by issuing year, so
 * they only get a permissive pattern.
 */
/** A registration number that may also be sent as '' to clear it. */
const registration = (pattern: RegExp, message: string) =>
  z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      z.union([z.literal(''), z.string().regex(pattern, message)]),
    )
    .optional();

const taxIdsSchema = z
  .object({
    tin: registration(/^\d{9}$/, 'a Sri Lankan TIN is 9 digits'),
    ssclRegNo: registration(/^[A-Z0-9/-]{1,30}$/, 'letters, digits, / and - only'),
    sltdaRegNo: registration(/^[A-Z0-9/-]{1,30}$/, 'letters, digits, / and - only'),
    gstin: registration(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'not a valid GSTIN'),
    sstNo: registration(/^[A-Z0-9-]{6,24}$/, 'not a valid SST number'),
    ttxNo: registration(/^[A-Z0-9-]{6,24}$/, 'not a valid tourism tax number'),
    brn: registration(/^[A-Z0-9-]{6,24}$/, 'not a valid registration number'),
  })
  .strict();

export const updatePropertyProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    legalName: optionalText(200),
    code: optionalText(32),
    propertyType: z
      .enum(['Hotel', 'Resort', 'Guesthouse', 'Villa', 'Apartment', 'Hostel', 'Other'])
      .nullable()
      .optional(),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => isCountryCode(c), 'unknown country')
      .optional(),
    stateCode: optionalText(10),
    state: optionalText(80),
    address: optionalText(300),
    addressLine2: optionalText(300),
    city: optionalText(80),
    zip: optionalText(16),
    phone: optionalText(40),
    reservationPhone: optionalText(40),
    email: z.string().trim().email().nullable().optional(),
    website: z
      .string()
      .trim()
      .url()
      .max(300)
      .refine((value) => /^https?:\/\//i.test(value), 'website must use http or https')
      .nullable()
      .optional(),
    fax: optionalText(40),
    registrationNumber: optionalText(80),
    additionalRegistrationNumbers: z.array(z.string().trim().max(80)).max(4).optional(),
    latitude: z.number().finite().min(-90).max(90).nullable().optional(),
    longitude: z.number().finite().min(-180).max(180).nullable().optional(),
    logoMediaId: z.string().uuid().nullable().optional(),
    timezone: z.string().refine(isValidTimeZone, 'unknown timezone').optional(),
    checkinTime: hhmm.optional(),
    checkoutTime: hhmm.optional(),
    starRating: z.number().int().min(0).max(7).nullable().optional(),
    taxIds: taxIdsSchema.optional(),
    branchCode: z
      .string()
      .trim()
      .max(15)
      .regex(/^[A-Za-z0-9]*$/, 'letters and digits only')
      .nullable()
      .optional(),
    fyStartMonth: z.number().int().min(1).max(12).optional(),
    invoicePrefix: z
      .string()
      .trim()
      .max(10)
      .regex(/^[A-Za-z0-9/-]*$/, 'letters, digits, / and - only')
      .nullable()
      .optional(),
    // The Hotel Profile's other tabs (Configuration, owner brief 2026-09-26).
    description: optionalText(4000),
    highlights: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
    amenities: z.array(z.string().refine(isPropertyAmenity, 'unknown amenity')).max(100).optional(),
    policies: z
      .object({
        cancellation: z.string().max(2000).optional(),
        children: z.string().max(2000).optional(),
        pets: z.string().max(2000).optional(),
        smoking: z.string().max(2000).optional(),
        extraBeds: z.string().max(2000).optional(),
        houseRules: z.string().max(2000).optional(),
        other: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type UpdatePropertyProfileDto = z.infer<typeof updatePropertyProfileSchema>;

export const updatePropertySettingsSchema = z
  .object({
    timeFormat: z.enum(['12h', '24h']).optional(),
    mealCodeStyle: z.enum(['international', 'indian']).optional(),
    hold: z
      .object({
        defaultHours: z
          .number()
          .int()
          .min(1)
          .max(24 * 60)
          .optional(),
        reminderHours: z
          .number()
          .int()
          .min(0)
          .max(24 * 30)
          .optional(),
      })
      .strict()
      .optional(),
    unconfirmedPolicy: z.enum(UNCONFIRMED_POLICIES).optional(),
    rateControl: z
      .object({
        staffMaxDiscountPct: z.number().min(0).max(100).optional(),
        staffCanComp: z.boolean().optional(),
      })
      .strict()
      .optional(),
    requireDocumentsAtCheckin: z.boolean().optional(),
    requireGuestRegistration: z.boolean().optional(),
    checkoutBalancePolicy: z.enum(['block', 'allow']).optional(),
    /** Check stays out by themselves once their departure day is over (2026-09-26). */
    autoCheckout: z.boolean().optional(),
    /** The meal plans the hotel sells, and its own names for them (Configuration → Meal plans). */
    mealPlans: z
      .object({
        offered: z.array(z.enum(MEAL_PLANS)).min(1).max(5).optional(),
        names: z.record(z.enum(MEAL_PLANS), z.string().trim().max(40)).optional(),
      })
      .strict()
      .optional(),
    /** How the business day closes: by itself at a hotel time, or when the owner runs it. */
    nightAudit: z
      .object({
        mode: z.enum(NIGHT_AUDIT_MODES).optional(),
        time: hhmm.optional(),
      })
      .strict()
      .optional(),
    kindOverrides: z
      .record(
        z.enum(RESERVATION_KINDS),
        z
          .object({
            label: z.string().trim().max(40).optional(),
            color: z.enum(TAG_COLORS).optional(),
          })
          .strict(),
      )
      .optional(),
    titles: z.array(z.string().trim().min(1).max(24)).max(60).nullable().optional(),
  })
  .strict();
export type UpdatePropertySettingsDto = z.infer<typeof updatePropertySettingsSchema>;

// --- Master lists ------------------------------------------------------------

const commissionFields = {
  commissionPlan: z.enum(COMMISSION_PLANS).optional(),
  commissionValue: z.number().min(0).max(1_000_000).optional(),
};

/** A percentage plan cannot exceed 100%. */
function commissionIsSane(v: { commissionPlan?: string; commissionValue?: number }): boolean {
  if (v.commissionPlan?.startsWith('pct_') && (v.commissionValue ?? 0) > 100) return false;
  return true;
}

export const createBusinessSourceSchema = z
  .object({
    shortCode: shortCode(16),
    name: z.string().trim().min(1).max(120),
    category: z.enum(SOURCE_CATEGORIES).default('direct'),
    palette: z.enum(TAG_COLORS).default('slate'),
    registrationNo: optionalText(40),
    defaultMarketSegmentId: z.string().uuid().nullable().optional(),
    collectsTourismTax: z.boolean().default(false),
    sort: z.number().int().min(0).max(100_000).optional(),
    /** Legacy (Sprint 6) free colour; still accepted from older screens, never required. */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    ...commissionFields,
  })
  .strict()
  .refine(commissionIsSane, { message: 'a percentage commission cannot exceed 100' });
export type CreateBusinessSourceDto = z.infer<typeof createBusinessSourceSchema>;

export const updateBusinessSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    category: z.enum(SOURCE_CATEGORIES).optional(),
    palette: z.enum(TAG_COLORS).optional(),
    registrationNo: optionalText(40),
    defaultMarketSegmentId: z.string().uuid().nullable().optional(),
    collectsTourismTax: z.boolean().optional(),
    sort: z.number().int().min(0).max(100_000).optional(),
    active: z.boolean().optional(),
    ...commissionFields,
  })
  .strict()
  .refine(commissionIsSane, { message: 'a percentage commission cannot exceed 100' });
export type UpdateBusinessSourceDto = z.infer<typeof updateBusinessSourceSchema>;

export const createMarketSegmentSchema = z
  .object({
    code: shortCode(16),
    name: z.string().trim().min(1).max(120),
    group: z.enum(MARKET_SEGMENT_GROUPS).default('transient'),
    palette: z.enum(TAG_COLORS).default('slate'),
    excludedFromSold: z.boolean().default(false),
    sort: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
export type CreateMarketSegmentDto = z.infer<typeof createMarketSegmentSchema>;

export const updateMarketSegmentSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    group: z.enum(MARKET_SEGMENT_GROUPS).optional(),
    palette: z.enum(TAG_COLORS).optional(),
    excludedFromSold: z.boolean().optional(),
    sort: z.number().int().min(0).max(100_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateMarketSegmentDto = z.infer<typeof updateMarketSegmentSchema>;

export const createPaymentMethodSchema = z
  .object({
    code: shortCode(16),
    name: z.string().trim().min(1).max(80),
    shortName: z.string().trim().min(1).max(24),
    category: z.enum(PAYMENT_CATEGORIES),
    propertyId: z.string().uuid().nullable().optional(),
    requiresReference: z.boolean().default(false),
    isDefaultCash: z.boolean().default(false),
    isGuestAdvance: z.boolean().default(false),
    currency: z.enum(SUPPORTED_CURRENCIES).nullable().optional(),
    sort: z.number().int().min(0).max(100_000).optional(),
  })
  .strict()
  .refine((v) => !v.isDefaultCash || v.category === 'cash', {
    message: 'only a cash method can be the default cash method',
  });
export type CreatePaymentMethodDto = z.infer<typeof createPaymentMethodSchema>;

export const updatePaymentMethodSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    shortName: z.string().trim().min(1).max(24).optional(),
    category: z.enum(PAYMENT_CATEGORIES).optional(),
    propertyId: z.string().uuid().nullable().optional(),
    requiresReference: z.boolean().optional(),
    isDefaultCash: z.boolean().optional(),
    isGuestAdvance: z.boolean().optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).nullable().optional(),
    sort: z.number().int().min(0).max(100_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdatePaymentMethodDto = z.infer<typeof updatePaymentMethodSchema>;

export const createSalesPersonSchema = z
  .object({
    code: shortCode(32),
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().nullable().optional(),
    phone: optionalText(40),
    mobile: optionalText(40),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => isCountryCode(c), 'unknown country')
      .nullable()
      .optional(),
  })
  .strict();
export type CreateSalesPersonDto = z.infer<typeof createSalesPersonSchema>;

export const updateSalesPersonSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    email: z.string().trim().email().nullable().optional(),
    phone: optionalText(40),
    mobile: optionalText(40),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => isCountryCode(c), 'unknown country')
      .nullable()
      .optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateSalesPersonDto = z.infer<typeof updateSalesPersonSchema>;

export const applyPresetSchema = z.object({ country: z.enum(HOME_MARKETS) }).strict();
export type ApplyPresetDto = z.infer<typeof applyPresetSchema>;
