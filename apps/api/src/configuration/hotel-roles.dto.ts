import { z } from 'zod';
import { HOTEL_PERMISSIONS } from '@yohobed/db';

export const roleDefinitionSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    permissions: z
      .array(z.enum(HOTEL_PERMISSIONS))
      .max(HOTEL_PERMISSIONS.length)
      .refine(
        (items) => new Set(items).size === items.length,
        'A permission appears more than once.',
      ),
    propertyIds: z
      .array(z.string().uuid())
      .max(500)
      .refine(
        (items) => new Set(items).size === items.length,
        'A property appears more than once.',
      ),
  })
  .strict();
export const roleAssignmentSchema = z.object({ userId: z.string().uuid() }).strict();
export type RoleDefinitionDto = z.infer<typeof roleDefinitionSchema>;
export type RoleAssignmentDto = z.infer<typeof roleAssignmentSchema>;
