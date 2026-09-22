import { describe, expect, it } from 'vitest';
import { DEFAULT_PROPERTY_SETTINGS, resolvePropertySettings } from '../src';

describe('property settings', () => {
  it('resolves an empty or missing object to the defaults', () => {
    expect(resolvePropertySettings({})).toEqual(DEFAULT_PROPERTY_SETTINGS);
    expect(resolvePropertySettings(null)).toEqual(DEFAULT_PROPERTY_SETTINGS);
    expect(resolvePropertySettings('nonsense')).toEqual(DEFAULT_PROPERTY_SETTINGS);
  });

  it('keeps valid values and fills the rest from the defaults', () => {
    const s = resolvePropertySettings({
      timeFormat: '24h',
      mealCodeStyle: 'indian',
      rateControl: { staffMaxDiscountPct: 10 },
      unconfirmedPolicy: 'arrival_day_end',
    });
    expect(s.timeFormat).toBe('24h');
    expect(s.mealCodeStyle).toBe('indian');
    expect(s.rateControl).toEqual({ staffMaxDiscountPct: 10, staffCanComp: false });
    expect(s.unconfirmedPolicy).toBe('arrival_day_end');
    expect(s.hold).toEqual(DEFAULT_PROPERTY_SETTINGS.hold);
  });

  it('clamps out-of-range numbers and drops unknown values', () => {
    const s = resolvePropertySettings({
      rateControl: { staffMaxDiscountPct: 250, staffCanComp: 'yes' },
      hold: { defaultHours: -5, reminderHours: 'soon' },
      timeFormat: '36h',
      unconfirmedPolicy: 'always',
    });
    expect(s.rateControl.staffMaxDiscountPct).toBe(100);
    expect(s.rateControl.staffCanComp).toBe(false);
    expect(s.hold.defaultHours).toBe(1);
    expect(s.hold.reminderHours).toBe(DEFAULT_PROPERTY_SETTINGS.hold.reminderHours);
    expect(s.timeFormat).toBe('12h');
    expect(s.unconfirmedPolicy).toBe('never');
  });

  it('keeps only well-formed kind overrides', () => {
    const s = resolvePropertySettings({
      kindOverrides: {
        inquiry: { label: '  Tentative  ', color: 'violet' },
        confirm: { color: 'not-a-colour' },
        bogus: { label: 'x' },
      },
    });
    expect(s.kindOverrides).toEqual({ inquiry: { label: 'Tentative', color: 'violet' } });
  });

  it('blocks check-out with an unpaid balance unless the hotel says otherwise (UX-1a)', () => {
    expect(resolvePropertySettings({}).checkoutBalancePolicy).toBe('block');
    expect(resolvePropertySettings({ checkoutBalancePolicy: 'allow' }).checkoutBalancePolicy).toBe(
      'allow',
    );
    expect(resolvePropertySettings({ checkoutBalancePolicy: 'maybe' }).checkoutBalancePolicy).toBe(
      'block',
    );
  });

  it('treats an empty title list as "use the country default"', () => {
    expect(resolvePropertySettings({ titles: [] }).titles).toBeNull();
    expect(resolvePropertySettings({ titles: ['Mr.', ' ', 'Dr.'] }).titles).toEqual(['Mr.', 'Dr.']);
  });
});
