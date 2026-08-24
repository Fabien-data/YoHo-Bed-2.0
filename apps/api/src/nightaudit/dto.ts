import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const revenueQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: 'to must not be before from', path: ['to'] });
export type RevenueQueryDto = z.infer<typeof revenueQuerySchema>;
