import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const createBookingSchema = z
  .object({
    roomId: z.string().uuid(),
    occupancyId: z.string().uuid(),
    customerName: z.string().min(1).max(200),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().max(40).optional(),
    checkin: isoDate,
    checkout: isoDate,
    rooms: z.number().int().positive().default(1),
    couponCode: z.string().max(40).optional(),
    referralCode: z.string().max(40).optional(),
  })
  .refine((v) => v.checkout > v.checkin, {
    message: 'checkout must be after checkin',
    path: ['checkout'],
  });
export type CreateBookingDto = z.infer<typeof createBookingSchema>;

export const rejectSchema = z.object({ reason: z.string().max(500).optional() });
export type RejectDto = z.infer<typeof rejectSchema>;

/** Amend (Compartment G): guest details and/or the stay. Empty string clears email/phone. */
export const amendBookingSchema = z
  .object({
    customerName: z.string().min(1).max(200).optional(),
    customerEmail: z.union([z.string().email(), z.literal('')]).optional(),
    customerPhone: z.string().max(40).optional(),
    checkin: isoDate.optional(),
    checkout: isoDate.optional(),
    rooms: z.number().int().positive().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to amend' });
export type AmendBookingDto = z.infer<typeof amendBookingSchema>;
