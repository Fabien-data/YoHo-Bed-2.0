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

export const NIGHT_AUDIT_MODES = ['auto', 'manual'] as const;
export type NightAuditMode = (typeof NIGHT_AUDIT_MODES)[number];

/** 'HH:MM', 24-hour. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHhMm = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);

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
   * Refuse check-in until the stay's registration is complete (Sprint 7): Malaysia's Registration
   * of Guests Act 1965 asks for the guest's name, address, occupation, sex, nationality, ID with
   * its place and date of issue, and where they arrived from. The Malaysia preset turns it on.
   */
  requireGuestRegistration: boolean;
  /**
   * What check-out does with an unpaid guest balance (UX-STANDARD §4). `block` (the default)
   * refuses until it is paid, moved to the city ledger, or an owner overrides with a reason;
   * `allow` lets the desk check out and leaves the balance on the folio to chase.
   */
  checkoutBalancePolicy: 'block' | 'allow';
  /**
   * Check a stay out by itself once its departure day is over and nobody did (owner brief,
   * 2026-09-26). The room turns dirty and gets its departure clean, exactly as a desk check-out
   * does; a balance the guest still owes stays on the bill for the desk to collect.
   */
  autoCheckout: boolean;
  /**
   * How the business day closes. `auto` runs the night audit by itself at `time` (the hotel's
   * clock): a time before noon closes the previous day that morning (02:00 closes yesterday), a
   * time from noon on closes the same day that evening (23:30). `manual` leaves it to the owner.
   */
  nightAudit: { mode: NightAuditMode; time: string };
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
  requireGuestRegistration: false,
  checkoutBalancePolicy: 'block',
  autoCheckout: true,
  nightAudit: { mode: 'auto', time: '02:00' },
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
    requireGuestRegistration:
      typeof r.requireGuestRegistration === 'boolean'
        ? r.requireGuestRegistration
        : d.requireGuestRegistration,
    checkoutBalancePolicy: r.checkoutBalancePolicy === 'allow' ? 'allow' : d.checkoutBalancePolicy,
    autoCheckout: typeof r.autoCheckout === 'boolean' ? r.autoCheckout : d.autoCheckout,
    nightAudit: {
      mode: r.nightAudit?.mode === 'manual' ? 'manual' : d.nightAudit.mode,
      time: isHhMm(r.nightAudit?.time) ? r.nightAudit.time : d.nightAudit.time,
    },
    kindOverrides,
    titles: titles && titles.length > 0 ? titles : null,
  };
}

/**
 * When the automatic night audit closes `businessDate`, as a wall-clock moment in the hotel's
 * own time ('YYYY-MM-DDTHH:MM'). A morning time closes the day that has just ended; an evening
 * time closes the day still under way. Compared as strings, so no timezone maths is needed: the
 * caller formats "now" in the hotel's timezone the same way.
 */
export function nightAuditDueAt(businessDate: string, time: string): string {
  const t = isHhMm(time) ? time : DEFAULT_PROPERTY_SETTINGS.nightAudit.time;
  if (t >= '12:00') return `${businessDate}T${t}`;
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T${t}`;
}

/** 'YYYY-MM-DDTHH:MM' for an instant, on a timezone's wall clock. A bad zone falls back to UTC. */
export function wallClockIn(timezone: string | null | undefined, at: Date = new Date()): string {
  const format = (timeZone: string) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(at)
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  };
  try {
    return format(timezone ?? 'UTC');
  } catch {
    return format('UTC');
  }
}
