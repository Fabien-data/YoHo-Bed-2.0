import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const openFolioSchema = z.object({
  label: z.string().min(1).max(60).optional(),
});
export type OpenFolioDto = z.infer<typeof openFolioSchema>;

/**
 * A charge either names a catalogue particular or spells itself out. Anything given explicitly
 * overrides the particular's default, so a one-off price does not need a new catalogue entry.
 */
export const postChargeSchema = z
  .object({
    particularId: z.string().uuid().optional(),
    description: z.string().min(1).max(200).optional(),
    unitPrice: z.number().finite().optional(),
    quantity: z.number().positive().default(1),
    taxRatePct: z.number().min(0).max(100).optional(),
    taxInclusive: z.boolean().optional(),
    postedFor: isoDate.optional(),
    source: z.enum(['manual', 'pos']).optional(),
  })
  .refine((v) => v.particularId || (v.description && v.unitPrice !== undefined), {
    message: 'give a particularId, or a description and a unitPrice',
  });
export type PostChargeDto = z.infer<typeof postChargeSchema>;

export const voidChargeSchema = z.object({
  reason: z.string().max(200).optional(),
});
export type VoidChargeDto = z.infer<typeof voidChargeSchema>;

export const transferChargesSchema = z.object({
  chargeIds: z.array(z.string().uuid()).min(1),
  toFolioId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});
export type TransferChargesDto = z.infer<typeof transferChargesSchema>;

export const recordFolioPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(['cash', 'card', 'bank', 'online']).default('cash'),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});
export type RecordFolioPaymentDto = z.infer<typeof recordFolioPaymentSchema>;

export const createParticularSchema = z.object({
  propertyId: z.string().uuid().optional(),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  category: z.enum(['room', 'food', 'beverage', 'service', 'misc']).default('misc'),
  defaultPrice: z.number().min(0).default(0),
  taxRatePct: z.number().min(0).max(100).default(0),
  taxInclusive: z.boolean().default(true),
});
export type CreateParticularDto = z.infer<typeof createParticularSchema>;

export const unsettledQuerySchema = z.object({
  propertyId: z.string().uuid(),
});
export type UnsettledQueryDto = z.infer<typeof unsettledQuerySchema>;
