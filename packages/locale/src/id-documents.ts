/**
 * Identity documents a hotel records at registration, per market.
 *
 * Two rules matter more than the list itself:
 *
 * 1. **Aadhaar is never stored in full.** UIDAI forbids hotels keeping Aadhaar copies or numbers;
 *    verification happens through the Aadhaar app / QR. We accept and keep only the last four
 *    digits, which is enough for staff to match a guest to their card and useless to anyone else.
 * 2. Validation is a *format* check. A well-formed number can still be fake — the point is to catch
 *    typos at the desk, not to replace looking at the document.
 */

export const ID_DOCUMENT_TYPES = [
  'nic',
  'mykad',
  'mypr',
  'aadhaar',
  'passport',
  'driving_licence',
  'voter_id',
  'oci',
  'other',
] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

export const ID_DOCUMENT_LABELS: Record<IdDocumentType, string> = {
  nic: 'National Identity Card (NIC)',
  mykad: 'MyKad',
  mypr: 'MyPR',
  aadhaar: 'Aadhaar (last 4 digits)',
  passport: 'Passport',
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID (EPIC)',
  oci: 'OCI card',
  other: 'Other',
};

export function isIdDocumentType(v: unknown): v is IdDocumentType {
  return typeof v === 'string' && (ID_DOCUMENT_TYPES as readonly string[]).includes(v);
}

/**
 * The document types offered at a property in `country` for a guest from `guestCountry`.
 * A foreign guest is offered their passport first; a local guest their national card.
 */
export function idTypesFor(
  country: string | null | undefined,
  guestCountry?: string | null,
): IdDocumentType[] {
  const foreign = Boolean(guestCountry) && guestCountry !== country;
  if (foreign) {
    // An Indian hotel still records OCI for foreign-passport holders of Indian origin.
    return country === 'IN' ? ['passport', 'oci', 'other'] : ['passport', 'other'];
  }
  switch (country) {
    case 'LK':
      return ['nic', 'passport', 'driving_licence', 'other'];
    case 'MY':
      return ['mykad', 'mypr', 'passport', 'driving_licence', 'other'];
    case 'IN':
      return ['aadhaar', 'passport', 'driving_licence', 'voter_id', 'other'];
    default:
      return ['passport', 'driving_licence', 'other'];
  }
}

const PATTERNS: Record<IdDocumentType, RegExp> = {
  // Old: 9 digits + V/X.  New (2016+): 12 digits.
  nic: /^(\d{9}[VX]|\d{12})$/,
  // YYMMDD-PB-###G, hyphens optional.
  mykad: /^\d{6}-?\d{2}-?\d{4}$/,
  mypr: /^\d{6}-?\d{2}-?\d{4}$/,
  aadhaar: /^\d{4}$/,
  passport: /^[A-Z0-9]{5,20}$/,
  driving_licence: /^[A-Z0-9][A-Z0-9 /-]{3,24}$/,
  // Electors Photo Identity Card: three letters, seven digits.
  voter_id: /^[A-Z]{3}\d{7}$/,
  oci: /^[A-Z]?\d{6,10}$/,
  other: /^.{1,40}$/,
};

/** Upper-cases and trims. Aadhaar input is reduced to its last four digits here. */
export function normalizeIdNumber(type: IdDocumentType, value: string): string {
  const v = value.trim().toUpperCase();
  if (type === 'aadhaar') return maskAadhaar(v);
  if (type === 'passport') return v.replace(/\s+/g, '');
  return v;
}

/**
 * Keep only the last four digits of an Aadhaar number, whatever was typed — a full 12-digit
 * number pasted by a well-meaning receptionist must never reach the database.
 */
export function maskAadhaar(value: string): string {
  const digits = value.replace(/\D/g, '');
  return digits.slice(-4);
}

export function isValidIdNumber(type: IdDocumentType, value: string): boolean {
  const v = normalizeIdNumber(type, value);
  if (!PATTERNS[type].test(v)) return false;
  if (type === 'nic') return nicBirthInfo(v) !== null;
  if (type === 'mykad' || type === 'mypr') return mykadBirthDate(v) !== null;
  return true;
}

export interface NicBirthInfo {
  /** 'YYYY-MM-DD' */
  dateOfBirth: string;
  gender: 'male' | 'female';
}

/**
 * Decode a Sri Lankan NIC into date of birth and gender, so the desk does not type them twice.
 *
 * The day-of-year counts every February as 29 days (the registry's convention) and adds 500 for
 * women. Returns null for a number that cannot be a real NIC.
 */
export function nicBirthInfo(nic: string): NicBirthInfo | null {
  const v = nic.trim().toUpperCase();
  let year: number;
  let day: number;
  if (/^\d{9}[VX]$/.test(v)) {
    year = 1900 + Number(v.slice(0, 2));
    day = Number(v.slice(2, 5));
  } else if (/^\d{12}$/.test(v)) {
    year = Number(v.slice(0, 4));
    day = Number(v.slice(4, 7));
  } else {
    return null;
  }
  let gender: 'male' | 'female' = 'male';
  if (day > 500) {
    gender = 'female';
    day -= 500;
  }
  if (day < 1 || day > 366) return null;
  // Walk a leap-year calendar, because that is how the day number is assigned.
  const monthDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let month = 0;
  let rest = day;
  while (month < 12 && rest > monthDays[month]!) {
    rest -= monthDays[month]!;
    month += 1;
  }
  if (month >= 12) return null;
  // 29 February in a non-leap year is an impossible birthday.
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  if (month === 1 && rest === 29 && !isLeap) return null;
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(rest).padStart(2, '0');
  return { dateOfBirth: `${year}-${mm}-${dd}`, gender };
}

/**
 * The date of birth encoded in a MyKad/MyPR number (YYMMDD). The century is inferred: a
 * two-digit year above the current one belongs to the 1900s.
 */
export function mykadBirthDate(value: string, today = new Date()): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 12) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const currentYY = today.getUTCFullYear() % 100;
  const year = (yy > currentYY ? 1900 : 2000) + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    return null;
  }
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
