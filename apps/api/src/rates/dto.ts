import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const setPriceSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    base: z.number().positive(),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type SetPriceDto = z.infer<typeof setPriceSchema>;
