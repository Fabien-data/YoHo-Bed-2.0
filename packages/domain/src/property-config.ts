/**
 * The hotel profile and room-type catalogues (Configuration, owner brief 2026-09-26), modelled
 * on Yanolja's Hotel Profile and Room Type screens.
 *
 * Amenities and beds are fixed codes rather than free text: the same code reads the same on every
 * screen, can be translated, and can later be mapped to a channel's own amenity list. A hotel
 * picks from the catalogue; it does not invent entries.
 */

export interface CatalogueItem {
  code: string;
  label: string;
}
export interface CatalogueGroup {
  key: string;
  label: string;
  items: CatalogueItem[];
}

const item = (code: string, label: string): CatalogueItem => ({ code, label });

/** What the property offers as a whole — the Hotel Profile's Amenities tab. */
export const PROPERTY_AMENITIES: CatalogueGroup[] = [
  {
    key: 'general',
    label: 'General',
    items: [
      item('wifi', 'Free Wi-Fi'),
      item('parking', 'Free parking'),
      item('front_desk_24h', '24-hour front desk'),
      item('air_conditioning', 'Air conditioning'),
      item('elevator', 'Lift'),
      item('luggage_storage', 'Luggage storage'),
      item('laundry', 'Laundry'),
      item('room_service', 'Room service'),
      item('non_smoking', 'Non-smoking rooms'),
      item('family_rooms', 'Family rooms'),
      item('garden', 'Garden'),
      item('terrace', 'Terrace'),
      item('generator', 'Backup generator'),
    ],
  },
  {
    key: 'food',
    label: 'Food & drink',
    items: [
      item('restaurant', 'Restaurant'),
      item('bar', 'Bar'),
      item('breakfast', 'Breakfast'),
      item('coffee_shop', 'Coffee shop'),
      item('bbq', 'Barbecue'),
      item('halal', 'Halal food'),
      item('vegetarian', 'Vegetarian food'),
    ],
  },
  {
    key: 'leisure',
    label: 'Wellness & leisure',
    items: [
      item('pool', 'Swimming pool'),
      item('spa', 'Spa'),
      item('ayurveda', 'Ayurveda'),
      item('gym', 'Fitness centre'),
      item('beach', 'Beachfront'),
      item('yoga', 'Yoga'),
      item('tours', 'Tour desk'),
      item('kids_club', "Children's play area"),
    ],
  },
  {
    key: 'business',
    label: 'Business & events',
    items: [
      item('meeting_rooms', 'Meeting rooms'),
      item('banquet_hall', 'Banquet hall'),
      item('business_centre', 'Business centre'),
    ],
  },
  {
    key: 'transport',
    label: 'Transport',
    items: [
      item('airport_shuttle', 'Airport shuttle'),
      item('car_hire', 'Car hire'),
      item('bicycles', 'Bicycles'),
    ],
  },
  {
    key: 'access',
    label: 'Accessibility & safety',
    items: [
      item('wheelchair', 'Wheelchair accessible'),
      item('accessible_rooms', 'Accessible rooms'),
      item('cctv', 'CCTV in common areas'),
      item('security_24h', '24-hour security'),
      item('first_aid', 'First-aid kit'),
      item('fire_safety', 'Fire extinguishers'),
    ],
  },
];

/** What a room of the type has — the Room Type's Amenities tab. */
export const ROOM_AMENITIES: CatalogueGroup[] = [
  {
    key: 'comfort',
    label: 'Comfort',
    items: [
      item('air_conditioning', 'Air conditioning'),
      item('fan', 'Ceiling fan'),
      item('balcony', 'Balcony'),
      item('sea_view', 'Sea view'),
      item('garden_view', 'Garden view'),
      item('pool_view', 'Pool view'),
      item('mountain_view', 'Mountain view'),
      item('city_view', 'City view'),
      item('soundproof', 'Soundproofing'),
    ],
  },
  {
    key: 'bathroom',
    label: 'Bathroom',
    items: [
      item('private_bathroom', 'Private bathroom'),
      item('hot_water', 'Hot water'),
      item('bathtub', 'Bathtub'),
      item('rain_shower', 'Rain shower'),
      item('hairdryer', 'Hairdryer'),
      item('toiletries', 'Toiletries'),
      item('bathrobe', 'Bathrobe and slippers'),
    ],
  },
  {
    key: 'tech',
    label: 'Media & work',
    items: [
      item('tv', 'TV'),
      item('satellite_tv', 'Satellite channels'),
      item('wifi', 'Wi-Fi'),
      item('telephone', 'Telephone'),
      item('work_desk', 'Work desk'),
    ],
  },
  {
    key: 'food',
    label: 'Food & drink',
    items: [
      item('minibar', 'Minibar'),
      item('kettle', 'Tea and coffee maker'),
      item('fridge', 'Refrigerator'),
      item('bottled_water', 'Bottled water'),
    ],
  },
  {
    key: 'extras',
    label: 'Extras',
    items: [
      item('safe', 'In-room safe'),
      item('wardrobe', 'Wardrobe'),
      item('iron', 'Iron'),
      item('mosquito_net', 'Mosquito net'),
      item('interconnecting', 'Interconnecting room available'),
    ],
  },
];

/** "Which beds are available in this room type?" */
export const BED_TYPES: CatalogueItem[] = [
  item('king', 'King bed'),
  item('queen', 'Queen bed'),
  item('double', 'Double bed'),
  item('twin', 'Twin beds'),
  item('single', 'Single bed'),
  item('bunk', 'Bunk bed'),
  item('sofa_bed', 'Sofa bed'),
  item('futon', 'Futon'),
];

const codes = (groups: CatalogueGroup[]) =>
  new Set(groups.flatMap((g) => g.items.map((i) => i.code)));
const PROPERTY_AMENITY_CODES = codes(PROPERTY_AMENITIES);
const ROOM_AMENITY_CODES = codes(ROOM_AMENITIES);
const BED_CODES = new Set(BED_TYPES.map((b) => b.code));

/** Keep only codes the catalogue knows, once each, in catalogue order. */
function known(values: unknown, allowed: Set<string>): string[] {
  if (!Array.isArray(values)) return [];
  const picked = new Set(
    values.filter((v): v is string => typeof v === 'string' && allowed.has(v)),
  );
  return [...allowed].filter((c) => picked.has(c));
}
export const cleanPropertyAmenities = (v: unknown) => known(v, PROPERTY_AMENITY_CODES);
export const cleanRoomAmenities = (v: unknown) => known(v, ROOM_AMENITY_CODES);
export const cleanBedTypes = (v: unknown) => known(v, BED_CODES);
export const isPropertyAmenity = (v: string) => PROPERTY_AMENITY_CODES.has(v);
export const isRoomAmenity = (v: string) => ROOM_AMENITY_CODES.has(v);
export const isBedType = (v: string) => BED_CODES.has(v);

/** The Hotel Profile's Policies tab: what a guest agrees to, in the hotel's own words. */
export interface PropertyPolicies {
  cancellation?: string;
  children?: string;
  pets?: string;
  smoking?: string;
  extraBeds?: string;
  houseRules?: string;
  other?: string;
}

export const POLICY_FIELDS: Array<{ key: keyof PropertyPolicies; label: string; hint: string }> = [
  {
    key: 'cancellation',
    label: 'Cancellation',
    hint: 'e.g. Free cancellation up to 48 hours before arrival; after that, the first night is charged.',
  },
  { key: 'children', label: 'Children', hint: 'e.g. Children under 6 stay free in existing beds.' },
  {
    key: 'extraBeds',
    label: 'Extra beds and cots',
    hint: 'e.g. An extra bed is LKR 3,500 a night.',
  },
  { key: 'pets', label: 'Pets', hint: 'e.g. Pets are not allowed.' },
  { key: 'smoking', label: 'Smoking', hint: 'e.g. Smoking only in the garden.' },
  {
    key: 'houseRules',
    label: 'House rules',
    hint: 'e.g. Quiet hours from 10 pm; visitors until 8 pm.',
  },
  { key: 'other', label: 'Anything else', hint: 'Anything the guest should know before arriving.' },
];

/** Trim, drop empties and cap each policy's length; unknown keys never survive. */
export function cleanPolicies(raw: unknown): PropertyPolicies {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: PropertyPolicies = {};
  for (const { key } of POLICY_FIELDS) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 2000);
  }
  return out;
}

/** The meal plans a rate can include, by the codes everything else speaks. */
export const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB', 'AI'] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];
export const isMealPlan = (v: unknown): v is MealPlan =>
  typeof v === 'string' && (MEAL_PLANS as readonly string[]).includes(v);

export interface MealsIncluded {
  breakfast: boolean;
  lunch: boolean;
  dinner: boolean;
  allInclusive: boolean;
}

/**
 * Yanolja's "Does this rate type include meals?" — the meals ticked, as a meal plan: breakfast
 * only is BB; breakfast and one more meal is HB; all three is FB; all-inclusive is AI; none is RO.
 */
export function mealPlanOf(m: MealsIncluded): MealPlan {
  if (m.allInclusive) return 'AI';
  const count = [m.breakfast, m.lunch, m.dinner].filter(Boolean).length;
  if (count === 3) return 'FB';
  if (count === 2) return 'HB';
  if (count === 1) return m.breakfast ? 'BB' : 'HB';
  return 'RO';
}

/** The meals a plan includes (HB is read as breakfast and dinner, its usual form). */
export function mealsOf(plan: MealPlan): MealsIncluded {
  switch (plan) {
    case 'AI':
      return { breakfast: true, lunch: true, dinner: true, allInclusive: true };
    case 'FB':
      return { breakfast: true, lunch: true, dinner: true, allInclusive: false };
    case 'HB':
      return { breakfast: true, lunch: false, dinner: true, allInclusive: false };
    case 'BB':
      return { breakfast: true, lunch: false, dinner: false, allInclusive: false };
    default:
      return { breakfast: false, lunch: false, dinner: false, allInclusive: false };
  }
}

/**
 * A chargeable add-on bundled into a rate type's price ("Does this rate type include chargeable
 * add-ons?"): an airport pick-up, a spa treatment. The guest sees one price; the stay lists the
 * add-on as included, so the desk knows it was paid for and the folio never charges it twice.
 */
export interface RateTypeAddOn {
  /** The Extra Charge it is, when it is one of the hotel's catalogue items. */
  chargeParticularId: string | null;
  name: string;
  /** Its value inside the price, in the property's currency. */
  amount: string;
  /** Once for the stay, or every night (the inclusion rhythms the folio already knows). */
  rhythm: 'once' | 'per_night';
}
