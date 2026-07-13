import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** What the channel manager pushes at POST /cm/reservations. */
export const cmReservationSchema = z
  .object({
    channel: z.string().min(1).max(60),
    externalRef: z.string().min(1).max(120),
    action: z.enum(['book', 'cancel']).default('book'),
    roomCode: z.string().min(1).max(60),
    guest: z
      .object({
        name: z.string().min(1).max(200),
        email: z.string().email().optional(),
        phone: z.string().max(40).optional(),
      })
      .optional(),
    checkin: isoDate,
    checkout: isoDate,
    rooms: z.number().int().positive().default(1),
    /** What the guest paid the OTA — informational; we book at our calendar prices. */
    amount: z.number().nonnegative().optional(),
  })
  .refine((v) => v.checkout > v.checkin, {
    message: 'checkout must be after checkin',
    path: ['checkout'],
  })
  .refine((v) => v.action === 'cancel' || !!v.guest, {
    message: 'guest is required to book',
    path: ['guest'],
  });
export type CmReservationDto = z.infer<typeof cmReservationSchema>;

export const setMappingSchema = z.object({
  roomId: z.string().uuid(),
  code: z.string().min(2).max(60),
});
export type SetMappingDto = z.infer<typeof setMappingSchema>;

export const simulateSchema = z
  .object({
    roomId: z.string().uuid().optional(),
    channel: z.string().min(1).max(60).default('booking.com'),
    guestName: z.string().min(1).max(200).default('Simulated Guest'),
    checkin: isoDate,
    checkout: isoDate,
  })
  .refine((v) => v.checkout > v.checkin, {
    message: 'checkout must be after checkin',
    path: ['checkout'],
  });
export type SimulateDto = z.infer<typeof simulateSchema>;
