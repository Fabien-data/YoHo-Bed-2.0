import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '@yohobed/domain';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const recordPaymentSchema = z.object({
  direction: z.enum(['received', 'sent']),
  amount: z.number().positive(),
  /**
   * Optional assertion, not a choice: the payment is stored in the booking's currency regardless.
   * Supplying it makes an integrating client's assumption explicit so a mismatch fails loudly
   * instead of booking a dollar figure against a rupee invoice.
   */
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
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
