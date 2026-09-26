/**
 * The guest emails a hotel can word for itself (Configuration → Email templates, owner brief
 * 2026-09-26): what each one is, when it goes out, and the exact `{{variables}}` it is sent with.
 * One catalogue for the API that renders them and the screen that edits them, so the editor never
 * offers a variable the email does not have — an unknown one renders as nothing.
 */

export interface EmailVariable {
  name: string;
  /** What it becomes, in the owner's words. */
  label: string;
  /** What the preview shows for it. */
  sample: string;
}

export interface EmailTemplateSpec {
  key: string;
  label: string;
  /** When it is sent. */
  when: string;
  variables: EmailVariable[];
}

const GUEST: EmailVariable = { name: 'guestName', label: 'Guest name', sample: 'Nimal Perera' };
const REFERENCE: EmailVariable = {
  name: 'reference',
  label: 'Booking number',
  sample: '2609260001',
};
const PROPERTY: EmailVariable = {
  name: 'propertyName',
  label: 'Hotel name',
  sample: 'Lagoon Breeze Hotel',
};
const CHECKIN: EmailVariable = { name: 'checkin', label: 'Arrival date', sample: '12/10/2026' };
const CHECKOUT: EmailVariable = { name: 'checkout', label: 'Departure date', sample: '15/10/2026' };
const NIGHTS: EmailVariable = { name: 'nights', label: 'Nights', sample: '3' };

export const EMAIL_TEMPLATES: EmailTemplateSpec[] = [
  {
    key: 'booking_created',
    label: 'Booking confirmation',
    when: 'When a reservation is made and has a guest email — unless the booking voucher is emailed to that address instead.',
    variables: [
      GUEST,
      REFERENCE,
      PROPERTY,
      CHECKIN,
      CHECKOUT,
      NIGHTS,
      { name: 'total', label: 'Total, in the booking’s currency', sample: 'Rs 45,000.00' },
      { name: 'amount', label: 'Total as a bare number (older templates)', sample: '45000.00' },
    ],
  },
  {
    key: 'booking_voucher',
    label: 'Booking voucher',
    when: 'When the desk emails the voucher — from the reservation, or with “Email booking vouchers” ticked when it is made. The PDF voucher is attached.',
    variables: [
      GUEST,
      REFERENCE,
      PROPERTY,
      CHECKIN,
      { name: 'checkinTime', label: 'Check-in time', sample: '2:00 pm' },
      CHECKOUT,
      { name: 'checkoutTime', label: 'Check-out time', sample: '11:00 am' },
      NIGHTS,
      {
        name: 'rooms',
        label: 'Rooms, one line each',
        sample: '1. Deluxe Double · BB · 2 adults\n2. Family Suite · HB · 2 adults, 1 child',
      },
      { name: 'total', label: 'Total', sample: 'Rs 45,000.00' },
      { name: 'paid', label: 'Paid', sample: 'Rs 15,000.00' },
      { name: 'balance', label: 'Balance due', sample: 'Rs 30,000.00' },
      {
        name: 'linkLine',
        label: 'Link to the booking online, when there is one',
        sample: 'View your booking online: https://yova.markui.lk/v/…\n\n',
      },
      {
        name: 'propertyAddress',
        label: 'Hotel address',
        sample: '12 Beach Road, Negombo',
      },
      {
        name: 'propertyContact',
        label: 'Hotel phone and email',
        sample: 'Tel: +94 31 222 3344 · stay@lagoonbreeze.lk',
      },
    ],
  },
  {
    key: 'checkout_thank_you',
    label: 'Thank you at check-out',
    when: 'At check-out, for reservations with “Send email at check-out” ticked — the desk can pick one of your own check-out emails instead.',
    variables: [GUEST, PROPERTY, REFERENCE, CHECKIN, CHECKOUT],
  },
  {
    key: 'review_invite',
    label: 'Review invitation',
    when: 'After check-out, asking the guest to review the stay.',
    variables: [
      GUEST,
      PROPERTY,
      REFERENCE,
      CHECKIN,
      CHECKOUT,
      { name: 'link', label: 'Review link', sample: 'https://yova.markui.lk/review/…' },
    ],
  },
];

/** A check-out email the hotel added itself: `checkout_custom_<id>`. */
export const CUSTOM_CHECKOUT_PREFIX = 'checkout_custom_';

export function isCustomCheckoutKey(key: string): boolean {
  return key.startsWith(CUSTOM_CHECKOUT_PREFIX) && /^[a-z0-9_]{1,64}$/.test(key);
}

/** The catalogue entry of a template key; a hotel's own check-out email reads as the thank-you. */
export function emailTemplateSpec(key: string): EmailTemplateSpec | undefined {
  return EMAIL_TEMPLATES.find(
    (t) => t.key === (isCustomCheckoutKey(key) ? 'checkout_thank_you' : key),
  );
}

/** The preview's values for a template's variables. */
export function sampleVariables(key: string): Record<string, string> {
  return Object.fromEntries(
    (emailTemplateSpec(key)?.variables ?? []).map((v) => [v.name, v.sample]),
  );
}

/** `{{names}}` in a text that the template is not sent with — they would come out empty. */
export function unknownVariables(key: string, text: string): string[] {
  const known = new Set((emailTemplateSpec(key)?.variables ?? []).map((v) => v.name));
  const used = [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]!);
  return [...new Set(used.filter((n) => !known.has(n)))];
}
