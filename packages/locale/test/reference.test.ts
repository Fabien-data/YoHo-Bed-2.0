import { describe, expect, it } from 'vitest';
import {
  REGION_PRESETS,
  SUBDIVISIONS,
  countryList,
  countryName,
  dialCode,
  displayMealCode,
  idTypesFor,
  isCountryCode,
  isSubdivisionOf,
  isValidIdNumber,
  maskAadhaar,
  mykadBirthDate,
  nicBirthInfo,
  normalizeIdNumber,
  presetFor,
  subdivisionsOf,
  titlesFor,
} from '../src';

describe('countries', () => {
  it('names countries and knows their dial codes', () => {
    expect(countryName('LK')).toBe('Sri Lanka');
    expect(countryName('MY')).toBe('Malaysia');
    expect(dialCode('LK')).toBe('94');
    expect(dialCode('MY')).toBe('60');
    expect(dialCode('IN')).toBe('91');
    expect(dialCode('ZZ')).toBeNull();
    expect(isCountryCode('GB')).toBe(true);
    expect(isCountryCode('XX')).toBe(false);
  });

  it('lists the three home markets first, then the rest alphabetically', () => {
    const list = countryList();
    expect(list.slice(0, 3).map((c) => c.code)).toEqual(['LK', 'MY', 'IN']);
    expect(list.length).toBeGreaterThan(200);
    const rest = list.slice(3).map((c) => c.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    expect(new Set(list.map((c) => c.code)).size).toBe(list.length);
  });
});

describe('subdivisions', () => {
  it('covers every Sri Lankan district exactly once', () => {
    const districts = SUBDIVISIONS.LK.flatMap((p) => p.districts ?? []);
    expect(SUBDIVISIONS.LK).toHaveLength(9);
    expect(districts).toHaveLength(25);
    expect(new Set(districts).size).toBe(25);
  });

  it('has 13 Malaysian states plus 3 federal territories', () => {
    expect(SUBDIVISIONS.MY.filter((s) => s.kind === 'state')).toHaveLength(13);
    expect(SUBDIVISIONS.MY.filter((s) => s.kind === 'federal_territory')).toHaveLength(3);
  });

  it('has 28 Indian states and 8 union territories keyed by GST code', () => {
    expect(SUBDIVISIONS.IN.filter((s) => s.kind === 'state')).toHaveLength(28);
    expect(SUBDIVISIONS.IN.filter((s) => s.kind === 'union_territory')).toHaveLength(8);
    expect(SUBDIVISIONS.IN.find((s) => s.name === 'Kerala')?.code).toBe('32');
    expect(SUBDIVISIONS.IN.every((s) => /^\d{2}$/.test(s.code))).toBe(true);
  });

  it('only validates states for the home markets', () => {
    expect(isSubdivisionOf('IN', '32')).toBe(true);
    expect(isSubdivisionOf('IN', '99')).toBe(false);
    expect(isSubdivisionOf('GB', 'anything')).toBe(true);
    expect(subdivisionsOf('US')).toEqual([]);
  });
});

describe('titles', () => {
  it('adds each market’s own forms of address to the common set', () => {
    expect(titlesFor('LK')).toContain('Ven.');
    expect(titlesFor('MY')).toContain('Datuk');
    expect(titlesFor('MY')).toContain("Dato'");
    expect(titlesFor('IN')).toContain('Smt.');
    expect(titlesFor('GB')).toEqual(titlesFor(null));
    expect(titlesFor('LK')[0]).toBe('Mr.');
  });
});

describe('identity documents', () => {
  it('offers national cards to locals and passports first to foreigners', () => {
    expect(idTypesFor('LK', 'LK')[0]).toBe('nic');
    expect(idTypesFor('MY', 'MY')).toContain('mypr');
    expect(idTypesFor('IN', 'IN')[0]).toBe('aadhaar');
    expect(idTypesFor('IN', 'GB')).toEqual(['passport', 'oci', 'other']);
    expect(idTypesFor('LK', 'DE')[0]).toBe('passport');
  });

  it('never keeps more than the last four Aadhaar digits', () => {
    expect(maskAadhaar('1234 5678 9012')).toBe('9012');
    expect(normalizeIdNumber('aadhaar', '123456789012')).toBe('9012');
    expect(isValidIdNumber('aadhaar', '1234 5678 9012')).toBe(true);
    expect(isValidIdNumber('aadhaar', '12')).toBe(false);
  });

  it('validates and decodes Sri Lankan NICs', () => {
    // Old format: born 1991, day 104 → 13 April (leap-year calendar), male.
    expect(nicBirthInfo('911042754V')).toEqual({ dateOfBirth: '1991-04-13', gender: 'male' });
    // New format: born 1998, day 612 → female, day 112 → 21 April.
    expect(nicBirthInfo('199861212345')).toEqual({ dateOfBirth: '1998-04-21', gender: 'female' });
    expect(isValidIdNumber('nic', '911042754v')).toBe(true);
    expect(isValidIdNumber('nic', '913992754V')).toBe(false); // day 399 does not exist
    expect(isValidIdNumber('nic', '12345')).toBe(false);
  });

  it('validates MyKad numbers by their embedded birth date', () => {
    const today = new Date('2026-09-17T00:00:00Z');
    expect(mykadBirthDate('900101-14-5566', today)).toBe('1990-01-01');
    expect(mykadBirthDate('050230145566', today)).toBeNull(); // 30 February
    expect(mykadBirthDate('150615-10-1234', today)).toBe('2015-06-15');
    expect(isValidIdNumber('mykad', '900101-14-5566')).toBe(true);
  });

  it('checks passport and Indian voter-ID shapes', () => {
    expect(isValidIdNumber('passport', 'n 1234567')).toBe(true);
    expect(isValidIdNumber('passport', '!!')).toBe(false);
    expect(isValidIdNumber('voter_id', 'ABC1234567')).toBe(true);
    expect(isValidIdNumber('voter_id', 'AB1234567')).toBe(false);
  });
});

describe('meal codes', () => {
  it('shows Indian plan codes only when asked', () => {
    expect(displayMealCode('BB')).toBe('BB');
    expect(displayMealCode('BB', 'indian')).toBe('CP');
    expect(displayMealCode('HB', 'indian')).toBe('MAP');
    expect(displayMealCode('RO', 'indian')).toBe('EP');
    expect(displayMealCode('XX', 'indian')).toBe('XX');
  });
});

describe('presets', () => {
  it('gives each market sources that default to an existing segment', () => {
    for (const preset of Object.values(REGION_PRESETS)) {
      const segments = new Set(preset.marketSegments.map((s) => s.code));
      for (const source of preset.businessSources) {
        expect(segments.has(source.defaultSegment), `${preset.country}/${source.shortCode}`).toBe(
          true,
        );
      }
    }
  });

  it('never repeats a code within one preset', () => {
    for (const preset of Object.values(REGION_PRESETS)) {
      for (const list of [
        preset.marketSegments.map((s) => s.code),
        preset.businessSources.map((s) => s.shortCode),
        preset.paymentMethods.map((m) => m.code),
      ]) {
        expect(new Set(list).size, preset.country).toBe(list.length);
      }
    }
  });

  it('has exactly one default cash method and one city-ledger method per market', () => {
    for (const preset of Object.values(REGION_PRESETS)) {
      expect(preset.paymentMethods.filter((m) => m.isDefaultCash)).toHaveLength(1);
      expect(preset.paymentMethods.filter((m) => m.category === 'city_ledger')).toHaveLength(1);
    }
  });

  it('carries the market-specific details', () => {
    expect(REGION_PRESETS.LK.paymentMethods.map((m) => m.code)).toContain('LANKAQR');
    expect(REGION_PRESETS.MY.paymentMethods.map((m) => m.code)).toContain('DUITNOWQR');
    expect(REGION_PRESETS.IN.paymentMethods.map((m) => m.code)).toContain('UPI');
    expect(REGION_PRESETS.IN.businessSources.map((s) => s.shortCode)).toContain('MMT');
    expect(REGION_PRESETS.IN.mealCodeStyle).toBe('indian');
    expect(REGION_PRESETS.IN.cityLedgerLabel).toBe('Bill to Company (BTC)');
    expect(presetFor('US').country).toBe('LK');
  });
});
