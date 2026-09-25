import { describe, expect, it } from 'vitest';
import type { StayBar, StayUnit, StayView } from '@/lib/api';
import { addDays, daysBetween, msToMidnightIn, stayRange, windowDates, windowLabel } from './dates';
import { barSpan, barTier, columnWidth, dayAt, groupRooms, METRICS, stackBars } from './layout';
import { LEGEND_STATES, STATE_META, sourceLabel, stateOf } from './status';
import { EMPTY_FILTERS, filterChips, matchesBar, roomChipMatches, unitVisible } from './filters';
import { capabilities, destinationIssue, rangeIsFree } from './validity';
import { dayStats } from './stats';
import { searchWindow } from './search';
import { DEFAULT_PREFERENCES, parsePreferences } from './prefs';
import { stayActions } from './actions';

const booking = (over: Partial<StayBar> = {}): StayBar => ({
  kind: 'booking',
  id: 'leg-1',
  bookingId: 'b-1',
  reference: 'R-1',
  guestName: 'Maya Perera',
  status: 'Approved',
  reservationKind: 'confirm',
  source: 'Extranet',
  roomId: 'deluxe',
  roomUnitId: 'u-101',
  from: '2026-03-08',
  to: '2026-03-10',
  ...over,
});
const unit = (over: Partial<StayUnit> = {}): StayUnit => ({
  id: 'u-101',
  roomId: 'deluxe',
  code: '101',
  displayName: null,
  floor: '1',
  housekeeping: 'clean',
  status: 'active',
  bars: [],
  ...over,
});

describe('dates', () => {
  it('does whole-night arithmetic across month ends and daylight-saving changes', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU clocks change that night
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
    expect(windowDates('2026-12-30', 4)).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
  it('labels stays and windows the way the desk reads them', () => {
    expect(stayRange('2026-09-23', '2026-09-26')).toBe('23–26 Sep');
    expect(stayRange('2026-09-30', '2026-10-02')).toBe('30 Sep – 2 Oct');
    expect(windowLabel('2026-09-23', 14)).toBe('23 Sep – 6 Oct 2026');
  });
});

describe('layout', () => {
  const from = '2026-03-07';
  it('places a stay on its nights, clipped to the window, with honest edges', () => {
    expect(barSpan(from, 7, { from: '2026-03-01', to: '2026-03-07' })).toBeNull();
    expect(barSpan(from, 7, { from: '2026-03-14', to: '2026-03-16' })).toBeNull();
    expect(barSpan(from, 7, { from: '2026-03-08', to: '2026-03-09' })).toEqual({
      start: 1,
      span: 1,
      startsBefore: false,
      endsAfter: false,
    });
    // Leaving on the morning after the last night shown is a departure, not a continuation.
    expect(barSpan(from, 7, { from: '2026-03-12', to: '2026-03-14' })).toMatchObject({
      start: 5,
      span: 2,
      endsAfter: false,
    });
    expect(barSpan(from, 7, { from: '2026-03-06', to: '2026-03-16' })).toEqual({
      start: 0,
      span: 7,
      startsBefore: true,
      endsAfter: true,
    });
  });
  it('fits the window to the width, within limits', () => {
    const { label, minCol } = METRICS.comfortable;
    expect(columnWidth(label + 2 + 14 * 80, 14, 'comfortable')).toBe(80);
    expect(columnWidth(600, 30, 'comfortable')).toBe(minCol);
    expect(columnWidth(4000, 4, 'comfortable')).toBe(196);
    expect(columnWidth(0, 14, 'compact')).toBe(METRICS.compact.minCol);
  });
  it('packs overlapping stays into separate lines', () => {
    const lines = stackBars([
      booking({ id: 'a', from: '2026-03-08', to: '2026-03-10' }),
      booking({ id: 'b', from: '2026-03-09', to: '2026-03-11' }),
      booking({ id: 'c', from: '2026-03-10', to: '2026-03-12' }),
    ]);
    expect(lines.map((l) => l.map((b) => b.id))).toEqual([['a', 'c'], ['b']]);
  });
  it('turns a pointer offset into a night, never outside the window', () => {
    expect(dayAt(0, 60, 7)).toBe(0);
    expect(dayAt(179, 60, 7)).toBe(2);
    expect(dayAt(-5, 60, 7)).toBe(0);
    expect(dayAt(9999, 60, 7)).toBe(6);
  });
  it('groups rooms by floor with the unset floor last', () => {
    const groups = groupRooms(
      [
        {
          roomId: 'deluxe',
          name: 'Deluxe',
          quantity: 3,
          perDate: [],
          units: [
            unit({ id: 'a', floor: '2' }),
            unit({ id: 'b', floor: null }),
            unit({ id: 'c', floor: '10' }),
          ],
        },
      ],
      'floor',
    );
    expect(groups.map((g) => g.name)).toEqual(['Floor 2', 'Floor 10', 'No floor set']);
  });
  it('says less on narrow bars and more on wide ones', () => {
    expect(barTier(30)).toBe('icon');
    expect(barTier(80)).toBe('name');
    expect(barTier(300)).toBe('full');
  });
});

describe('status', () => {
  it('names every state with a label, never colour alone', () => {
    for (const state of LEGEND_STATES) expect(STATE_META[state].label).toBeTruthy();
    expect(stateOf(booking({ status: 'CheckedIn' }))).toBe('inhouse');
    expect(stateOf(booking({ status: 'Pending', holdUntil: '2026-03-08T12:00:00Z' }))).toBe('hold');
    expect(stateOf(booking({ status: 'Pending' }))).toBe('pending');
    expect(stateOf(booking({ reservationKind: 'hold_confirm' }))).toBe('hold');
    expect(stateOf(booking({ reservationKind: 'inquiry', status: 'Pending' }))).toBe('tentative');
    expect(stateOf({ kind: 'block', id: 'x', from: 'a', to: 'b', blockKind: 'blocked' })).toBe(
      'blocked',
    );
    expect(stateOf({ kind: 'block', id: 'x', from: 'a', to: 'b' })).toBe('out_of_service');
  });
  it('keeps the source secondary and readable', () => {
    expect(sourceLabel({ source: 'OTA', channel: 'Booking.com' })).toBe('Booking.com');
    expect(sourceLabel({ source: 'Extranet' })).toBe('Direct');
  });
});

describe('filters', () => {
  it('dims by reservation attributes on the day the chips describe', () => {
    const bar = booking({ status: 'Approved', from: '2026-03-08', balanceDue: true });
    expect(matchesBar(bar, EMPTY_FILTERS, '2026-03-08')).toBe(true);
    expect(matchesBar(bar, { ...EMPTY_FILTERS, state: 'confirmed' }, '2026-03-08')).toBe(true);
    expect(matchesBar(bar, { ...EMPTY_FILTERS, state: 'inhouse' }, '2026-03-08')).toBe(false);
    expect(matchesBar(bar, { ...EMPTY_FILTERS, activity: 'arrivals' }, '2026-03-08')).toBe(true);
    expect(matchesBar(bar, { ...EMPTY_FILTERS, activity: 'arrivals' }, '2026-03-09')).toBe(false);
    expect(matchesBar(bar, { ...EMPTY_FILTERS, balance: true }, '2026-03-08')).toBe(true);
    expect(matchesBar(bar, { ...EMPTY_FILTERS, source: 'Direct' }, '2026-03-08')).toBe(true);
  });
  it('hides rooms by category, floor and housekeeping', () => {
    const u = unit({ housekeeping: 'dirty' });
    expect(unitVisible(u, { ...EMPTY_FILTERS, housekeeping: 'dirty' })).toBe(true);
    expect(unitVisible(u, { ...EMPTY_FILTERS, floor: '2' })).toBe(false);
    expect(unitVisible(u, { ...EMPTY_FILTERS, category: 'standard' })).toBe(false);
  });
  it('counts the room-status chips on the chip date', () => {
    const inHouse = unit({ bars: [booking({ status: 'CheckedIn', to: '2026-03-10' })] });
    expect(roomChipMatches(inHouse, 'occupied', '2026-03-09')).toBe(true);
    expect(roomChipMatches(inHouse, 'dueOut', '2026-03-10')).toBe(true);
    expect(roomChipMatches(unit(), 'vacant', '2026-03-09')).toBe(true);
  });
  it('speaks plain language on the active chips', () => {
    expect(
      filterChips(
        { ...EMPTY_FILTERS, state: 'confirmed', source: 'Booking.com', category: 'deluxe' },
        { category: () => 'Deluxe' },
      ).map((c) => c.label),
    ).toEqual(['Confirmed', 'Booking.com', 'Deluxe']);
  });
});

describe('validity', () => {
  const ctx = { today: '2026-03-09', canAssign: true, canChangeDates: true };
  it('offers only the gestures a stay can take', () => {
    expect(capabilities(booking(), ctx)).toMatchObject({
      moveRoom: true,
      shiftDates: true,
      resize: true,
    });
    expect(capabilities(booking({ status: 'CheckedIn' }), ctx)).toMatchObject({
      moveRoom: true,
      shiftDates: false,
      resize: true,
    });
    expect(capabilities(booking({ source: 'OTA' }), ctx)).toMatchObject({
      shiftDates: false,
      resize: false,
    });
    expect(capabilities(booking({ segment: { index: 0, of: 2 } }), ctx).shiftDates).toBe(false);
    // The part of a split stay already slept in is history.
    expect(capabilities(booking({ status: 'CheckedIn', to: '2026-03-09' }), ctx).moveRoom).toBe(
      false,
    );
    expect(capabilities(booking(), { ...ctx, canAssign: false }).moveRoom).toBe(false);
  });
  it('explains why a room cannot take a stay', () => {
    const bar = booking();
    const neighbour = booking({
      id: 'n',
      bookingId: 'b-2',
      guestName: 'Arun',
      from: '2026-03-10',
      to: '2026-03-11',
    });
    const u = unit({ id: 'u-102', code: '102', bars: [neighbour] });
    expect(destinationIssue(bar, u)).toBeNull(); // adjacent stays do not clash
    expect(destinationIssue(bar, u, { from: '2026-03-09', to: '2026-03-11' })).toMatch(/Arun/);
    expect(destinationIssue(bar, { ...u, roomId: 'standard' })).toMatch(/room type/);
    expect(destinationIssue(bar, { ...u, status: 'inactive' })).toMatch(/out of service/);
    const block = {
      kind: 'block' as const,
      id: 'blk',
      from: '2026-03-08',
      to: '2026-03-09',
      blockKind: 'blocked' as const,
    };
    expect(destinationIssue(bar, unit({ bars: [block] }))).toMatch(/blocked/);
  });
  it('checks an in-house move only from today on', () => {
    const guest = booking({ status: 'CheckedIn', from: '2026-03-07', to: '2026-03-11' });
    const u = unit({
      id: 'u-102',
      bars: [booking({ id: 'x', from: '2026-03-06', to: '2026-03-09' })],
    });
    expect(destinationIssue(guest, u, { today: '2026-03-09' })).toBeNull();
    expect(destinationIssue(guest, u, { today: '2026-03-08' })).not.toBeNull();
  });
  it('knows an empty range when it sees one', () => {
    const u = unit({ bars: [booking()] });
    expect(rangeIsFree(u, '2026-03-10', '2026-03-12')).toBe(true);
    expect(rangeIsFree(u, '2026-03-09', '2026-03-11')).toBe(false);
  });
});

describe('stats', () => {
  it('counts arrivals and departures once per stay, even when it is split', () => {
    const view = {
      dates: ['2026-03-08', '2026-03-09', '2026-03-10'],
      footer: [],
      unassigned: [booking({ id: 'un', roomUnitId: null, from: '2026-03-09', to: '2026-03-10' })],
      roomTypes: [
        {
          roomId: 'deluxe',
          name: 'Deluxe',
          quantity: 2,
          perDate: [],
          units: [
            unit({
              bars: [
                booking({ from: '2026-03-08', to: '2026-03-09', segment: { index: 0, of: 2 } }),
              ],
            }),
            unit({
              id: 'u-102',
              bars: [
                booking({
                  id: 'leg-2',
                  from: '2026-03-09',
                  to: '2026-03-10',
                  segment: { index: 1, of: 2 },
                }),
              ],
            }),
          ],
        },
      ],
    } as unknown as StayView;
    const stats = dayStats(view);
    expect(stats.map((s) => s.arrivals)).toEqual([1, 1, 0]);
    expect(stats.map((s) => s.departures)).toEqual([0, 0, 2]);
    expect(stats.map((s) => s.unassigned)).toEqual([0, 1, 0]);
  });
});

describe('search', () => {
  it('finds a stay once, name matches first, then rooms', () => {
    const units = [
      unit({ bars: [booking({ guestName: 'José Silva', reference: 'R-9' })] }),
      unit({ id: 'u-102', code: '102', displayName: 'Silva Suite' }),
      unit({
        id: 'u-103',
        code: '103',
        bars: [booking({ id: 'leg-9', bookingId: 'b-9', guestName: 'Ana Silva' })],
      }),
    ];
    const hits = searchWindow(units, [], 'silva');
    expect(hits.map((h) => h.kind)).toEqual(['stay', 'stay', 'room']);
    expect(searchWindow(units, [], 'jose')[0]).toMatchObject({ kind: 'stay' });
    expect(searchWindow(units, [], 'j')).toEqual([]);
  });
});

describe('preferences', () => {
  it('survives junk and upgrades the first release’s settings', () => {
    expect(parsePreferences('nonsense')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences({ days: 99, density: 'huge' })).toMatchObject({
      days: 14,
      density: 'comfortable',
    });
    expect(
      parsePreferences({ days: 28, statistics: false, metadata: false, widePanel: true }),
    ).toMatchObject({ days: 30, headerStats: false, barDetails: false, panelWidth: 'wide' });
    expect(parsePreferences({ colorBy: 'source', groupBy: 'floor' })).toMatchObject({
      colorBy: 'source',
      groupBy: 'floor',
    });
  });
});

describe('stage-aware actions', () => {
  const owner = { permissions: null };
  const today = '2026-03-08';
  it('leads with the stage’s main job', () => {
    expect(
      stayActions(booking({ status: 'Pending', reservationKind: 'hold_unconfirm' }), today, owner)
        .primary,
    ).toBe('confirm');
    expect(stayActions(booking({ from: today }), today, owner).primary).toBe('check-in');
    expect(stayActions(booking({ status: 'CheckedIn' }), today, owner).primary).toBe('check-out');
    expect(
      stayActions(booking({ from: '2026-03-20', to: '2026-03-22', roomUnitId: null }), today, owner)
        .primary,
    ).toBe('assign');
    expect(
      stayActions(booking({ from: '2026-03-20', to: '2026-03-22', balanceDue: true }), today, owner)
        .primary,
    ).toBe('take-payment');
  });
  it('offers nothing a role cannot do, and no payments to hotel-created roles', () => {
    const readOnly = { permissions: ['reservation_read' as const] };
    expect(stayActions(booking({ from: today }), today, readOnly)).toEqual({
      primary: null,
      secondary: [],
    });
    const desk = {
      permissions: [
        'reservation_read',
        'reservation_change',
        'check_in_out',
        'room_assignment',
        'financial_read',
      ] as const,
    };
    const actions = stayActions(booking({ status: 'CheckedIn', balanceDue: true }), today, {
      permissions: [...desk.permissions],
    });
    expect(actions.primary).toBe('check-out');
    expect(actions.secondary).not.toContain('take-payment');
  });
});

describe('the day at the desk (owner brief, 2026-09-26)', () => {
  it('finds a room whose guest leaves on the first day of the window, bar or no bar', () => {
    const leaving = unit({
      departures: [{ bookingId: 'b-9', reference: 'R-9', guestName: 'Nimal', balanceDue: false }],
    });
    // The window starts on the departure day, so there is no bar for the stay at all.
    expect(roomChipMatches(leaving, 'dueOut', '2026-03-10')).toBe(true);
    expect(roomChipMatches(unit(), 'dueOut', '2026-03-10')).toBe(false);
  });

  it('finds rooms whose guest owes money that day — in house, arriving or leaving', () => {
    const owing = unit({ bars: [booking({ status: 'CheckedIn', balanceDue: true })] });
    expect(roomChipMatches(owing, 'paymentDue', '2026-03-09')).toBe(true);
    // Not on another day, and not when paid.
    expect(roomChipMatches(owing, 'paymentDue', '2026-03-12')).toBe(false);
    const paid = unit({ bars: [booking({ status: 'CheckedIn', balanceDue: false })] });
    expect(roomChipMatches(paid, 'paymentDue', '2026-03-09')).toBe(false);
    // A cancelled stay owes nothing the desk can collect today.
    const gone = unit({ bars: [booking({ status: 'Cancelled', balanceDue: true })] });
    expect(roomChipMatches(gone, 'paymentDue', '2026-03-09')).toBe(false);
    // A departure that still owes.
    const leaving = unit({
      departures: [{ bookingId: 'b-9', reference: 'R-9', guestName: 'Nimal', balanceDue: true }],
    });
    expect(roomChipMatches(leaving, 'paymentDue', '2026-03-10')).toBe(true);
  });

  it('counts down to the hotel’s midnight, not the browser’s', () => {
    // 20:40 UTC is 02:10 in Colombo: 21h50m to go there, 3h20m in UTC.
    const at = new Date('2026-09-25T20:40:00Z');
    expect(msToMidnightIn('Asia/Colombo', at)).toBe((21 * 60 + 50) * 60_000);
    expect(msToMidnightIn('UTC', at)).toBe((3 * 60 + 20) * 60_000);
    expect(msToMidnightIn('Not/AZone', at)).toBe((3 * 60 + 20) * 60_000);
  });

  it('draws a failed online booking like any other unconfirmed stay: it holds its room', () => {
    const failed = booking({ reservationKind: 'online_failed', status: 'Pending' });
    expect(stateOf(failed)).toBe('pending');
    expect(stateOf(booking({ reservationKind: 'inquiry', status: 'Pending' }))).toBe('tentative');
  });
});
