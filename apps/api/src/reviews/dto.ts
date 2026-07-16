import { z } from 'zod';

export const submitReviewSchema = z.object({
  token: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});
export type SubmitReviewDto = z.infer<typeof submitReviewSchema>;
