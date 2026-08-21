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

// --- Reservations screen -----------------------------------------------------

export const reservationQuerySchema = z.object({
  propertyId: z.string().uuid(),
  /** The business date the tabs are counted for. Defaults to today at the controller. */
  date: isoDate,
  tab: z.enum(['all', 'arrivals', 'departures', 'inhouse', 'cancelled']).default('all'),
  /** Free text over reference, guest name, email and phone. */
  q: z.string().max(120).optional(),
  source: z.enum(['Extranet', 'OTA', 'Backend']).optional(),
  groupsOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReservationQueryDto = z.infer<typeof reservationQuerySchema>;

export const makeGroupSchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(2, 'a group needs at least two reservations'),
  name: z.string().max(120).optional(),
  /** Short human reference on the card. Auto-numbered per property when omitted. */
  code: z.string().max(32).optional(),
  /** Move bookings that already belong to another group. */
  force: z.boolean().optional(),
});
export type MakeGroupDto = z.infer<typeof makeGroupSchema>;

export const mergeGroupSchema = z.object({
  bookingIds: z.array(z.string().uuid()).min(1),
});
export type MergeGroupDto = z.infer<typeof mergeGroupSchema>;
