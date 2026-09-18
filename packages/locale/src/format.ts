import {
  parsePhoneNumberFromString,
  type CountryCode as PhoneCountryCode,
} from 'libphonenumber-js/min';

/**
 * Local display formats and forgiving input parsing.
 *
 * Storage stays canonical everywhere — dates as 'YYYY-MM-DD', times as 'HH:mm', phones as E.164.
 * These helpers only translate between that and what a Sri Lankan, Malaysian or Indian front desk
 * types and reads: day-first dates, 12-hour times, local phone numbers, lakh/crore grouping.
 */

// --- Dates -------------------------------------------------------------------

export type DateStyle = 'dmy' | 'mdy' | 'iso';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** '2026-09-17' → '17/09/2026' (dmy, the default in all three markets). */
export function formatDate(iso: string | null | undefined, style: DateStyle = 'dmy'): string {
  if (!iso) return '';
  const m = ISO_DATE.exec(iso.slice(0, 10));
  if (!m) return iso;
  const [, y, mo, d] = m;
  if (style === 'iso') return `${y}-${mo}-${d}`;
  if (style === 'mdy') return `${mo}/${d}/${y}`;
  return `${d}/${mo}/${y}`;
}

/**
 * Accept what people actually type and return an ISO date, or null.
 *
 * Understands 'YYYY-MM-DD' and day-first 'DD/MM/YYYY', 'D/M/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY' and
 * two-digit years ('17/09/26'). Day-first is the only numeric order accepted, because it is the
 * only order used in the three home markets — guessing 'MM/DD' would silently swap 03/04.
 */
export function parseDateInput(input: string | null | undefined): string | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  const iso = ISO_DATE.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    return isRealDate(y, mo, d) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!dmy) return null;
  const d = Number(dmy[1]);
  const mo = Number(dmy[2]);
  let y = Number(dmy[3]);
  if (dmy[3]!.length === 2) y += 2000;
  if (!isRealDate(y, mo, d)) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** Whole nights between two ISO dates (0 when checkout is not after checkin). */
export function nightsBetween(checkin: string, checkout: string): number {
  const a = Date.parse(`${checkin}T00:00:00Z`);
  const b = Date.parse(`${checkout}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Shift an ISO date by whole days. */
export function addDaysIso(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// --- Times -------------------------------------------------------------------

export type TimeFormat = '12h' | '24h';

/** '14:05' (or '14:05:00') → '02:05 PM' in 12-hour format. */
export function formatTime(hhmm: string | null | undefined, format: TimeFormat = '12h'): string {
  if (!hhmm) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  const min = m[2]!;
  if (format === '24h') return `${pad2(h)}:${min}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad2(h12)}:${min} ${suffix}`;
}

/**
 * Accept '14:00', '1400', '2:00 pm', '2pm', '02:00 PM' and return 'HH:mm', or null.
 * Midnight is '12 AM' → '00:00'; noon is '12 PM' → '12:00'.
 */
export function parseTimeInput(input: string | null | undefined): string | null {
  const s = (input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  const m = /^(\d{1,2})(?::?(\d{2}))?(?::\d{2})?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const ap = m[3];
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    const pm = ap.startsWith('p');
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  } else if (h > 23) {
    return null;
  }
  return `${pad2(h)}:${pad2(min)}`;
}

// --- Numbers -----------------------------------------------------------------

/**
 * Group digits the way the currency's home market reads them: '1,00,000.00' for rupees in India,
 * '100,000.00' everywhere else. Sri Lankan rupees use Western grouping.
 */
export function formatGrouped(value: number, currency?: string | null, decimals = 2): string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// --- Phones ------------------------------------------------------------------

export interface NormalizedPhone {
  /** '+94771234567' */
  e164: string;
  /** '+94 77 123 4567' */
  international: string;
  /** '077 123 4567' */
  national: string;
  country: string | null;
  valid: boolean;
}

/**
 * Parse a phone number typed at the desk. A number without a country prefix is read in the
 * property's own country, which is what a receptionist means when they type '077 123 4567'.
 * Returns null when the input is not a phone number at all.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry?: string | null,
): NormalizedPhone | null {
  const s = (input ?? '').trim();
  if (!s) return null;
  const parsed = parsePhoneNumberFromString(
    s,
    (defaultCountry as PhoneCountryCode | undefined) ?? undefined,
  );
  // The parser is lenient — "ext 204" comes back as +94 204. A number that cannot even be the
  // right length for its country is not a phone number.
  if (!parsed || !parsed.isPossible()) return null;
  return {
    e164: parsed.number,
    international: parsed.formatInternational(),
    national: parsed.formatNational(),
    country: parsed.country ?? null,
    valid: parsed.isValid(),
  };
}

/** Display an E.164 number in international form, or return it unchanged if it cannot parse. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  return parsePhoneNumberFromString(e164)?.formatInternational() ?? e164;
}

/** A wa.me click-to-chat link for an E.164 number, optionally with a pre-filled message. */
export function whatsappLink(e164: string, text?: string): string {
  const digits = e164.replace(/\D/g, '');
  const q = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${q}`;
}
