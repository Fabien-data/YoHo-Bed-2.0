import { z } from 'zod';

export const updateTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(5000),
  /** Only a hotel's own check-out email has a name to change. */
  name: z.string().trim().min(1).max(60).optional(),
});
export type UpdateTemplateDto = z.infer<typeof updateTemplateSchema>;

/** A check-out email of the hotel's own (Configuration → Email templates, 2026-09-26). */
export const createTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    subject: z.string().trim().min(1).max(200),
    body: z.string().min(1).max(5000),
  })
  .strict();
export type CreateTemplateDto = z.infer<typeof createTemplateSchema>;
