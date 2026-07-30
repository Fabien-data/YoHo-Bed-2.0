import { describe, it, expect } from 'vitest';
import { checkBooking, summarise, type LegacyBookingFacts } from '../src/parity/compare';

/**
 * The cutover gate has to be trustworthy before it can gate anything: a harness that passes
 * everything is worse than no harness, because it manufactures confidence. These tests pin both
 * directions — clean bookings pass, and each specific corruption is caught.
 *
 * The numbers come from the real seed example in docs/PRICING.md §9A: base 18,000 → yoho 2,000 →
 * selling 24,390.25/night, so a 2-night stay grosses 48,780.50 and settles
 * 36,000 + 4,000 + 8,780.50 + 0 tax.
 */

const CLEAN: LegacyBookingFacts = {
  id: 1,
  reference: '2607110001',
  amount: 48780.5,
  totalBasePrice: 36000,
  totalSystemBasePrice: null,
  yohoCommission: 4000,
  otaCommission: 8780.5,
  taxes: 0,
  rooms: 1,
  nights: 2,
  dailyRates: [24390.25, 24390.25],
  pricingType: 'BottomUp',
};

describe('parity gate', () => {
  it('passes a booking that reconciles exactly', () => {
    const r = checkBooking(CLEAN);
    expect(r.diffs).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('handles a multi-room booking (nightly rate is per room)', () => {
    const r = checkBooking({
      ...CLEAN,
      rooms: 3,
      amount: round(48780.5 * 3),
      totalBasePrice: 108000,
      yohoCommission: 12000,
      otaCommission: round(8780.5 * 3),
    });
    expect(r.ok).toBe(true);
  });

  it('catches a gross that does not match the per-night snapshot', () => {
    // booking_days is what settlement reconciles against in 2.0 — if it cannot reproduce the
    // legacy gross, every future payout for this booking is wrong.
    const r = checkBooking({ ...CLEAN, amount: 50000 });
    const d = r.diffs.find((x) => x.code === 'gross_vs_daily_rates');
    expect(d).toBeDefined();
    expect(d!.legacy).toBe(50000);
    expect(d!.recomputed).toBe(48780.5);
    expect(d!.delta).toBeCloseTo(1219.5, 2);
    expect(r.ok).toBe(false);
  });

  it('catches a decomposition that does not satisfy the settlement identity', () => {
    // Recorded OTA commission disagrees with (amount − taxes − base − yoho).
    const r = checkBooking({ ...CLEAN, otaCommission: 8000 });
    const d = r.diffs.find((x) => x.code === 'decomposition_does_not_reconcile');
    expect(d).toBeDefined();
    expect(d!.recomputed).toBeCloseTo(8780.5, 2);
    expect(d!.delta).toBeCloseTo(-780.5, 2);
  });

  it('surfaces the TopDown/BottomUp base disagreement rather than silently picking one', () => {
    const r = checkBooking({ ...CLEAN, totalSystemBasePrice: 35000, pricingType: 'TopDown' });
    const d = r.diffs.find((x) => x.code === 'base_figures_disagree');
    expect(d).toBeDefined();
    expect(d!.delta).toBeCloseTo(1000, 2);
    expect(d!.detail).toContain('TopDown');
  });

  it('stays silent when the two base figures agree', () => {
    const r = checkBooking({ ...CLEAN, totalSystemBasePrice: 36000 });
    expect(r.diffs.find((x) => x.code === 'base_figures_disagree')).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('flags a booking with no per-night rows at all', () => {
    const r = checkBooking({ ...CLEAN, dailyRates: [] });
    expect(r.diffs.map((d) => d.code)).toContain('missing_daily_rates');
  });

  it('flags a night count that disagrees with the stay length', () => {
    const r = checkBooking({ ...CLEAN, dailyRates: [24390.25], nights: 2, amount: 24390.25 });
    expect(r.diffs.map((d) => d.code)).toContain('night_count_mismatch');
  });

  it('flags a negative component — sold below cost or corrupt', () => {
    // base + yoho exceed the commissionable amount, so OTA commission goes negative.
    const r = checkBooking({
      ...CLEAN,
      totalBasePrice: 46000,
      yohoCommission: 4000,
      otaCommission: -1219.5,
    });
    expect(r.diffs.map((d) => d.code)).toContain('negative_component');
  });

  it('honours a cents tolerance for legacy float drift, without hiding real gaps', () => {
    const oneCentOff = { ...CLEAN, amount: 48780.51 };
    expect(checkBooking(oneCentOff, 0).ok).toBe(false);
    // A 1c tolerance absorbs it...
    expect(checkBooking(oneCentOff, 1).ok).toBe(true);
    // ...but not a 10-rupee gap.
    expect(checkBooking({ ...CLEAN, amount: 48790.5 }, 1).ok).toBe(false);
  });

  describe('summary', () => {
    it('blocks cutover when anything fails and ranks the worst offenders first', () => {
      const results = [
        checkBooking(CLEAN),
        checkBooking({ ...CLEAN, id: 2, amount: 48790.5 }), // 10 off
        checkBooking({ ...CLEAN, id: 3, amount: 58780.5 }), // 10,000 off
      ];
      const s = summarise(results);
      expect(s.checked).toBe(3);
      expect(s.passed).toBe(1);
      expect(s.failed).toBe(2);
      expect(s.canCutOver).toBe(false);
      expect(s.byCode.gross_vs_daily_rates).toBe(2);
      // Biggest money discrepancy first — that is what a reviewer needs to see.
      expect(s.worst[0]!.bookingId).toBe(3);
    });

    it('opens the gate only when every booking reconciles', () => {
      const s = summarise([checkBooking(CLEAN), checkBooking({ ...CLEAN, id: 2 })]);
      expect(s.canCutOver).toBe(true);
      expect(s.failed).toBe(0);
    });
  });
});

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
