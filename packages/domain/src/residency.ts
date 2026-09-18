/**
 * Local and foreign guests (Development Phase 02).
 *
 * Hotels in Sri Lanka, Malaysia and India commonly sell a resident rate and a foreign rate for the
 * same room. A rate plan names its audience; a reservation carries the guest's residency, which
 * decides the rate types the desk is offered — and, from Sprint 7, Malaysia's tourism tax and
 * India's Form C.
 */

export const RESIDENCIES = ['local', 'foreign'] as const;
export type Residency = (typeof RESIDENCIES)[number];

export const RATE_AUDIENCES = ['all', 'local', 'foreign'] as const;
export type RateAudience = (typeof RATE_AUDIENCES)[number];

export function isResidency(v: unknown): v is Residency {
  return v === 'local' || v === 'foreign';
}

/**
 * The residency a nationality suggests at a property: a citizen of the property's country is
 * local, anyone else foreign. Unknown nationality gives no suggestion. The desk can always
 * override it (a foreign resident with a work visa often pays the local rate).
 */
export function residencyFor(
  nationalityCode: string | null | undefined,
  propertyCountry: string | null | undefined,
): Residency | null {
  if (!nationalityCode || !propertyCountry) return null;
  return nationalityCode.toUpperCase() === propertyCountry.toUpperCase() ? 'local' : 'foreign';
}

/**
 * Whether a rate plan may be sold to a guest. `all` is open to everyone. A local or foreign rate
 * needs the guest's residency to be known and to match.
 */
export function audienceAllows(audience: RateAudience, residency: Residency | null | undefined) {
  if (audience === 'all') return true;
  return residency === audience;
}
