import { z } from 'zod';

export const updateTemplateSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});
export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;
