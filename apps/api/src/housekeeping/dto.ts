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

export const floorLayoutSchema = z.object({
  floor: z.string().min(1).max(32),
  expectedVersion: z.number().int().positive().nullable(),
  rooms: z
    .array(
      z.object({
        unitId: z.string().uuid(),
        x: z.number().int().min(0).max(1000),
        y: z.number().int().min(0).max(1000),
      }),
    )
    .max(1000),
  landmarks: z
    .array(
      z.object({
        id: z.string().min(1).max(50),
        kind: z.enum(['corridor', 'lift', 'stairs', 'service']),
        x: z.number().int().min(0).max(1000),
        y: z.number().int().min(0).max(1000),
        label: z.string().max(50).optional(),
      }),
    )
    .max(100),
});
export type FloorLayoutDto = z.infer<typeof floorLayoutSchema>;

export const taskQuerySchema = z.object({ date: isoDate });
export const updateTaskSchema = z
  .object({
    status: z.enum(['queued', 'in_progress', 'done', 'cancelled']).optional(),
    rush: z.boolean().optional(),
    assignedToUserId: z.string().uuid().nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateTaskDto = z.infer<typeof updateTaskSchema>;

export const roomSignalsSchema = z
  .object({ doNotDisturb: z.boolean().optional(), requestedSafetyFlag: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type RoomSignalsDto = z.infer<typeof roomSignalsSchema>;
