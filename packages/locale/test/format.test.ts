import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  formatDate,
  formatGrouped,
  formatPhone,
  formatTime,
  nightsBetween,
  normalizePhone,
  parseDateInput,
  parseTimeInput,
  whatsappLink,
} from '../src';

describe('dates', () => {
  it('formats ISO dates day-first by default', () => {
    expect(formatDate('2026-09-17')).toBe('17/09/2026');
    expect(formatDate('2026-09-17', 'mdy')).toBe('09/17/2026');
    expect(formatDate('2026-09-17T10:00:00Z')).toBe('17/09/2026');
    expect(formatDate(null)).toBe('');
  });

  it('parses ISO and day-first input, and rejects impossible dates', () => {
    expect(parseDateInput('2026-09-17')).toBe('2026-09-17');
    expect(parseDateInput('17/09/2026')).toBe('2026-09-17');
    expect(parseDateInput('7/9/2026')).toBe('2026-09-07');
    expect(parseDateInput('17-09-26')).toBe('2026-09-17');
    expect(parseDateInput('17.09.2026')).toBe('2026-09-17');
    expect(parseDateInput('31/02/2026')).toBeNull();
    expect(parseDateInput('2026-02-30')).toBeNull();
    expect(parseDateInput('29/02/2028')).toBe('2028-02-29');
    expect(parseDateInput('tomorrow')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });

  it('counts nights and shifts dates across month ends', () => {
    expect(nightsBetween('2026-09-17', '2026-09-18')).toBe(1);
    expect(nightsBetween('2026-09-28', '2026-10-03')).toBe(5);
    expect(nightsBetween('2026-09-18', '2026-09-17')).toBe(0);
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('times', () => {
  it('formats 24-hour storage as 12-hour display', () => {
    expect(formatTime('14:05')).toBe('02:05 PM');
    expect(formatTime('00:30:00')).toBe('12:30 AM');
    expect(formatTime('12:00')).toBe('12:00 PM');
    expect(formatTime('09:15', '24h')).toBe('09:15');
  });

  it('parses the ways people type a time', () => {
    expect(parseTimeInput('14:00')).toBe('14:00');
    expect(parseTimeInput('1400')).toBe('14:00');
    expect(parseTimeInput('2:00 pm')).toBe('14:00');
    expect(parseTimeInput('2pm')).toBe('14:00');
    expect(parseTimeInput('02:00 PM')).toBe('14:00');
    expect(parseTimeInput('12 am')).toBe('00:00');
    expect(parseTimeInput('12 pm')).toBe('12:00');
    expect(parseTimeInput('11:00 AM')).toBe('11:00');
    expect(parseTimeInput('25:00')).toBeNull();
    expect(parseTimeInput('13 pm')).toBeNull();
    expect(parseTimeInput('10:75')).toBeNull();
  });
});

describe('numbers', () => {
  it('groups rupees the Indian way and everything else the Western way', () => {
    expect(formatGrouped(100000, 'INR')).toBe('1,00,000.00');
    expect(formatGrouped(12345678.5, 'INR')).toBe('1,23,45,678.50');
    expect(formatGrouped(100000, 'LKR')).toBe('100,000.00');
    expect(formatGrouped(1234.5, 'MYR')).toBe('1,234.50');
  });
});

describe('phones', () => {
  it('reads a local number in the property country and returns E.164', () => {
    const lk = normalizePhone('077 123 4567', 'LK');
    expect(lk?.e164).toBe('+94771234567');
    expect(lk?.valid).toBe(true);
    expect(lk?.country).toBe('LK');

    const my = normalizePhone('012-345 6789', 'MY');
    expect(my?.e164).toBe('+60123456789');
    expect(my?.valid).toBe(true);

    const inn = normalizePhone('98765 43210', 'IN');
    expect(inn?.e164).toBe('+919876543210');
    expect(inn?.valid).toBe(true);
  });

  it('keeps an explicit international prefix regardless of the property country', () => {
    // (07700 900xxx is Ofcom's fictional range and matches no country; 07911 is Guernsey.)
    const uk = normalizePhone('+44 7400 123456', 'LK');
    expect(uk?.e164).toBe('+447400123456');
    expect(uk?.country).toBe('GB');
    expect(uk?.valid).toBe(true);
    expect(normalizePhone('+49 1512 3456789', 'MY')?.country).toBe('DE');
  });

  it('rejects text that is not a phone number', () => {
    expect(normalizePhone('hello', 'LK')).toBeNull();
    expect(normalizePhone('', 'LK')).toBeNull();
    // The parser alone would read these digits as +94 204.
    expect(normalizePhone('ext 204', 'LK')).toBeNull();
    expect(normalizePhone('123', 'IN')).toBeNull();
  });

  it('formats for display and builds WhatsApp links', () => {
    expect(formatPhone('+94771234567')).toBe('+94 77 123 4567');
    expect(whatsappLink('+94771234567', 'Hi there')).toBe(
      'https://wa.me/94771234567?text=Hi%20there',
    );
  });
});
