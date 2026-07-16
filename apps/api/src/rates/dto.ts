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

export const createRatePlanSchema = z.object({ rateCodeId: z.string().uuid() });
export type CreateRatePlanDto = z.infer<typeof createRatePlanSchema>;

export const createOccupancySchema = z.object({
  label: z.string().min(1).max(60),
  accommodates: z.number().int().min(1).max(20),
});
export type CreateOccupancyDto = z.infer<typeof createOccupancySchema>;

export const createSeasonSchema = z
  .object({ name: z.string().min(1).max(80), from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type CreateSeasonDto = z.infer<typeof createSeasonSchema>;

export const applySeasonSchema = z.object({
  prices: z.array(z.object({ occupancyId: z.string().uuid(), base: z.number().positive() })).min(1),
});
export type ApplySeasonDto = z.infer<typeof applySeasonSchema>;

export const lastMinuteDropSchema = z
  .object({ from: isoDate, to: isoDate, dropPct: z.number().min(0).max(90) })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type LastMinuteDropDto = z.infer<typeof lastMinuteDropSchema>;
