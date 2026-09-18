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

/** Reservation types, plus `holds` for both hold kinds at once. */
const KIND_FILTERS = [
  'confirm',
  'hold_confirm',
  'hold_unconfirm',
  'inquiry',
  'online_failed',
  'holds',
] as const;

/** What the list, the group cards and the export share: which reservations. */
const reservationFilterFields = {
  propertyId: z.string().uuid(),
  /** The business date the tabs are counted for. */
  date: isoDate,
  /** Free text over reference (a master reference finds every room), voucher, guest name, email and phone. */
  q: z.string().max(120).optional(),
  source: z.enum(['Extranet', 'OTA', 'Backend']).optional(),
  kind: z.enum(KIND_FILTERS).optional(),
  origin: z.enum(['direct', 'ota', 'travel_agent', 'corporate']).optional(),
  businessSourceId: z.string().uuid().optional(),
  marketSegmentId: z.string().uuid().optional(),
  /** The travel agent or company. */
  ledgerAccountId: z.string().uuid().optional(),
  /** The user who took the reservation. */
  createdBy: z.string().uuid().optional(),
  /** One group's rooms, whatever their dates or state: the tab is ignored. */
  groupId: z.string().uuid().optional(),
};

export const reservationQuerySchema = z.object({
  ...reservationFilterFields,
  tab: z
    .enum(['all', 'upcoming', 'booked', 'arrivals', 'departures', 'inhouse', 'cancelled'])
    .default('all'),
  // NOT z.coerce.boolean(): that maps the query string "false" to true (any non-empty string is
  // truthy), silently inverting the filter.
  groupsOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReservationQueryDto = z.infer<typeof reservationQuerySchema>;

/** The export takes the list's filters and tab, and every page. */
export const reservationExportSchema = reservationQuerySchema.omit({ limit: true, offset: true });
export type ReservationExportDto = z.infer<typeof reservationExportSchema>;

/** Group cards: Yanolja's group view. */
export const reservationGroupQuerySchema = z.object({
  propertyId: z.string().uuid(),
  date: isoDate,
  tab: z.enum(['upcoming', 'inhouse', 'departed']).default('upcoming'),
  q: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(24),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ReservationGroupQueryDto = z.infer<typeof reservationGroupQuerySchema>;

/** Merge whole groups into one, whose owner stays the owner. */
export const mergeGroupsSchema = z
  .object({
    targetGroupId: z.string().uuid(),
    groupIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .refine((v) => !v.groupIds.includes(v.targetGroupId), {
    message: 'the group to keep cannot also be merged into itself',
    path: ['groupIds'],
  });
export type MergeGroupsDto = z.infer<typeof mergeGroupsSchema>;

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
