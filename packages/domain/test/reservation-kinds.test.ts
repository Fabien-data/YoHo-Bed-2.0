import { describe, expect, it } from 'vitest';
import {
  RESERVATION_KINDS,
  RESERVATION_KIND_META,
  TAG_COLORS,
  isReservationKind,
  isTagColor,
  resolveKindDisplay,
} from '../src';

describe('reservation kinds', () => {
  it('holds inventory exactly for confirmed bookings and holds', () => {
    const holding = RESERVATION_KINDS.filter((k) => RESERVATION_KIND_META[k].holdsInventory);
    expect(holding.sort()).toEqual(['confirm', 'hold_confirm', 'hold_unconfirm']);
  });

  it('requires a release time only for the two hold kinds', () => {
    const holds = RESERVATION_KINDS.filter((k) => RESERVATION_KIND_META[k].isHold);
    expect(holds.sort()).toEqual(['hold_confirm', 'hold_unconfirm']);
  });

  it('starts confirmed kinds as Approved and unconfirmed ones as Pending', () => {
    expect(RESERVATION_KIND_META.confirm.initialStatus).toBe('Approved');
    expect(RESERVATION_KIND_META.hold_confirm.initialStatus).toBe('Approved');
    expect(RESERVATION_KIND_META.hold_unconfirm.initialStatus).toBe('Pending');
    expect(RESERVATION_KIND_META.inquiry.initialStatus).toBe('Pending');
    expect(RESERVATION_KIND_META.online_failed.initialStatus).toBe('Pending');
  });

  it('offers Yanolja’s three quick choices on the Quick Reservation panel', () => {
    const quick = RESERVATION_KINDS.filter((k) => RESERVATION_KIND_META[k].quick).map(
      (k) => RESERVATION_KIND_META[k].shortLabel,
    );
    expect(quick).toEqual(['Confirm', 'Inquiry', 'Hold']);
  });

  it('uses Yanolja’s exact labels on the full page', () => {
    expect(RESERVATION_KINDS.map((k) => RESERVATION_KIND_META[k].label)).toEqual([
      'Confirm Booking',
      'Unconfirmed Booking Inquiry',
      'Online Failed Booking',
      'Hold Confirm Booking',
      'Hold Unconfirm Booking',
    ]);
  });

  it('applies label and colour overrides without changing behaviour', () => {
    expect(resolveKindDisplay('confirm')).toEqual({
      label: 'Confirm Booking',
      shortLabel: 'Confirm',
      color: 'green',
    });
    const custom = resolveKindDisplay('inquiry', {
      inquiry: { label: 'Tentative', color: 'violet' },
    });
    expect(custom).toEqual({ label: 'Tentative', shortLabel: 'Tentative', color: 'violet' });
    expect(resolveKindDisplay('inquiry', { inquiry: { label: '   ' } }).label).toBe(
      'Unconfirmed Booking Inquiry',
    );
  });

  it('only uses palette colours', () => {
    for (const k of RESERVATION_KINDS)
      expect(isTagColor(RESERVATION_KIND_META[k].color)).toBe(true);
    expect(new Set(TAG_COLORS).size).toBe(TAG_COLORS.length);
    expect(isReservationKind('confirm')).toBe(true);
    expect(isReservationKind('Approved')).toBe(false);
  });
});
