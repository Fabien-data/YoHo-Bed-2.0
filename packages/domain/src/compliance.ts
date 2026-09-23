/**
 * Registering guests with the authorities (Development Phase 02, Sprint 7).
 *
 * - **India, Form C** (Foreigners Act; Bureau of Immigration): a hotel files Form C online within
 *   24 hours of a foreign guest's arrival. Citizens of Nepal and Bhutan are exempt, and so are
 *   Indian citizens. (OCI card holders are generally exempt too, but the desk decides that one by
 *   marking the guest's residency local.)
 * - **Malaysia, Registration of Guests Act 1965**: the register holds each guest's name, address,
 *   occupation, sex, nationality, identity or passport number with its place and date of issue,
 *   the date and time of arrival, and the last place they arrived from.
 */

/** Hours a hotel in India has to file Form C after a foreign guest arrives. */
export const FORM_C_HOURS = 24;

/** Nationalities that never need Form C: India's own, and Nepal's and Bhutan's by treaty. */
export const FORM_C_EXEMPT = ['IN', 'NP', 'BT'] as const;

/**
 * Whether a stay at a property needs Form C. Decided on the guest's nationality when it is known;
 * otherwise on the residency the desk recorded.
 */
export function formCRequired(
  propertyCountry: string | null | undefined,
  nationalityCode: string | null | undefined,
  residency: string | null | undefined,
): boolean {
  if (propertyCountry !== 'IN') return false;
  const nat = nationalityCode?.trim().toUpperCase();
  if (nat) return !(FORM_C_EXEMPT as readonly string[]).includes(nat);
  return residency === 'foreign';
}

/** When Form C falls due: 24 hours after the guest checked in. */
export function formCDueAt(checkedInAt: Date): Date {
  return new Date(checkedInAt.getTime() + FORM_C_HOURS * 3600_000);
}

export interface RegistrationFacts {
  name?: string | null;
  address?: string | null;
  occupation?: string | null;
  gender?: string | null;
  nationalityCode?: string | null;
  documentNumber?: string | null;
  documentPlaceOfIssue?: string | null;
  documentIssuedOn?: string | null;
  arrivedFrom?: string | null;
}

/** The register fields Malaysia's Act asks for, with the label the desk sees. */
export const MY_REGISTRATION_FIELDS: ReadonlyArray<[keyof RegistrationFacts, string]> = [
  ['name', 'Full name'],
  ['address', 'Address'],
  ['occupation', 'Occupation'],
  ['gender', 'Sex'],
  ['nationalityCode', 'Nationality'],
  ['documentNumber', 'ID or passport number'],
  ['documentPlaceOfIssue', 'Place of issue'],
  ['documentIssuedOn', 'Date of issue'],
  ['arrivedFrom', 'Arrived from'],
];

/** What is still missing from the register for a stay, as labels, in the form's order. */
export function registrationMissing(f: RegistrationFacts): string[] {
  return MY_REGISTRATION_FIELDS.filter(([k]) => !String(f[k] ?? '').trim()).map(([, l]) => l);
}
