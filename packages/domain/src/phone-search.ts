/**
 * Matching a phone number the way a guest says it (UX Excellence Program, UX-2).
 *
 * The same number is written a dozen ways: `+94 77 123 4567`, `077 123 4567`, `0771234567`,
 * `94771234567`. A guest at the desk reads out the national form with its leading trunk zero;
 * the booking, made through a channel, holds the international one. Comparing them as text finds
 * nothing, which is why searching by phone "often missed" before this.
 *
 * The rule: reduce both sides to digits and compare the last `PHONE_MATCH_DIGITS` of what was
 * typed. A subscriber number is the part that survives every format, and nine digits is long
 * enough that it does not collide in one hotel's guest list (Sri Lanka, Malaysia and India all
 * have 9–10 digit subscriber numbers).
 */

export const PHONE_MATCH_DIGITS = 9;

/** The digits worth matching in a typed number, or null when it is too short to be one. */
export function phoneNeedle(term: string): string | null {
  const digits = term.replace(/\D/g, '');
  if (digits.length < 4) return null;
  // Drop the trunk prefix ("0771234567" → "771234567"), then keep the tail.
  const national = digits.replace(/^0+/, '');
  const useful = national.length >= 4 ? national : digits;
  return useful.slice(-PHONE_MATCH_DIGITS);
}

/** Whether a stored number matches a typed one, both reduced to digits. */
export function phoneMatches(stored: string | null | undefined, term: string): boolean {
  const needle = phoneNeedle(term);
  if (!needle || !stored) return false;
  return stored.replace(/\D/g, '').includes(needle);
}
