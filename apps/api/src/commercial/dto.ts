import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const createPromotionSchema = z
  .object({
    name: z.string().min(1).max(80),
    discountPct: z.number().min(0).max(90),
    from: isoDate,
    to: isoDate,
    minNights: z.number().int().min(1).max(60).default(1),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type CreatePromotionDto = z.infer<typeof createPromotionSchema>;

export const createCouponSchema = z
  .object({
    code: z.string().min(2).max(40),
    type: z.enum(['percentage', 'fixed']),
    value: z.number().positive(),
    from: isoDate,
    to: isoDate,
    maxUses: z.number().int().min(0).default(0),
    propertyId: z.string().uuid().optional(),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type CreateCouponDto = z.infer<typeof createCouponSchema>;

export const createReferralPartnerSchema = z.object({
  name: z.string().min(1).max(80),
  code: z.string().min(2).max(40),
  commissionPct: z.number().min(0).max(90),
});
export type CreateReferralPartnerDto = z.infer<typeof createReferralPartnerSchema>;
