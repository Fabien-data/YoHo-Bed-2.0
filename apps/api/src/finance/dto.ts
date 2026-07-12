import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const recordPaymentSchema = z.object({
  direction: z.enum(['received', 'sent']),
  amount: z.number().positive(),
  method: z.enum(['cash', 'card', 'bank', 'online']).default('bank'),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
});
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;

export const createPayoutSchema = z
  .object({
    propertyId: z.string().uuid(),
    from: isoDate,
    to: isoDate,
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type CreatePayoutDto = z.infer<typeof createPayoutSchema>;
