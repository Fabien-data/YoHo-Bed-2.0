import { z } from 'zod';

/**
 * Staff manual rate override. LKR is the pivot (always 1) and can never be overridden, so the base
 * is restricted to the non-LKR tracked currencies. `rate` is "1 base = rate LKR".
 */
export const fxOverrideSchema = z.object({
  base: z.enum(['USD', 'INR', 'MYR', 'GBP', 'EUR']),
  rate: z.number().positive(),
  note: z.string().max(500).optional(),
});
export type FxOverrideDto = z.infer<typeof fxOverrideSchema>;
