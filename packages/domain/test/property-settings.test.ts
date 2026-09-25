import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROPERTY_SETTINGS,
  nightAuditDueAt,
  resolvePropertySettings,
  wallClockIn,
} from '../src';

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

  it('closes the day by itself and checks overdue stays out, unless the owner says not to', () => {
    const d = resolvePropertySettings({});
    expect(d.autoCheckout).toBe(true);
    expect(d.nightAudit).toEqual({ mode: 'auto', time: '02:00' });

    const off = resolvePropertySettings({
      autoCheckout: false,
      nightAudit: { mode: 'manual', time: '23:30' },
    });
    expect(off.autoCheckout).toBe(false);
    expect(off.nightAudit).toEqual({ mode: 'manual', time: '23:30' });

    // A malformed time or mode falls back rather than disabling the audit.
    const bad = resolvePropertySettings({ nightAudit: { mode: 'sometimes', time: '25:61' } });
    expect(bad.nightAudit).toEqual({ mode: 'auto', time: '02:00' });
    expect(resolvePropertySettings({ autoCheckout: 'yes' }).autoCheckout).toBe(true);
  });
});

describe('the automatic night audit schedule', () => {
  it('closes a day the next morning for a morning time, the same evening for an evening one', () => {
    expect(nightAuditDueAt('2026-09-18', '02:00')).toBe('2026-09-19T02:00');
    expect(nightAuditDueAt('2026-09-30', '00:00')).toBe('2026-10-01T00:00');
    expect(nightAuditDueAt('2026-12-31', '05:45')).toBe('2027-01-01T05:45');
    expect(nightAuditDueAt('2026-09-18', '23:30')).toBe('2026-09-18T23:30');
    expect(nightAuditDueAt('2026-09-18', '12:00')).toBe('2026-09-18T12:00');
    // A broken time uses the default rather than never running.
    expect(nightAuditDueAt('2026-09-18', 'late')).toBe('2026-09-19T02:00');
  });

  it('reads the hotel wall clock in its own timezone, comparable as text', () => {
    // 2026-09-25T20:40Z is 02:10 on the 26th in Colombo (UTC+5:30).
    const at = new Date('2026-09-25T20:40:00Z');
    expect(wallClockIn('Asia/Colombo', at)).toBe('2026-09-26T02:10');
    expect(wallClockIn('UTC', at)).toBe('2026-09-25T20:40');
    expect(wallClockIn('Not/AZone', at)).toBe('2026-09-25T20:40');
    expect(wallClockIn('Asia/Colombo', at) >= nightAuditDueAt('2026-09-25', '02:00')).toBe(true);
    expect(wallClockIn('Asia/Colombo', at) >= nightAuditDueAt('2026-09-26', '02:00')).toBe(false);
  });
});
