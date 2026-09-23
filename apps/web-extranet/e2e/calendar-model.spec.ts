import { test, expect } from '@playwright/test';
import {
  addDays,
  geometry,
  destinationIssue,
  matchesBar,
  EMPTY_FILTERS,
  parsePreferences,
} from '../components/stayview/calendar-model';
import type { StayBar, StayUnit } from '../lib/api';

const dates = Array.from({ length: 7 }, (_, index) => addDays('2026-03-07', index));
test('clips half-open stays correctly at both calendar boundaries and across DST', () => {
  expect(geometry(dates, { from: '2026-03-01', to: '2026-03-07' })).toBeNull();
  expect(geometry(dates, { from: '2026-03-14', to: '2026-03-16' })).toBeNull();
  expect(geometry(dates, { from: '2026-03-07', to: '2026-03-14' })).toEqual({
    left: 0,
    width: 640,
    startsBefore: false,
    endsAfter: false,
  });
  expect(geometry(dates, { from: '2026-03-06', to: '2026-03-16' })).toEqual({
    left: 0,
    width: 640,
    startsBefore: true,
    endsAfter: true,
  });
  expect(geometry(dates, { from: '2026-03-08', to: '2026-03-09' })?.width).toBe(88);
});
test('room moves reject conflicts and category mismatches without rejecting adjacent stays', () => {
  const bar: StayBar = {
    kind: 'booking',
    id: 'leg',
    roomId: 'deluxe',
    from: '2026-03-08',
    to: '2026-03-10',
  };
  const unit: StayUnit = {
    id: 'room',
    roomId: 'deluxe',
    code: '101',
    displayName: null,
    floor: null,
    housekeeping: 'dirty',
    status: 'active',
    bars: [{ ...bar, id: 'other', from: '2026-03-10', to: '2026-03-11' }],
  };
  expect(destinationIssue(bar, unit)).toBeNull();
  expect(destinationIssue(bar, unit, '2026-03-09', '2026-03-11')).toMatch(/overlapping/);
  expect(destinationIssue(bar, { ...unit, roomId: 'standard' })).toMatch(/category/);
  expect(destinationIssue(bar, { ...unit, status: 'inactive' })).toMatch(/out of service/);
});
test('filters combine status, source, daily activity and financial indicators', () => {
  const bar: StayBar = {
    kind: 'booking',
    id: 'leg',
    status: 'Approved',
    source: 'OTA',
    channel: 'Booking.com',
    from: '2026-03-08',
    to: '2026-03-10',
    balanceDue: true,
  };
  expect(
    matchesBar(
      bar,
      {
        ...EMPTY_FILTERS,
        source: 'Booking.com',
        status: 'Approved',
        activity: 'arrivals',
        balance: true,
      },
      '2026-03-08',
    ),
  ).toBe(true);
  expect(matchesBar(bar, { ...EMPTY_FILTERS, source: 'Extranet' }, '2026-03-08')).toBe(false);
  expect(
    matchesBar(
      { ...bar, balanceDue: undefined },
      { ...EMPTY_FILTERS, balance: true },
      '2026-03-08',
    ),
  ).toBe(false);
});
test('stored preferences are validated and cannot create an unbounded calendar', () => {
  expect(parsePreferences({ days: 10000, density: 'bad', shortcuts: 'false' })).toMatchObject({
    days: 14,
    density: 'comfortable',
    shortcuts: true,
  });
  expect(parsePreferences({ days: 28, density: 'compact', statistics: false })).toMatchObject({
    days: 28,
    density: 'compact',
    statistics: false,
  });
});
