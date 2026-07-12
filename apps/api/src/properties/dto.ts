import { z } from 'zod';

export const createPropertySchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreatePropertyDto = z.infer<typeof createPropertySchema>;

export const updatePropertySchema = z.object({
  name: z.string().min(1).max(200),
});
export type UpdatePropertyDto = z.infer<typeof updatePropertySchema>;
