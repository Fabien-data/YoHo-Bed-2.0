/** Smart policies use integer minor units. Legacy calendar prices are not reinterpreted. */
export type MealCode = 'RO' | 'BB' | 'HB' | 'FB' | 'AI';
export type Supplement =
  { mode: 'fixed'; amountMinor: number } | { mode: 'percent'; basisPoints: number };
export interface ChildBand {
  id: string;
  label: string;
  minAge: number;
  maxAge: number;
  accommodation: Supplement;
}
export interface RoomCapacity {
  maxAdults: number;
  maxChildren: number;
  normalGuests: number;
  absoluteGuests: number;
  maxExtraBeds: number;
  maxCots: number;
}
export interface SmartRoomPolicy {
  capacity: RoomCapacity;
  includedAdults: number;
  includedChildren: number;
  childUsesAdultPlace: boolean;
  extraAdultMinor: number;
  extraBedMinor: number;
  cotMinor: number;
  childBands: ChildBand[];
}
export interface SmartMealPolicy {
  code: MealCode;
  mode: 'derived' | 'independent';
  adultMealMinor: number;
  childMeals: Record<string, Supplement>;
  minimumNetMinor: number;
}
export interface SmartGuestMix {
  adults: number;
  childAges: number[];
  extraBeds: number;
  cots: number;
}
export interface SmartIssue {
  field: string;
  code: string;
  message: string;
}
export interface SmartPropertyDocument {
  schemaVersion: 1;
  readiness: 'clean' | 'inspected';
  defaults: SmartRoomPolicy;
  roomOverrides: Record<string, SmartRoomPolicy>;
  /** Existing occupancy IDs remain stable; allowances are reviewed explicitly. */
  rates: Record<
    string,
    {
      roomId: string;
      baseOccupancyId: string;
      includedAdults: number;
      includedChildren: number;
      meal: SmartMealPolicy;
    }
  >;
}

export function roomPolicyFor(
  document: SmartPropertyDocument,
  occupancyId: string,
): SmartRoomPolicy | null {
  const rate = document.rates[occupancyId];
  if (!rate) return null;
  return {
    ...(document.roomOverrides[rate.roomId] ?? document.defaults),
    includedAdults: rate.includedAdults,
    includedChildren: rate.includedChildren,
  };
}
export interface SmartQuoteLine {
  kind:
    'accommodation' | 'extra_adults' | 'children' | 'meals' | 'extra_beds' | 'cots' | 'adjustment';
  label: string;
  amountMinor: number;
}
export interface SmartNightQuote {
  eligible: boolean;
  issues: SmartIssue[];
  lines: SmartQuoteLine[];
  roomMealNetMinor: number;
  bedNetMinor: number;
  totalNetMinor: number;
  minimumNetMinor: number;
  belowMinimum: boolean;
  exceptionReason: string | null;
}

const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 100;
const validMoney = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000_000_000;
const supplementValid = (s: Supplement) =>
  s.mode === 'fixed'
    ? validMoney(s.amountMinor)
    : s.mode === 'percent' &&
      Number.isInteger(s.basisPoints) &&
      s.basisPoints >= 0 &&
      s.basisPoints <= 100_000;
export function supplementMinor(rule: Supplement, adultMinor: number): number {
  return rule.mode === 'fixed'
    ? rule.amountMinor
    : Math.round((adultMinor * rule.basisPoints) / 10_000);
}

export function validateSmartPolicy(room: SmartRoomPolicy, meal?: SmartMealPolicy): SmartIssue[] {
  const issues: SmartIssue[] = [];
  const fail = (field: string, message: string) =>
    issues.push({ field, code: 'invalid_policy', message });
  for (const [key, value] of Object.entries(room.capacity)) {
    if (!validCount(value))
      fail('capacity.' + key, 'Capacity must be a whole number between 0 and 100.');
  }
  const c = room.capacity;
  if (c.normalGuests < 1 || c.absoluteGuests < c.normalGuests)
    fail(
      'capacity.absoluteGuests',
      'Absolute capacity must be at least normal capacity, and normal capacity must be positive.',
    );
  if (c.maxAdults > c.absoluteGuests || c.maxChildren > c.absoluteGuests)
    fail('capacity', 'Adult and child limits cannot exceed absolute capacity.');
  if (c.normalGuests > c.maxAdults + c.maxChildren)
    fail('capacity.normalGuests', 'Normal capacity exceeds the permitted adult and child counts.');
  if (
    !validCount(room.includedAdults) ||
    !validCount(room.includedChildren) ||
    room.includedAdults > c.maxAdults ||
    room.includedChildren > c.maxChildren ||
    room.includedAdults + room.includedChildren > c.normalGuests
  )
    fail('includedGuests', 'Included guests must fit within normal room capacity.');
  for (const key of ['extraAdultMinor', 'extraBedMinor', 'cotMinor'] as const) {
    if (!validMoney(room[key])) fail(key, 'Enter a non-negative amount in minor currency units.');
  }
  const ids = new Set<string>();
  const covered = new Set<number>();
  for (const band of room.childBands) {
    if (!band.id.trim() || !band.label.trim() || ids.has(band.id))
      fail('childBands', 'Each child age band needs a unique ID and a label.');
    ids.add(band.id);
    if (
      !Number.isInteger(band.minAge) ||
      !Number.isInteger(band.maxAge) ||
      band.minAge < 0 ||
      band.maxAge > 17 ||
      band.maxAge < band.minAge
    ) {
      fail('childBands.' + band.id, 'Age bands must have an inclusive range between 0 and 17.');
      continue;
    }
    for (let age = band.minAge; age <= band.maxAge; age++) {
      if (covered.has(age)) fail('childBands.' + band.id, 'Child age bands must not overlap.');
      covered.add(age);
    }
    if (!supplementValid(band.accommodation))
      fail('childBands.' + band.id, 'Invalid accommodation supplement.');
  }
  if (c.maxChildren > 0 && covered.size !== 18)
    fail('childBands', 'Cover every child age from 0 through 17 without gaps.');
  if (meal) {
    if (
      !['RO', 'BB', 'HB', 'FB', 'AI'].includes(meal.code) ||
      !['derived', 'independent'].includes(meal.mode)
    )
      fail('meal', 'Choose a supported meal plan and pricing mode.');
    if (!validMoney(meal.adultMealMinor) || !validMoney(meal.minimumNetMinor))
      fail('meal', 'Meal supplements and minimum rates must be non-negative amounts.');
    if (meal.code === 'RO' && meal.adultMealMinor !== 0)
      fail('meal.adultMealMinor', 'Room Only cannot include a meal supplement.');
    for (const band of room.childBands) {
      const charge = meal.childMeals[band.id];
      if (meal.code !== 'RO' && (!charge || !supplementValid(charge)))
        fail('meal.childMeals.' + band.id, 'Define a meal charge for each child band.');
    }
  }
  return issues;
}

/** One room/night. Commissions and taxes are deliberately applied by the existing pricing engine. */
export function quoteSmartNight(input: {
  room: SmartRoomPolicy;
  meal: SmartMealPolicy;
  guests: SmartGuestMix;
  baseNetMinor: number;
  roomMealOverrideMinor?: number;
  /** Supplied only by trusted authorization code, never copied from a client payload. */
  mayOverrideMinimum?: boolean;
  overrideReason?: string;
}): SmartNightQuote {
  const { room, meal, guests } = input;
  const issues = validateSmartPolicy(room, meal);
  const fail = (field: string, code: string, message: string) =>
    issues.push({ field, code, message });
  const empty = (): SmartNightQuote => ({
    eligible: false,
    issues,
    lines: [],
    roomMealNetMinor: 0,
    bedNetMinor: 0,
    totalNetMinor: 0,
    minimumNetMinor: meal.minimumNetMinor,
    belowMinimum: false,
    exceptionReason: null,
  });
  if (
    !validMoney(input.baseNetMinor) ||
    (input.roomMealOverrideMinor !== undefined && !validMoney(input.roomMealOverrideMinor))
  )
    fail('price', 'invalid_amount', 'Prices must be non-negative minor currency units.');
  if (
    ![guests.adults, guests.extraBeds, guests.cots, guests.childAges.length].every(validCount) ||
    guests.childAges.some((age) => !Number.isInteger(age) || age < 0 || age > 17)
  )
    fail(
      'guests',
      'invalid_guests',
      'Enter whole guest counts and an age from 0 through 17 for every child.',
    );
  if (issues.length) return empty();
  const total = guests.adults + guests.childAges.length;
  const c = room.capacity;
  if (total === 0) fail('guests', 'empty_room', 'A booking needs at least one guest.');
  if (guests.adults > c.maxAdults)
    fail('adults', 'adult_limit', 'This room allows at most ' + c.maxAdults + ' adults.');
  if (guests.childAges.length > c.maxChildren)
    fail('childAges', 'child_limit', 'This room allows at most ' + c.maxChildren + ' children.');
  if (guests.extraBeds > c.maxExtraBeds || guests.cots > c.maxCots)
    fail(
      'beds',
      'bed_limit',
      'The requested extra beds or cots exceed this room’s configured limits.',
    );
  if (total > c.absoluteGuests)
    fail(
      'guests',
      'absolute_capacity',
      'All guests, including infants, must fit within the absolute room limit of ' +
        c.absoluteGuests +
        '.',
    );
  if (total > c.normalGuests + guests.extraBeds + guests.cots)
    fail(
      'beds',
      'additional_bed_required',
      'Choose permitted extra beds/cots for guests above normal room capacity.',
    );
  const bands = guests.childAges.map((age) =>
    room.childBands.find((b) => age >= b.minAge && age <= b.maxAge),
  );
  if (bands.some((b) => !b))
    fail('childAges', 'missing_age_rule', 'A child’s age is not covered by the room policy.');
  if (issues.length) return empty();
  const children = bands as ChildBand[];
  const unusedAdults = room.childUsesAdultPlace
    ? Math.max(0, room.includedAdults - guests.adults)
    : 0;
  // Included places cover the most expensive children first: guest entry order cannot change a quote.
  const childCharges = children
    .map((b) => supplementMinor(b.accommodation, room.extraAdultMinor))
    .sort((a, b) => b - a);
  const extraChildren = childCharges
    .slice(room.includedChildren + unusedAdults)
    .reduce((a, b) => a + b, 0);
  const extraAdults = Math.max(0, guests.adults - room.includedAdults) * room.extraAdultMinor;
  const allChildMeals = children
    .map((b) =>
      meal.code === 'RO' ? 0 : supplementMinor(meal.childMeals[b.id]!, meal.adultMealMinor),
    )
    .sort((a, b) => b - a);
  const adultMeals =
    (meal.mode === 'derived' ? guests.adults : Math.max(0, guests.adults - room.includedAdults)) *
    meal.adultMealMinor;
  const childMeals = (
    meal.mode === 'derived' ? allChildMeals : allChildMeals.slice(room.includedChildren)
  ).reduce((a, b) => a + b, 0);
  const lines: SmartQuoteLine[] = [
    {
      kind: 'accommodation',
      label:
        meal.mode === 'independent'
          ? 'Plan base including configured guests and meals'
          : 'Room Only base',
      amountMinor: input.baseNetMinor,
    },
    { kind: 'extra_adults', label: 'Additional adult accommodation', amountMinor: extraAdults },
    { kind: 'children', label: 'Additional child accommodation', amountMinor: extraChildren },
    { kind: 'meals', label: meal.code + ' meal supplements', amountMinor: adultMeals + childMeals },
  ];
  let core = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  if (input.roomMealOverrideMinor !== undefined) {
    lines.push({
      kind: 'adjustment',
      label: 'Room and meal rate adjustment',
      amountMinor: input.roomMealOverrideMinor - core,
    });
    core = input.roomMealOverrideMinor;
  }
  const beds = guests.extraBeds * room.extraBedMinor;
  const cots = guests.cots * room.cotMinor;
  lines.push(
    { kind: 'extra_beds', label: 'Extra beds', amountMinor: beds },
    { kind: 'cots', label: 'Cots', amountMinor: cots },
  );
  const belowMinimum = core < meal.minimumNetMinor;
  const reason = input.overrideReason?.trim() || null;
  if (belowMinimum && (!input.mayOverrideMinimum || !reason))
    fail(
      'price',
      'minimum_net_rate',
      'The room-and-meal net amount is below the hotel minimum. An authorized exception with a reason is required.',
    );
  return {
    eligible: issues.length === 0,
    issues,
    lines,
    roomMealNetMinor: core,
    bedNetMinor: beds + cots,
    totalNetMinor: core + beds + cots,
    minimumNetMinor: meal.minimumNetMinor,
    belowMinimum,
    exceptionReason: belowMinimum && input.mayOverrideMinimum ? reason : null,
  };
}
