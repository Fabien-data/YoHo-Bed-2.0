import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const stayViewQuerySchema = z
  .object({
    propertyId: z.string().uuid(),
    from: isoDate,
    /** Exclusive, like every other date range in the system. */
    to: isoDate,
    ratePlanId: z.string().uuid().optional(),
  })
  .refine((v) => v.to > v.from, { message: 'to must be after from', path: ['to'] })
  // A window is cheap to widen client-side but expensive to render; 120 nights is well past the
  // widest useful view and stops a stray query pulling a year of bars.
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 120, {
    message: 'window may not exceed 120 nights',
    path: ['to'],
  });
export type StayViewQueryDto = z.infer<typeof stayViewQuerySchema>;

export const createBlockSchema = z
  .object({
    roomUnitId: z.string().uuid(),
    blockFrom: isoDate,
    blockTo: isoDate,
    reason: z.string().min(1).max(200),
  })
  .refine((v) => v.blockTo > v.blockFrom, {
    message: 'blockTo must be after blockFrom',
    path: ['blockTo'],
  });
export type CreateBlockDto = z.infer<typeof createBlockSchema>;

export const updateBlockSchema = z
  .object({
    blockFrom: isoDate.optional(),
    blockTo: isoDate.optional(),
    reason: z.string().min(1).max(200).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateBlockDto = z.infer<typeof updateBlockSchema>;
