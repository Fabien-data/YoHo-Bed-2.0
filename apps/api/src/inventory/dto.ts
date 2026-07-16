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

export const restrictionsSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    /** Minimum stay (nights) for arrivals in the range. 1 = no restriction. */
    minStay: z.number().int().min(1).max(60).default(1),
    /** Maximum stay (nights) for arrivals in the range. 0 = unlimited. */
    maxStay: z.number().int().min(0).max(365).default(0),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] })
  .refine((v) => v.maxStay === 0 || v.maxStay >= v.minStay, {
    message: 'maxStay must be 0 (unlimited) or at least minStay',
    path: ['maxStay'],
  });
export type RestrictionsDto = z.infer<typeof restrictionsSchema>;

export const openAvailabilitySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    roomsToSell: z.number().int().min(0),
    status: z.enum(['Open', 'Close']).default('Open'),
  })
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] });
export type OpenAvailabilityDto = z.infer<typeof openAvailabilitySchema>;
