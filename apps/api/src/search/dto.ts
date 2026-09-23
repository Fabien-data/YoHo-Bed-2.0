import { z } from 'zod';

/** One search across the hotel: reference, guest, phone, voucher or room number (UX-2). */
export const searchQuerySchema = z.object({
  propertyId: z.string().uuid(),
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type SearchQueryDto = z.infer<typeof searchQuerySchema>;
