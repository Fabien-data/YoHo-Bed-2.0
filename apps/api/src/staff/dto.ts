import { z } from 'zod';

export const setTenantStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended']),
});
export type SetTenantStatusDto = z.infer<typeof setTenantStatusSchema>;

export const rejectSchema = z.object({ reason: z.string().max(500).optional() });
export type RejectDto = z.infer<typeof rejectSchema>;
