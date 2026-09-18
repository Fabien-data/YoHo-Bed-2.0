import type { HomeMarket } from './countries';

/**
 * First-level subdivisions of the three home markets — the "State" dropdown on an address.
 *
 * Codes:
 * - Sri Lanka and Malaysia use their ISO 3166-2 codes (LK-1 … LK-9, MY-01 … MY-16).
 * - India is keyed by the **GST state code**, not ISO. An Indian tax invoice must print the place of
 *   supply as that two-digit code, and ISO codes for India have been renumbered more than once, so
 *   the GST code is the one identifier that is both stable and legally meaningful.
 *
 * Other countries get a free-text state field; nobody needs a dropdown for Ohio at a Galle hotel.
 */

export interface Subdivision {
  code: string;
  name: string;
  /** 'province' | 'state' | 'federal_territory' | 'union_territory' */
  kind: string;
  /** Sri Lanka only: the districts inside the province. */
  districts?: string[];
}

const LK: Subdivision[] = [
  {
    code: 'LK-1',
    name: 'Western',
    kind: 'province',
    districts: ['Colombo', 'Gampaha', 'Kalutara'],
  },
  {
    code: 'LK-2',
    name: 'Central',
    kind: 'province',
    districts: ['Kandy', 'Matale', 'Nuwara Eliya'],
  },
  {
    code: 'LK-3',
    name: 'Southern',
    kind: 'province',
    districts: ['Galle', 'Matara', 'Hambantota'],
  },
  {
    code: 'LK-4',
    name: 'Northern',
    kind: 'province',
    districts: ['Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu'],
  },
  {
    code: 'LK-5',
    name: 'Eastern',
    kind: 'province',
    districts: ['Batticaloa', 'Ampara', 'Trincomalee'],
  },
  {
    code: 'LK-6',
    name: 'North Western',
    kind: 'province',
    districts: ['Kurunegala', 'Puttalam'],
  },
  {
    code: 'LK-7',
    name: 'North Central',
    kind: 'province',
    districts: ['Anuradhapura', 'Polonnaruwa'],
  },
  { code: 'LK-8', name: 'Uva', kind: 'province', districts: ['Badulla', 'Monaragala'] },
  {
    code: 'LK-9',
    name: 'Sabaragamuwa',
    kind: 'province',
    districts: ['Ratnapura', 'Kegalle'],
  },
];

const MY: Subdivision[] = [
  { code: 'MY-01', name: 'Johor', kind: 'state' },
  { code: 'MY-02', name: 'Kedah', kind: 'state' },
  { code: 'MY-03', name: 'Kelantan', kind: 'state' },
  { code: 'MY-04', name: 'Melaka', kind: 'state' },
  { code: 'MY-05', name: 'Negeri Sembilan', kind: 'state' },
  { code: 'MY-06', name: 'Pahang', kind: 'state' },
  { code: 'MY-07', name: 'Pulau Pinang', kind: 'state' },
  { code: 'MY-08', name: 'Perak', kind: 'state' },
  { code: 'MY-09', name: 'Perlis', kind: 'state' },
  { code: 'MY-10', name: 'Selangor', kind: 'state' },
  { code: 'MY-11', name: 'Terengganu', kind: 'state' },
  { code: 'MY-12', name: 'Sabah', kind: 'state' },
  { code: 'MY-13', name: 'Sarawak', kind: 'state' },
  { code: 'MY-14', name: 'Kuala Lumpur', kind: 'federal_territory' },
  { code: 'MY-15', name: 'Labuan', kind: 'federal_territory' },
  { code: 'MY-16', name: 'Putrajaya', kind: 'federal_territory' },
];

/** GST state codes (CBIC). 25 (Daman & Diu) merged into 26 in 2020; 28 (old Andhra) is retired. */
const IN: Subdivision[] = [
  { code: '01', name: 'Jammu and Kashmir', kind: 'union_territory' },
  { code: '02', name: 'Himachal Pradesh', kind: 'state' },
  { code: '03', name: 'Punjab', kind: 'state' },
  { code: '04', name: 'Chandigarh', kind: 'union_territory' },
  { code: '05', name: 'Uttarakhand', kind: 'state' },
  { code: '06', name: 'Haryana', kind: 'state' },
  { code: '07', name: 'Delhi', kind: 'union_territory' },
  { code: '08', name: 'Rajasthan', kind: 'state' },
  { code: '09', name: 'Uttar Pradesh', kind: 'state' },
  { code: '10', name: 'Bihar', kind: 'state' },
  { code: '11', name: 'Sikkim', kind: 'state' },
  { code: '12', name: 'Arunachal Pradesh', kind: 'state' },
  { code: '13', name: 'Nagaland', kind: 'state' },
  { code: '14', name: 'Manipur', kind: 'state' },
  { code: '15', name: 'Mizoram', kind: 'state' },
  { code: '16', name: 'Tripura', kind: 'state' },
  { code: '17', name: 'Meghalaya', kind: 'state' },
  { code: '18', name: 'Assam', kind: 'state' },
  { code: '19', name: 'West Bengal', kind: 'state' },
  { code: '20', name: 'Jharkhand', kind: 'state' },
  { code: '21', name: 'Odisha', kind: 'state' },
  { code: '22', name: 'Chhattisgarh', kind: 'state' },
  { code: '23', name: 'Madhya Pradesh', kind: 'state' },
  { code: '24', name: 'Gujarat', kind: 'state' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', kind: 'union_territory' },
  { code: '27', name: 'Maharashtra', kind: 'state' },
  { code: '29', name: 'Karnataka', kind: 'state' },
  { code: '30', name: 'Goa', kind: 'state' },
  { code: '31', name: 'Lakshadweep', kind: 'union_territory' },
  { code: '32', name: 'Kerala', kind: 'state' },
  { code: '33', name: 'Tamil Nadu', kind: 'state' },
  { code: '34', name: 'Puducherry', kind: 'union_territory' },
  { code: '35', name: 'Andaman and Nicobar Islands', kind: 'union_territory' },
  { code: '36', name: 'Telangana', kind: 'state' },
  { code: '37', name: 'Andhra Pradesh', kind: 'state' },
  { code: '38', name: 'Ladakh', kind: 'union_territory' },
];

export const SUBDIVISIONS: Record<HomeMarket, Subdivision[]> = { LK, MY, IN };

/** The subdivisions for a country, or an empty list (meaning: use a free-text field). */
export function subdivisionsOf(country: string | null | undefined): Subdivision[] {
  if (country === 'LK' || country === 'MY' || country === 'IN') return SUBDIVISIONS[country];
  return [];
}

export function subdivisionName(country: string | null | undefined, code: string): string | null {
  return subdivisionsOf(country).find((s) => s.code === code)?.name ?? null;
}

/** True when `code` is a valid subdivision of `country` (always true for free-text countries). */
export function isSubdivisionOf(country: string | null | undefined, code: string): boolean {
  const list = subdivisionsOf(country);
  return list.length === 0 || list.some((s) => s.code === code);
}
