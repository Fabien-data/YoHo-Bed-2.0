import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const revenueQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.to >= v.from, { message: 'to must not be before from', path: ['to'] });
export type RevenueQueryDto = z.infer<typeof revenueQuerySchema>;

/**
 * Running the audit (UX-1a). `keep` names unarrived bookings the desk still expects tonight — a
 * late flight, a guaranteed reservation — so the audit charges their night but does not mark them
 * no-shows. Everything else due and not arrived is a no-show, as before.
 */
export const runAuditSchema = z
  .object({ keep: z.array(z.string().uuid()).max(500).optional() })
  .default({});
export type RunAuditDto = z.infer<typeof runAuditSchema>;
