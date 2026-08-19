import { z } from 'zod';
import { DISTRIBUTION_MODES } from '@yohobed/domain';

/** Staff moves a tenant onto a plan. The code is validated against the catalogue in the service. */
export const setPlanSchema = z.object({
  planCode: z.string().min(1).max(64),
});
export type SetPlanDto = z.infer<typeof setPlanSchema>;

/** Staff flips a tenant between YoHo-distributed and standalone PMS. */
export const setDistributionModeSchema = z.object({
  mode: z.enum(DISTRIBUTION_MODES),
});
export type SetDistributionModeDto = z.infer<typeof setDistributionModeSchema>;
