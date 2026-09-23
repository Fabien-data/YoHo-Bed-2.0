import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * Ceiling on writable date ranges. These endpoints upsert one row per day inside a transaction,
 * so an uncapped range ("2020-01-01".."2999-12-31") is ~357k sequential writes holding a pool
 * connection — a one-request denial of service. Two years covers any real ARI horizon.
 */
export const MAX_RANGE_DAYS = 731;
export const rangeWithinCap = (v: { from: string; to: string }) =>
  (Date.parse(`${v.to}T00:00:00Z`) - Date.parse(`${v.from}T00:00:00Z`)) / 86_400_000 <
  MAX_RANGE_DAYS;
export const rangeCapMessage = {
  message: `date range must be under ${MAX_RANGE_DAYS} days`,
  path: ['to'] as ['to'],
};

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
  .refine(rangeWithinCap, rangeCapMessage)
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
  .refine((v) => v.to >= v.from, { message: 'to must be on or after from', path: ['to'] })
  .refine(rangeWithinCap, rangeCapMessage);
export type OpenAvailabilityDto = z.infer<typeof openAvailabilitySchema>;

// --- Room units (physical rooms) ---------------------------------------------

export const createRoomUnitSchema = z.object({
  roomId: z.string().uuid(),
  /** What the tape chart shows. Free-form so "01", "1A" and "Villa 3" all work. */
  code: z.string().min(1).max(32),
  displayName: z.string().trim().max(120).nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  floor: z.string().max(32).optional(),
  notes: z.string().max(500).optional(),
  smokingPolicy: z.enum(['unspecified', 'smoking', 'non_smoking']).optional(),
  wheelchairAccessible: z.boolean().optional(),
  connectedRoomUnitId: z.string().uuid().nullable().optional(),
});
export type CreateRoomUnitDto = z.infer<typeof createRoomUnitSchema>;
export const bulkRoomUnitsSchema = z
  .object({ units: z.array(createRoomUnitSchema).min(1).max(200) })
  .strict();
export type BulkRoomUnitsDto = z.infer<typeof bulkRoomUnitsSchema>;

export const updateRoomUnitSchema = z
  .object({
    code: z.string().min(1).max(32).optional(),
    displayName: z.string().trim().max(120).nullable().optional(),
    displayOrder: z.number().int().min(0).optional(),
    floor: z.string().max(32).nullable().optional(),
    notes: z.string().max(500).nullable().optional(),
    smokingPolicy: z.enum(['unspecified', 'smoking', 'non_smoking']).optional(),
    wheelchairAccessible: z.boolean().optional(),
    connectedRoomUnitId: z.string().uuid().nullable().optional(),
    mapX: z.number().int().min(0).max(1000).nullable().optional(),
    mapY: z.number().int().min(0).max(1000).nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });
export type UpdateRoomUnitDto = z.infer<typeof updateRoomUnitSchema>;

/** `roomUnitId: null` un-assigns the leg, which is how a room is freed without cancelling. */
export const assignRoomsSchema = z.object({
  assignments: z
    .array(
      z.object({
        legId: z.string().uuid(),
        roomUnitId: z.string().uuid().nullable(),
        expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1),
});
export type AssignRoomsDto = z.infer<typeof assignRoomsSchema>;

export const moveRoomSchema = z.object({
  legId: z.string().uuid(),
  toRoomUnitId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  /** Today or omitted applies immediately; a later date creates a stoppable planned move. */
  effectiveDate: isoDate.optional(),
});
export type MoveRoomDto = z.infer<typeof moveRoomSchema>;

export const exchangeRoomsSchema = z
  .object({
    legId: z.string().uuid(),
    otherLegId: z.string().uuid(),
  })
  .refine((v) => v.legId !== v.otherLegId, { message: 'choose two different room assignments' });
export type ExchangeRoomsDto = z.infer<typeof exchangeRoomsSchema>;
