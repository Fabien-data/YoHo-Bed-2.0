import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const reserveSchema = z
  .object({
    checkin: isoDate,
    checkout: isoDate,
    rooms: z.number().int().positive().default(1),
  })
  .refine((v) => v.checkout > v.checkin, {
    message: 'checkout must be after checkin',
    path: ['checkout'],
  });
export type ReserveDto = z.infer<typeof reserveSchema>;

export const createRoomSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.number().int().min(0).default(0),
  roomtypeId: z.string().uuid().optional(),
});
export type CreateRoomDto = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  quantity: z.number().int().min(0).optional(),
  roomtypeId: z.string().uuid().nullable().optional(),
});
export type UpdateRoomDto = z.infer<typeof updateRoomSchema>;

export const roomtypeSchema = z.object({
  name: z.string().min(1).max(120),
});
export type RoomtypeDto = z.infer<typeof roomtypeSchema>;

export const openAvailabilitySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    roomsToSell: z.number().int().min(0),
    status: z.enum(['Open', 'Close']).default('Open'),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type OpenAvailabilityDto = z.infer<typeof openAvailabilitySchema>;
