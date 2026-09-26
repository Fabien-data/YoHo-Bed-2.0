import type { Icon } from '@phosphor-icons/react';
import {
  Bed,
  Buildings,
  CalendarDots,
  ChartPieSlice,
  ChatText,
  Confetti,
  CreditCard,
  CurrencyCircleDollar,
  EnvelopeSimple,
  ForkKnife,
  HandCoins,
  IdentificationBadge,
  ListNumbers,
  Percent,
  SealPercent,
  ShoppingBag,
  SlidersHorizontal,
  Storefront,
  Swatches,
  Tag,
  UserCircle,
  Van,
} from '@phosphor-icons/react';

/**
 * Configuration's sections, grouped the way Yanolja groups them (owner brief, 2026-09-26): its
 * building menu (the property itself), its gear menu (the settings lists), and YoHoBed's own desk
 * settings. One registry feeds the side navigation, the page titles and the old `?tab=` links.
 */
export interface ConfigSection {
  slug: string;
  label: string;
  description: string;
  icon: Icon;
  group: 'property' | 'settings' | 'desk';
}

export const CONFIG_GROUPS: Array<{ key: ConfigSection['group']; label: string }> = [
  { key: 'property', label: 'Property' },
  { key: 'settings', label: 'Settings' },
  { key: 'desk', label: 'Front desk' },
];

export const CONFIG_SECTIONS: ConfigSection[] = [
  {
    slug: 'profile',
    label: 'Hotel profile',
    description: 'Who you are, where you are, what you offer and your house rules.',
    icon: Buildings,
    group: 'property',
  },
  {
    slug: 'room-types',
    label: 'Room types',
    description:
      'How your rooms look, feel and sell — from amenities to how many guests each type takes.',
    icon: Bed,
    group: 'property',
  },
  {
    slug: 'rate-types',
    label: 'Rate types',
    description: 'The pricing structures you sell, with the meals and add-ons they include.',
    icon: Tag,
    group: 'property',
  },
  {
    slug: 'rate-plans',
    label: 'Rate plans',
    description:
      'Which room type sells under which rate type, for whom, and in which configurations.',
    icon: CalendarDots,
    group: 'property',
  },
  {
    slug: 'taxes',
    label: 'Taxes',
    description: 'The taxes on a room night, tax by tax, and the levies charged beside them.',
    icon: Percent,
    group: 'property',
  },
  {
    slug: 'payment-methods',
    label: 'Payment',
    description: 'How guests pay: cash, cards, transfers, QR and the city ledger.',
    icon: CreditCard,
    group: 'settings',
  },
  {
    slug: 'extra-charges',
    label: 'Extra charges',
    description: 'What the desk posts to a bill: minibar, laundry, a restaurant ticket.',
    icon: ShoppingBag,
    group: 'settings',
  },
  {
    slug: 'discounts',
    label: 'Discounts',
    description: 'Named discounts the desk applies to a reservation’s rate.',
    icon: SealPercent,
    group: 'settings',
  },
  {
    slug: 'currency',
    label: 'Currency',
    description: 'The currency you price in, and the exchange rates the desk sees.',
    icon: CurrencyCircleDollar,
    group: 'settings',
  },
  {
    slug: 'transport',
    label: 'Transport types',
    description: 'The vehicles you send for pick-ups and drop-offs, and their prices.',
    icon: Van,
    group: 'settings',
  },
  {
    slug: 'payouts',
    label: 'Payouts',
    description: 'Why money leaves the till — picked on every expense voucher.',
    icon: HandCoins,
    group: 'settings',
  },
  {
    slug: 'meal-plans',
    label: 'Meal plans',
    description: 'The meal plans you sell and what you call them.',
    icon: ForkKnife,
    group: 'settings',
  },
  {
    slug: 'remarks',
    label: 'Remarks',
    description: 'Saved remarks the desk adds to a reservation with one click.',
    icon: ChatText,
    group: 'settings',
  },
  {
    slug: 'market-segments',
    label: 'Market segments',
    description: 'Why guests stay — every reservation carries one, and revenue splits by it.',
    icon: ChartPieSlice,
    group: 'settings',
  },
  {
    slug: 'business-sources',
    label: 'Business sources',
    description: 'Where reservations come from: walk-in, phone, social media, the OTAs.',
    icon: Storefront,
    group: 'settings',
  },
  {
    slug: 'holidays',
    label: 'Holidays',
    description: 'Public holidays and special dates, marked on Stay View and the rates calendar.',
    icon: Confetti,
    group: 'settings',
  },
  {
    slug: 'reservation-types',
    label: 'Reservation types',
    description: 'What the five reservation types are called and how they are coloured.',
    icon: Swatches,
    group: 'settings',
  },
  {
    slug: 'guest-attributes',
    label: 'Guest attributes',
    description: 'Labels you put on guests — repeat guest, allergy — shown on all their stays.',
    icon: IdentificationBadge,
    group: 'settings',
  },
  {
    slug: 'reservation-settings',
    label: 'Reservation settings',
    description: 'How the desk works: holds, price authority, check-in and check-out, the night.',
    icon: SlidersHorizontal,
    group: 'desk',
  },
  {
    slug: 'sales-persons',
    label: 'Sales persons',
    description: 'Who sold the stay, for commission and reports.',
    icon: UserCircle,
    group: 'desk',
  },
  {
    slug: 'document-numbering',
    label: 'Document numbering',
    description: 'How invoices, bills and credit notes are numbered.',
    icon: ListNumbers,
    group: 'desk',
  },
  {
    slug: 'email-templates',
    label: 'Email templates',
    description: 'The emails guests receive — the voucher, the thank-you — in your words.',
    icon: EnvelopeSimple,
    group: 'desk',
  },
];

export const sectionOf = (slug: string) => CONFIG_SECTIONS.find((s) => s.slug === slug);

export { LEGACY_TABS } from './legacy-tabs';
