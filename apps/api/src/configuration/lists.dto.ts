import { z } from 'zod';
import { TAG_COLORS } from '@yohobed/domain';

/**
 * The Settings lists Yanolja has and YoHoBed lacked (owner brief, 2026-09-26). Each has its own
 * shape; they share one controller, so a new list is a schema and a table, not a new module.
 */
export const LIST_KEYS = [
  'holidays',
  'guest-attributes',
  'discounts',
  'remarks',
  'payout-types',
] as const;
export type ListKey = (typeof LIST_KEYS)[number];
export const isListKey = (v: string): v is ListKey => (LIST_KEYS as readonly string[]).includes(v);

/** Lists kept per property (a holiday, a discount in the property's currency); others per hotel. */
export const PROPERTY_LISTS: ReadonlySet<ListKey> = new Set(['holidays', 'discounts']);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const code = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, - and _ only')
  .transform((v) => v.toUpperCase());
const sort = z.number().int().min(0).max(100_000);

export const holidaySchema = z
  .object({
    date: isoDate,
    name: z.string().trim().min(1).max(80),
    recurring: z.boolean().default(false),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const guestAttributeSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    color: z.enum(TAG_COLORS).default('slate'),
    description: z.string().trim().max(300).nullable().optional(),
    sort: sort.optional(),
    active: z.boolean().default(true),
  })
  .strict();

export const discountSchema = z
  .object({
    code,
    name: z.string().trim().min(1).max(60),
    kind: z.enum(['percent', 'amount']).default('percent'),
    value: z.number().positive().max(10_000_000),
    description: z.string().trim().max(300).nullable().optional(),
    sort: sort.optional(),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((d) => d.kind !== 'percent' || d.value <= 100, {
    message: 'a percentage is at most 100',
    path: ['value'],
  });

export const remarkTemplateSchema = z
  .object({
    type: z
      .enum(['general', 'front_desk', 'housekeeping', 'accounts', 'kitchen', 'preference'])
      .default('general'),
    text: z.string().trim().min(1).max(500),
    sort: sort.optional(),
    active: z.boolean().default(true),
  })
  .strict();

export const payoutTypeSchema = z
  .object({
    code,
    name: z.string().trim().min(1).max(60),
    category: z
      .enum(['supplies', 'maintenance', 'transport', 'staff', 'utilities', 'other'])
      .default('other'),
    sort: sort.optional(),
    active: z.boolean().default(true),
  })
  .strict();

/** The create schema, and the update schema (every field optional), for each list. */
export const LIST_SCHEMAS: Record<ListKey, { create: z.ZodTypeAny; update: z.ZodTypeAny }> = {
  holidays: { create: holidaySchema, update: holidaySchema.partial() },
  'guest-attributes': { create: guestAttributeSchema, update: guestAttributeSchema.partial() },
  discounts: {
    create: discountSchema,
    update: z
      .object({
        code: code.optional(),
        name: z.string().trim().min(1).max(60).optional(),
        kind: z.enum(['percent', 'amount']).optional(),
        value: z.number().positive().max(10_000_000).optional(),
        description: z.string().trim().max(300).nullable().optional(),
        sort: sort.optional(),
        active: z.boolean().optional(),
      })
      .strict(),
  },
  remarks: { create: remarkTemplateSchema, update: remarkTemplateSchema.partial() },
  'payout-types': { create: payoutTypeSchema, update: payoutTypeSchema.partial() },
};

export const holidayRangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 800 * 86_400_000, {
    message: 'at most two years at a time',
    path: ['to'],
  });
export type HolidayRangeDto = z.infer<typeof holidayRangeSchema>;

export const setGuestAttributesSchema = z
  .object({ attributeIds: z.array(z.string().uuid()).max(30) })
  .strict();
export type SetGuestAttributesDto = z.infer<typeof setGuestAttributesSchema>;
