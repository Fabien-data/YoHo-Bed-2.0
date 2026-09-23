import type { HomeMarket } from './countries';
import type { MealCodeStyle } from './meal-codes';
import type { TimeFormat } from './format';

/**
 * What a new property in each home market starts with.
 *
 * Presets are DATA ONLY: they are copied into a tenant's own tables once and are fully editable
 * afterwards. Nothing reads a preset at booking time, so changing one here never changes an
 * existing hotel's behaviour.
 *
 * Sources for the choices below (research of 2026-09-17): the payment methods each market's guests
 * actually use (LankaQR / FriMi / eZ Cash in Sri Lanka; DuitNow / FPX / Touch 'n Go in Malaysia;
 * UPI / RuPay / NEFT in India), each market's leading OTAs, and a market-segment list built from the
 * STR/OPERA conventions plus the segments these markets report separately (MICE, weddings,
 * pilgrimage, tour-operator FIT).
 */

export const MARKET_SEGMENT_GROUPS = ['transient', 'group', 'contract', 'non_revenue'] as const;
export type MarketSegmentGroup = (typeof MARKET_SEGMENT_GROUPS)[number];

export const SOURCE_CATEGORIES = ['direct', 'ota', 'travel_agent', 'corporate'] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

export const PAYMENT_CATEGORIES = [
  'cash',
  'card',
  'bank_transfer',
  'qr',
  'wallet',
  'cheque',
  'city_ledger',
  'online',
  'other',
] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export interface MarketSegmentSeed {
  code: string;
  name: string;
  group: MarketSegmentGroup;
  /** A TAG_COLORS key from @yohobed/domain. */
  palette: string;
  /** Complimentary and house-use rooms are not "sold" in occupancy and ADR (STR rule). */
  excludedFromSold?: boolean;
}

export interface BusinessSourceSeed {
  shortCode: string;
  name: string;
  category: SourceCategory;
  palette: string;
  /** Code of the market segment a new reservation from this source defaults to. */
  defaultSegment: string;
}

export interface PaymentMethodSeed {
  code: string;
  name: string;
  shortName: string;
  category: PaymentCategory;
  requiresReference?: boolean;
  isDefaultCash?: boolean;
  /** For a foreign-cash drawer line such as "Cash (USD)". */
  currency?: string;
}

/** One tax a regional preset sets up (Sprint 7, tax engine v2). */
export interface TaxPresetSeed {
  code: string;
  name: string;
  /** What documents print, when it differs from `name`. */
  invoiceLabel?: string;
  priority: 1 | 2 | 3;
  /** Charged on the price plus the taxes before it. */
  compound: boolean;
  /** Whether a tax-exempt guest is excused from it (never a service charge). */
  exemptible: boolean;
  displayGroup: 'single' | 'gst_split';
  /** One rate, or several slabs chosen by the pre-tax value per room per night. */
  rates: Array<{ ratePercent: number; minAmount?: number; maxAmount?: number }>;
  /** When the rates took effect. */
  from: string;
}

export interface LevyPresetSeed {
  code: string;
  name: string;
  amount: number;
  currency: string;
  appliesTo: 'non_resident' | 'all';
  from: string;
}

/**
 * The tax set-up a regional preset applies (Sprint 7). DATA ONLY, like the rest of the preset:
 * applying it copies these rows into the property's own tax tables. The rules are as researched
 * on 2026-09-17 and are switched on for live hotels only after a tax adviser signs them off:
 *
 * - Malaysia: 10% service charge, then 8% SST charged on the room plus the service charge
 *   (`compound` — the one point still to confirm), and RM10 Tourism Tax per room per night for
 *   foreign guests.
 * - India: GST 5% up to ₹7,500 per room per night, 18% above (rates in force from 2025-09-22),
 *   printed as CGST + SGST.
 */
export interface TaxPreset {
  taxMode: 'exclusive_forward';
  taxes: TaxPresetSeed[];
  levies: LevyPresetSeed[];
  /** Turn on Malaysia's guest-register check at check-in. */
  requireGuestRegistration: boolean;
}

export interface RegionPreset {
  country: HomeMarket;
  /** Null for Sri Lanka, whose taxes run on the legacy inclusive engine and are set up by hand. */
  tax: TaxPreset | null;
  timezone: string;
  /** Base currencies a property here may price in; the first is the default. */
  baseCurrencies: string[];
  timeFormat: TimeFormat;
  mealCodeStyle: MealCodeStyle;
  /** First month of the accounting / invoice-numbering year (1 = January). */
  fyStartMonth: number;
  /** What the property's tax registration number is called on documents. */
  taxRegistrationLabel: string;
  /** What "bill it to the company" is called at this desk. */
  cityLedgerLabel: string;
  marketSegments: MarketSegmentSeed[];
  businessSources: BusinessSourceSeed[];
  paymentMethods: PaymentMethodSeed[];
}

const SEGMENTS: MarketSegmentSeed[] = [
  { code: 'BAR', name: 'Retail / Direct FIT', group: 'transient', palette: 'blue' },
  { code: 'OTA', name: 'OTA (Online Travel Agent)', group: 'transient', palette: 'sky' },
  { code: 'DISC', name: 'Discount & Packages', group: 'transient', palette: 'cyan' },
  {
    code: 'QUAL',
    name: 'Qualified (Loyalty, Senior, Resident)',
    group: 'transient',
    palette: 'teal',
  },
  { code: 'CORP', name: 'Corporate Negotiated', group: 'transient', palette: 'indigo' },
  { code: 'GOV', name: 'Government & Diplomatic', group: 'transient', palette: 'slate' },
  {
    code: 'WHS',
    name: 'Wholesale / DMC / Tour Operator FIT',
    group: 'transient',
    palette: 'violet',
  },
  { code: 'CREW', name: 'Airline Crew', group: 'transient', palette: 'emerald' },
  { code: 'GIT', name: 'Tour Series / Leisure Groups', group: 'group', palette: 'purple' },
  {
    code: 'MICE',
    name: 'MICE (Meetings, Incentives, Conferences, Events)',
    group: 'group',
    palette: 'orange',
  },
  { code: 'WED', name: 'Weddings & Social Events', group: 'group', palette: 'pink' },
  { code: 'ASSN', name: 'Association / Convention', group: 'group', palette: 'amber' },
  { code: 'GGOV', name: 'Government Group', group: 'group', palette: 'lime' },
  {
    code: 'SMERF',
    name: 'SMERF (Social, Military, Education, Religious, Fraternal)',
    group: 'group',
    palette: 'yellow',
  },
  { code: 'LONG', name: 'Long Stay / Contract', group: 'contract', palette: 'green' },
  {
    code: 'COMP',
    name: 'Complimentary',
    group: 'non_revenue',
    palette: 'rose',
    excludedFromSold: true,
  },
  { code: 'HU', name: 'House Use', group: 'non_revenue', palette: 'red', excludedFromSold: true },
];

const PILGRIMAGE: MarketSegmentSeed = {
  code: 'PILG',
  name: 'Pilgrimage',
  group: 'transient',
  palette: 'amber',
};

const DIRECT_SOURCES: BusinessSourceSeed[] = [
  {
    shortCode: 'WLK',
    name: 'Walk-in',
    category: 'direct',
    palette: 'slate',
    defaultSegment: 'BAR',
  },
  { shortCode: 'PHN', name: 'Phone', category: 'direct', palette: 'sky', defaultSegment: 'BAR' },
  {
    shortCode: 'WAP',
    name: 'WhatsApp',
    category: 'direct',
    palette: 'green',
    defaultSegment: 'BAR',
  },
  { shortCode: 'EML', name: 'Email', category: 'direct', palette: 'indigo', defaultSegment: 'BAR' },
  {
    shortCode: 'IBE',
    name: 'Website / Booking Engine',
    category: 'direct',
    palette: 'teal',
    defaultSegment: 'BAR',
  },
  {
    shortCode: 'CRP',
    name: 'Corporate',
    category: 'corporate',
    palette: 'emerald',
    defaultSegment: 'CORP',
  },
  {
    shortCode: 'DMC',
    name: 'Tour Operator / DMC',
    category: 'travel_agent',
    palette: 'violet',
    defaultSegment: 'WHS',
  },
];

const GLOBAL_OTAS: BusinessSourceSeed[] = [
  {
    shortCode: 'BDC',
    name: 'Booking.com',
    category: 'ota',
    palette: 'blue',
    defaultSegment: 'OTA',
  },
  { shortCode: 'AGD', name: 'Agoda', category: 'ota', palette: 'rose', defaultSegment: 'OTA' },
  { shortCode: 'EXP', name: 'Expedia', category: 'ota', palette: 'amber', defaultSegment: 'OTA' },
  { shortCode: 'ABB', name: 'Airbnb', category: 'ota', palette: 'pink', defaultSegment: 'OTA' },
  { shortCode: 'TRP', name: 'Trip.com', category: 'ota', palette: 'cyan', defaultSegment: 'OTA' },
];

const CARDS: PaymentMethodSeed[] = [
  { code: 'CC', name: 'Credit Card', shortName: 'Credit', category: 'card' },
  { code: 'DC', name: 'Debit Card', shortName: 'Debit', category: 'card' },
];

export const REGION_PRESETS: Record<HomeMarket, RegionPreset> = {
  LK: {
    country: 'LK',
    tax: null,
    timezone: 'Asia/Colombo',
    baseCurrencies: ['LKR', 'USD'],
    timeFormat: '12h',
    mealCodeStyle: 'international',
    fyStartMonth: 4,
    taxRegistrationLabel: 'TIN / VAT Reg. No.',
    cityLedgerLabel: 'City Ledger',
    marketSegments: [...SEGMENTS, PILGRIMAGE],
    businessSources: [...DIRECT_SOURCES, ...GLOBAL_OTAS],
    paymentMethods: [
      {
        code: 'CASH',
        name: 'Cash (LKR)',
        shortName: 'Cash',
        category: 'cash',
        isDefaultCash: true,
      },
      {
        code: 'CASHUSD',
        name: 'Cash (USD)',
        shortName: 'Cash USD',
        category: 'cash',
        currency: 'USD',
      },
      ...CARDS,
      {
        code: 'BANK',
        name: 'Bank Transfer (CEFTS / SLIPS)',
        shortName: 'Bank',
        category: 'bank_transfer',
        requiresReference: true,
      },
      {
        code: 'LANKAQR',
        name: 'LankaQR',
        shortName: 'LankaQR',
        category: 'qr',
        requiresReference: true,
      },
      { code: 'FRIMI', name: 'FriMi', shortName: 'FriMi', category: 'wallet' },
      { code: 'EZCASH', name: 'eZ Cash', shortName: 'eZ Cash', category: 'wallet' },
      { code: 'MCASH', name: 'mCash', shortName: 'mCash', category: 'wallet' },
      { code: 'GENIE', name: 'Genie', shortName: 'Genie', category: 'wallet' },
      {
        code: 'CHEQUE',
        name: 'Cheque',
        shortName: 'Cheque',
        category: 'cheque',
        requiresReference: true,
      },
      { code: 'CL', name: 'City Ledger', shortName: 'City Ledger', category: 'city_ledger' },
    ],
  },
  MY: {
    country: 'MY',
    tax: {
      taxMode: 'exclusive_forward',
      taxes: [
        {
          code: 'SC',
          name: 'Service Charge',
          priority: 1,
          compound: false,
          exemptible: false,
          displayGroup: 'single',
          rates: [{ ratePercent: 10 }],
          from: '2024-03-01',
        },
        {
          code: 'SST',
          name: 'Service Tax (SST)',
          invoiceLabel: 'SST',
          priority: 2,
          compound: true,
          exemptible: true,
          displayGroup: 'single',
          rates: [{ ratePercent: 8 }],
          from: '2024-03-01',
        },
      ],
      levies: [
        {
          code: 'TTX',
          name: 'Tourism Tax',
          amount: 10,
          currency: 'MYR',
          appliesTo: 'non_resident',
          from: '2017-09-01',
        },
      ],
      requireGuestRegistration: true,
    },
    timezone: 'Asia/Kuala_Lumpur',
    baseCurrencies: ['MYR'],
    timeFormat: '12h',
    mealCodeStyle: 'international',
    fyStartMonth: 1,
    taxRegistrationLabel: 'SST Reg. No.',
    cityLedgerLabel: 'City Ledger',
    marketSegments: SEGMENTS,
    businessSources: [
      ...DIRECT_SOURCES,
      ...GLOBAL_OTAS,
      {
        shortCode: 'AGB',
        name: 'Agoda B2B',
        category: 'ota',
        palette: 'red',
        defaultSegment: 'WHS',
      },
      {
        shortCode: 'TVL',
        name: 'Traveloka',
        category: 'ota',
        palette: 'lime',
        defaultSegment: 'OTA',
      },
    ],
    paymentMethods: [
      {
        code: 'CASH',
        name: 'Cash (MYR)',
        shortName: 'Cash',
        category: 'cash',
        isDefaultCash: true,
      },
      ...CARDS,
      {
        code: 'DUITNOWQR',
        name: 'DuitNow QR',
        shortName: 'DuitNow QR',
        category: 'qr',
        requiresReference: true,
      },
      {
        code: 'DUITNOW',
        name: 'DuitNow / IBG Transfer',
        shortName: 'Transfer',
        category: 'bank_transfer',
        requiresReference: true,
      },
      {
        code: 'FPX',
        name: 'FPX Online Banking',
        shortName: 'FPX',
        category: 'online',
        requiresReference: true,
      },
      { code: 'TNG', name: "Touch 'n Go eWallet", shortName: 'TNG', category: 'wallet' },
      { code: 'GRABPAY', name: 'GrabPay', shortName: 'GrabPay', category: 'wallet' },
      { code: 'BOOST', name: 'Boost', shortName: 'Boost', category: 'wallet' },
      { code: 'SHOPEEPAY', name: 'ShopeePay', shortName: 'ShopeePay', category: 'wallet' },
      {
        code: 'CHEQUE',
        name: 'Cheque',
        shortName: 'Cheque',
        category: 'cheque',
        requiresReference: true,
      },
      { code: 'CL', name: 'City Ledger', shortName: 'City Ledger', category: 'city_ledger' },
    ],
  },
  IN: {
    country: 'IN',
    tax: {
      taxMode: 'exclusive_forward',
      taxes: [
        {
          code: 'GST',
          name: 'GST',
          priority: 1,
          compound: false,
          exemptible: true,
          displayGroup: 'gst_split',
          rates: [
            { ratePercent: 5, maxAmount: 7500 },
            { ratePercent: 18, minAmount: 7500.01 },
          ],
          from: '2025-09-22',
        },
      ],
      levies: [],
      requireGuestRegistration: false,
    },
    timezone: 'Asia/Kolkata',
    baseCurrencies: ['INR'],
    timeFormat: '12h',
    mealCodeStyle: 'indian',
    fyStartMonth: 4,
    taxRegistrationLabel: 'GSTIN',
    cityLedgerLabel: 'Bill to Company (BTC)',
    marketSegments: [...SEGMENTS, PILGRIMAGE],
    businessSources: [
      ...DIRECT_SOURCES,
      ...GLOBAL_OTAS,
      {
        shortCode: 'MMT',
        name: 'MakeMyTrip',
        category: 'ota',
        palette: 'red',
        defaultSegment: 'OTA',
      },
      {
        shortCode: 'GIB',
        name: 'Goibibo',
        category: 'ota',
        palette: 'orange',
        defaultSegment: 'OTA',
      },
      {
        shortCode: 'CLT',
        name: 'Cleartrip',
        category: 'ota',
        palette: 'yellow',
        defaultSegment: 'OTA',
      },
      {
        shortCode: 'YTR',
        name: 'Yatra',
        category: 'ota',
        palette: 'purple',
        defaultSegment: 'OTA',
      },
      {
        shortCode: 'EMT',
        name: 'EaseMyTrip',
        category: 'ota',
        palette: 'lime',
        defaultSegment: 'OTA',
      },
    ],
    paymentMethods: [
      {
        code: 'CASH',
        name: 'Cash (INR)',
        shortName: 'Cash',
        category: 'cash',
        isDefaultCash: true,
      },
      { code: 'UPI', name: 'UPI', shortName: 'UPI', category: 'qr', requiresReference: true },
      ...CARDS,
      { code: 'RUPAY', name: 'RuPay Card', shortName: 'RuPay', category: 'card' },
      {
        code: 'NETBANK',
        name: 'Net Banking',
        shortName: 'Net Banking',
        category: 'online',
        requiresReference: true,
      },
      {
        code: 'NEFT',
        name: 'NEFT / RTGS / IMPS',
        shortName: 'NEFT',
        category: 'bank_transfer',
        requiresReference: true,
      },
      {
        code: 'CHEQUE',
        name: 'Cheque / Demand Draft',
        shortName: 'Cheque',
        category: 'cheque',
        requiresReference: true,
      },
      { code: 'PAYTM', name: 'Paytm', shortName: 'Paytm', category: 'wallet' },
      { code: 'PHONEPE', name: 'PhonePe', shortName: 'PhonePe', category: 'wallet' },
      { code: 'CL', name: 'Bill to Company (BTC)', shortName: 'BTC', category: 'city_ledger' },
    ],
  },
};

/** The preset for a country, falling back to Sri Lanka (the platform's home market). */
export function presetFor(country: string | null | undefined): RegionPreset {
  if (country === 'MY' || country === 'IN' || country === 'LK') return REGION_PRESETS[country];
  return REGION_PRESETS.LK;
}
