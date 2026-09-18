/**
 * Reservation-level choices from Yanolja's Add Reservation page (Development Phase 02).
 */

/** Yanolja's "Booking Source": the category a reservation's business source belongs to. */
export const BOOKING_ORIGINS = ['direct', 'ota', 'travel_agent', 'corporate'] as const;
export type BookingOrigin = (typeof BOOKING_ORIGINS)[number];

export function isBookingOrigin(v: unknown): v is BookingOrigin {
  return typeof v === 'string' && (BOOKING_ORIGINS as readonly string[]).includes(v);
}

/** Who pays — the Billing Summary's "Bill To". */
export const BILL_TO_OPTIONS = ['guest', 'company', 'group_owner', 'company_room_tax'] as const;
export type BillTo = (typeof BILL_TO_OPTIONS)[number];

/**
 * The "Other Information" switches (`bookings.options`, jsonb). Stored sparse and resolved
 * against the defaults, like property settings.
 */
export interface ReservationOptions {
  /** Email the booking voucher, to the guest and to `voucherEmails`. */
  emailVoucher: boolean;
  voucherEmails: string[];
  /** Send a thank-you email at check-out. */
  sendCheckoutEmail: boolean;
  /** The template the check-out email uses (a `templates.key`). */
  checkoutTemplate: string | null;
  /** The guest may open their booking page (portal-lite, Sprint 6). */
  guestPortalAccess: boolean;
  /** Print the registration card without the room rate. */
  suppressRateOnGrCard: boolean;
  /** Show inclusions on their own folio lines instead of inside the room rate. */
  displayInclusionSeparately: boolean;
}

export const DEFAULT_RESERVATION_OPTIONS: ReservationOptions = {
  emailVoucher: false,
  voucherEmails: [],
  sendCheckoutEmail: false,
  checkoutTemplate: null,
  guestPortalAccess: false,
  suppressRateOnGrCard: false,
  displayInclusionSeparately: false,
};

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Resolve stored (possibly partial) options into a complete set. Bad values fall back. */
export function resolveReservationOptions(raw: unknown): ReservationOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_RESERVATION_OPTIONS;
  const flag = (k: keyof ReservationOptions) =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : (d[k] as boolean);
  const emails = Array.isArray(r.voucherEmails)
    ? [
        ...new Set(
          r.voucherEmails
            .filter((e): e is string => typeof e === 'string')
            .map((e) => e.trim().toLowerCase())
            .filter((e) => EMAIL.test(e)),
        ),
      ].slice(0, 10)
    : [];
  return {
    emailVoucher: flag('emailVoucher'),
    voucherEmails: emails,
    sendCheckoutEmail: flag('sendCheckoutEmail'),
    checkoutTemplate:
      typeof r.checkoutTemplate === 'string' && r.checkoutTemplate.trim()
        ? r.checkoutTemplate.trim().slice(0, 64)
        : null,
    guestPortalAccess: flag('guestPortalAccess'),
    suppressRateOnGrCard: flag('suppressRateOnGrCard'),
    displayInclusionSeparately: flag('displayInclusionSeparately'),
  };
}
