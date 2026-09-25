import { z } from 'zod';
import { MEAL_PLANS } from '@yohobed/domain';

const addOnSchema = z
  .object({
    chargeParticularId: z.string().uuid().nullable().default(null),
    name: z.string().trim().min(1).max(80),
    amount: z.number().min(0).max(10_000_000),
    rhythm: z.enum(['once', 'per_night']).default('once'),
  })
  .strict();

const shortCode = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .regex(/^[A-Za-z0-9-]+$/, 'letters, digits and - only');

export const createRateTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    shortCode,
    mealPlan: z.enum(MEAL_PLANS).default('RO'),
    addOns: z.array(addOnSchema).max(10).default([]),
    description: z.string().trim().max(1000).nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();
export type CreateRateTypeDto = z.infer<typeof createRateTypeSchema>;

export const updateRateTypeSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    shortCode: shortCode.optional(),
    mealPlan: z.enum(MEAL_PLANS).optional(),
    addOns: z.array(addOnSchema).max(10).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateRateTypeDto = z.infer<typeof updateRateTypeSchema>;

export const orderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict();
export type OrderDto = z.infer<typeof orderSchema>;

const occupancyRow = z
  .object({
    label: z.string().trim().min(1).max(60),
    accommodates: z.number().int().min(1).max(20),
  })
  .strict();

export const createRatePlanSchema = z
  .object({
    roomId: z.string().uuid(),
    rateTypeId: z.string().uuid(),
    audience: z.enum(['all', 'local', 'foreign']).default('all'),
    marketSegmentId: z.string().uuid().nullable().optional(),
    occupancies: z.array(occupancyRow).max(10).optional(),
  })
  .strict();
export type CreateRatePlanDto = z.infer<typeof createRatePlanSchema>;

export const createOccupancyRowSchema = occupancyRow;
export type CreateOccupancyRowDto = z.infer<typeof createOccupancyRowSchema>;
export const updateOccupancyRowSchema = occupancyRow.partial();
export type UpdateOccupancyRowDto = z.infer<typeof updateOccupancyRowSchema>;
