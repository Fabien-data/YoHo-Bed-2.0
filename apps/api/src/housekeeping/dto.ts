import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const houseStatusQuerySchema = z.object({
  propertyId: z.string().uuid(),
  /** The business date the grid is showing. Defaults to today at the controller. */
  date: isoDate.optional(),
});
export type HouseStatusQueryDto = z.infer<typeof houseStatusQuerySchema>;

export const setHousekeepingSchema = z.object({
  roomUnitId: z.string().uuid(),
  date: isoDate,
  status: z.enum(['dirty', 'clean', 'inspected', 'out_of_order']),
  remarks: z.string().max(500).optional(),
  assignedToUserId: z.string().uuid().optional(),
});
export type SetHousekeepingDto = z.infer<typeof setHousekeepingSchema>;

export const createWorkOrderSchema = z.object({
  /** Null for a job that is not about a room — the lobby, the pool, the lift. */
  roomUnitId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  assignedToUserId: z.string().uuid().optional(),
  deadline: isoDate.optional(),
  department: z
    .enum(['housekeeping', 'maintenance', 'front_desk', 'food_beverage', 'transport', 'other'])
    .optional(),
});
export type CreateWorkOrderDto = z.infer<typeof createWorkOrderSchema>;

export const updateWorkOrderSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    status: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
    deadline: isoDate.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateWorkOrderDto = z.infer<typeof updateWorkOrderSchema>;
