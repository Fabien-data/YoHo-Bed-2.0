import { isTagColor, type TagColor } from './palette';
import { RESERVATION_KINDS, type ReservationKind } from './reservation-kinds';

/**
 * Per-property operating settings for the reservation desk (`properties.settings`, jsonb).
 *
 * Stored sparse and resolved here against defaults, so a property created before a setting existed
 * behaves exactly as the default says — no backfill migration is needed when a key is added.
 */

export const COMMISSION_PLANS = [
  'none',
  'pct_all_nights',
  'pct_first_night',
  'fixed_per_night',
  'fixed_per_stay',
] as const;
export type CommissionPlan = (typeof COMMISSION_PLANS)[number];

export const UNCONFIRMED_POLICIES = ['never', 'arrival_day_end'] as const;
export type UnconfirmedPolicy = (typeof UNCONFIRMED_POLICIES)[number];

export interface KindOverride {
  label?: string;
  color?: TagColor;
}

export interface PropertySettings {
  timeFormat: '12h' | '24h';
  mealCodeStyle: 'international' | 'indian';
  /** How long a new hold lasts by default, and how long before release the hotel is reminded. */
  hold: { defaultHours: number; reminderHours: number };
  /**
   * What happens to an unconfirmed booking (inquiry, failed, unconfirmed hold without a release
   * time) whose arrival date passes. `never` is eZee's default: nothing is released unless the
   * hotel asks for it.
   */
  unconfirmedPolicy: UnconfirmedPolicy;
  /**
   * The front desk's authority over price. Owners are never limited; staff may discount a nightly
   * rate by up to `staffMaxDiscountPct` and may give complimentary rooms only when allowed. Beyond
   * that an owner has to approve on the spot.
   */
  rateControl: { staffMaxDiscountPct: number; staffCanComp: boolean };
  /** Refuse check-in until the guest's identity document is recorded. */
  requireDocumentsAtCheckin: boolean;
  /**
   * What check-out does with an unpaid guest balance (UX-STANDARD §4). `block` (the default)
   * refuses until it is paid, moved to the city ledger, or an owner overrides with a reason;
   * `allow` lets the desk check out and leaves the balance on the folio to chase.
   */
  checkoutBalancePolicy: 'block' | 'allow';
  /** Renamed or recoloured reservation kinds. Behaviour never changes. */
  kindOverrides: Partial<Record<ReservationKind, KindOverride>>;
  /** Replaces the country's default title list when set. */
  titles: string[] | null;
}

export const DEFAULT_PROPERTY_SETTINGS: PropertySettings = {
  timeFormat: '12h',
  mealCodeStyle: 'international',
  hold: { defaultHours: 24, reminderHours: 6 },
  unconfirmedPolicy: 'never',
  rateControl: { staffMaxDiscountPct: 0, staffCanComp: false },
  requireDocumentsAtCheckin: false,
  checkoutBalancePolicy: 'block',
  kindOverrides: {},
  titles: null,
};

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Resolve a stored (possibly partial, possibly stale) settings object into a complete one.
 * Unknown keys are dropped and out-of-range numbers are clamped, so a bad row can never make the
 * desk misbehave.
 */
export function resolvePropertySettings(raw: unknown): PropertySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = DEFAULT_PROPERTY_SETTINGS;

  const kindOverrides: PropertySettings['kindOverrides'] = {};
  const ko = r.kindOverrides && typeof r.kindOverrides === 'object' ? r.kindOverrides : {};
  for (const k of RESERVATION_KINDS) {
    const o = ko[k];
    if (!o || typeof o !== 'object') continue;
    const entry: KindOverride = {};
    if (typeof o.label === 'string' && o.label.trim()) entry.label = o.label.trim().slice(0, 40);
    if (isTagColor(o.color)) entry.color = o.color;
    if (entry.label || entry.color) kindOverrides[k] = entry;
  }

  const titles = Array.isArray(r.titles)
    ? r.titles
        .filter((t: unknown): t is string => typeof t === 'string' && t.trim() !== '')
        .map((t: string) => t.trim().slice(0, 24))
    : null;

  return {
    timeFormat: r.timeFormat === '24h' ? '24h' : d.timeFormat,
    mealCodeStyle: r.mealCodeStyle === 'indian' ? 'indian' : d.mealCodeStyle,
    hold: {
      defaultHours: num(r.hold?.defaultHours, d.hold.defaultHours, 1, 24 * 60),
      reminderHours: num(r.hold?.reminderHours, d.hold.reminderHours, 0, 24 * 30),
    },
    unconfirmedPolicy: (UNCONFIRMED_POLICIES as readonly string[]).includes(r.unconfirmedPolicy)
      ? r.unconfirmedPolicy
      : d.unconfirmedPolicy,
    rateControl: {
      staffMaxDiscountPct: num(
        r.rateControl?.staffMaxDiscountPct,
        d.rateControl.staffMaxDiscountPct,
        0,
        100,
      ),
      staffCanComp:
        typeof r.rateControl?.staffCanComp === 'boolean'
          ? r.rateControl.staffCanComp
          : d.rateControl.staffCanComp,
    },
    requireDocumentsAtCheckin:
      typeof r.requireDocumentsAtCheckin === 'boolean'
        ? r.requireDocumentsAtCheckin
        : d.requireDocumentsAtCheckin,
    checkoutBalancePolicy: r.checkoutBalancePolicy === 'allow' ? 'allow' : d.checkoutBalancePolicy,
    kindOverrides,
    titles: titles && titles.length > 0 ? titles : null,
  };
}
