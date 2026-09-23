import { describe, expect, it } from 'vitest';
import {
  quoteSmartNight,
  validateSmartPolicy,
  type SmartRoomPolicy,
  type SmartMealPolicy,
  type SmartGuestMix,
} from '../src/smart-property';

const room: SmartRoomPolicy = {
  capacity: {
    maxAdults: 3,
    maxChildren: 3,
    normalGuests: 2,
    absoluteGuests: 4,
    maxExtraBeds: 1,
    maxCots: 1,
  },
  includedAdults: 2,
  includedChildren: 0,
  childUsesAdultPlace: true,
  extraAdultMinor: 4000,
  extraBedMinor: 2000,
  cotMinor: 500,
  childBands: [
    {
      id: 'infant',
      label: 'Infant',
      minAge: 0,
      maxAge: 2,
      accommodation: { mode: 'fixed', amountMinor: 0 },
    },
    {
      id: 'child',
      label: 'Child',
      minAge: 3,
      maxAge: 11,
      accommodation: { mode: 'percent', basisPoints: 5000 },
    },
    {
      id: 'teen',
      label: 'Teen',
      minAge: 12,
      maxAge: 17,
      accommodation: { mode: 'percent', basisPoints: 10000 },
    },
  ],
};
const ro: SmartMealPolicy = {
  code: 'RO',
  mode: 'derived',
  adultMealMinor: 0,
  childMeals: {},
  minimumNetMinor: 8000,
};
const bb: SmartMealPolicy = {
  code: 'BB',
  mode: 'derived',
  adultMealMinor: 3000,
  minimumNetMinor: 8000,
  childMeals: {
    infant: { mode: 'fixed', amountMinor: 0 },
    child: { mode: 'percent', basisPoints: 5000 },
    teen: { mode: 'percent', basisPoints: 10000 },
  },
};
const guests: SmartGuestMix = { adults: 2, childAges: [], extraBeds: 0, cots: 0 };
const quote = (changes: Partial<Parameters<typeof quoteSmartNight>[0]> = {}) =>
  quoteSmartNight({ room, meal: ro, guests, baseNetMinor: 10000, ...changes });

describe('smart property rules', () => {
  it('keeps included occupancy separate from maximum capacity', () => {
    expect(quote().totalNetMinor).toBe(10000);
    expect(quote({ guests: { ...guests, adults: 3 } }).issues.map((i) => i.code)).toContain(
      'additional_bed_required',
    );
    expect(quote({ guests: { ...guests, adults: 3, extraBeds: 1 } }).totalNetMinor).toBe(16000);
  });
  it.each([
    [0, 0],
    [2, 0],
    [3, 2000],
    [11, 2000],
    [12, 4000],
    [17, 4000],
  ])('prices age %i at its exact band boundary', (age, extra) => {
    const result = quote({ guests: { ...guests, childAges: [age], extraBeds: 1 } });
    expect(result.eligible).toBe(true);
    expect(result.roomMealNetMinor).toBe(10000 + extra);
  });
  it('lets a child use an unused adult place only when enabled', () => {
    const mix = { ...guests, adults: 1, childAges: [8] };
    expect(quote({ guests: mix }).roomMealNetMinor).toBe(10000);
    expect(
      quote({ guests: mix, room: { ...room, childUsesAdultPlace: false } }).roomMealNetMinor,
    ).toBe(12000);
  });
  it('charges age-specific meals even when accommodation uses an adult place', () => {
    expect(
      quote({ meal: bb, guests: { ...guests, adults: 1, childAges: [8] } }).roomMealNetMinor,
    ).toBe(14500);
  });
  it('does not charge included meals twice for independent plans', () => {
    expect(
      quote({ meal: { ...bb, mode: 'independent' }, baseNetMinor: 16000 }).roomMealNetMinor,
    ).toBe(16000);
    expect(
      quote({
        meal: { ...bb, mode: 'independent' },
        baseNetMinor: 16000,
        guests: { ...guests, adults: 3, extraBeds: 1 },
      }).roomMealNetMinor,
    ).toBe(23000);
  });
  it('counts infants against the absolute guest ceiling', () => {
    const result = quote({ guests: { adults: 2, childAges: [0, 1, 2], extraBeds: 1, cots: 1 } });
    expect(result.issues.map((i) => i.code)).toContain('absolute_capacity');
  });
  it('rejects overlapping and incomplete child age bands', () => {
    expect(
      validateSmartPolicy({ ...room, childBands: room.childBands.slice(1) }).length,
    ).toBeGreaterThan(0);
    expect(
      validateSmartPolicy({
        ...room,
        childBands: [...room.childBands, { ...room.childBands[0]!, id: 'overlap' }],
      }).length,
    ).toBeGreaterThan(0);
  });
  it('rejects missing meal rules, fractional counts, and unknown ages', () => {
    expect(quote({ meal: { ...bb, childMeals: {} } }).eligible).toBe(false);
    expect(quote({ guests: { ...guests, adults: 1.5 } }).eligible).toBe(false);
    expect(quote({ guests: { ...guests, childAges: [18] } }).eligible).toBe(false);
  });
  it('does not let extra-bed revenue conceal a below-minimum room rate', () => {
    const result = quote({ roomMealOverrideMinor: 7000, guests: { ...guests, extraBeds: 1 } });
    expect(result.totalNetMinor).toBe(9000);
    expect(result.eligible).toBe(false);
    expect(result.belowMinimum).toBe(true);
  });
  it('requires both authorization and a reason for an exception', () => {
    expect(quote({ roomMealOverrideMinor: 7000, overrideReason: 'Retention' }).eligible).toBe(
      false,
    );
    expect(
      quote({ roomMealOverrideMinor: 7000, mayOverrideMinimum: true, overrideReason: ' ' })
        .eligible,
    ).toBe(false);
    expect(
      quote({ roomMealOverrideMinor: 7000, mayOverrideMinimum: true, overrideReason: 'Retention' })
        .exceptionReason,
    ).toBe('Retention');
  });
  it('is independent of the order children are entered', () => {
    const policy = { ...room, includedAdults: 1, includedChildren: 1 };
    const a = quote({
      room: policy,
      guests: { adults: 1, childAges: [8, 14], extraBeds: 1, cots: 0 },
    });
    const b = quote({
      room: policy,
      guests: { adults: 1, childAges: [14, 8], extraBeds: 1, cots: 0 },
    });
    expect(a.totalNetMinor).toBe(b.totalNetMinor);
    expect(a.roomMealNetMinor).toBe(12000);
  });
  it('rounds child percentage supplements once at minor-unit precision', () => {
    const policy = { ...room, extraAdultMinor: 1001 };
    expect(
      quote({ room: policy, guests: { ...guests, childAges: [8], extraBeds: 1 } }).roomMealNetMinor,
    ).toBe(10501);
  });
});
