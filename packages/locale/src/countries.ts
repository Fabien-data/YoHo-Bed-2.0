import {
  getCountries,
  getCountryCallingCode,
  type CountryCode as PhoneCountryCode,
} from 'libphonenumber-js/min';

/**
 * Countries, their names and their international dialling codes.
 *
 * The list is derived from libphonenumber's metadata rather than typed out by hand: a guest can
 * arrive from anywhere, and a hand-kept table of 240 codes is exactly the kind of data that rots.
 * Names come from the runtime's own ICU data (`Intl.DisplayNames`), so they are correct and
 * consistent without shipping a second copy.
 *
 * Nationality is stored as the ISO 3166-1 alpha-2 code of the country and displayed by name —
 * registration cards in all three markets accept "Sri Lanka" as a nationality, and a code is the
 * only form that survives a later translation of the UI.
 */

export type CountryCode = PhoneCountryCode;

/** The three launch markets, in the order every picker lists them first. */
export const HOME_MARKETS = ['LK', 'MY', 'IN'] as const;
export type HomeMarket = (typeof HOME_MARKETS)[number];

export function isHomeMarket(code: unknown): code is HomeMarket {
  return typeof code === 'string' && (HOME_MARKETS as readonly string[]).includes(code);
}

export interface Country {
  code: CountryCode;
  name: string;
  /** Without the plus sign, e.g. "94". */
  dialCode: string;
}

const ALL_CODES = new Set<string>(getCountries());

export function isCountryCode(code: unknown): code is CountryCode {
  return typeof code === 'string' && ALL_CODES.has(code);
}

let displayNames: Intl.DisplayNames | null | undefined;
function names(): Intl.DisplayNames | null {
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      // A runtime without ICU region names still gets a usable (if terse) list.
      displayNames = null;
    }
  }
  return displayNames;
}

/** "Sri Lanka" for "LK". Falls back to the code itself rather than throwing. */
export function countryName(code: string): string {
  try {
    return names()?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "94" for "LK", or null for a code libphonenumber does not know. */
export function dialCode(code: string): string | null {
  return isCountryCode(code) ? getCountryCallingCode(code) : null;
}

let cached: Country[] | null = null;

/**
 * Every country, alphabetical by English name, with the three home markets first — the front
 * desk in Colombo picks Sri Lanka far more often than Albania, and should not scroll for it.
 */
export function countryList(): Country[] {
  if (cached) return cached;
  const all = getCountries().map((code) => ({
    code,
    name: countryName(code),
    dialCode: getCountryCallingCode(code),
  }));
  all.sort((a, b) => a.name.localeCompare(b.name));
  const home = HOME_MARKETS.map((c) => all.find((x) => x.code === c)).filter((x): x is Country =>
    Boolean(x),
  );
  cached = [...home, ...all.filter((c) => !isHomeMarket(c.code))];
  return cached;
}
