import { describe, expect, it } from 'vitest';
import { phoneMatches, phoneNeedle } from '../src';

/**
 * Finding a guest by the number they read out (UX-2). The same number is written a dozen ways;
 * the desk should not have to know which one the booking holds.
 */
describe('matching a phone number', () => {
  it('finds the same number however either side wrote it', () => {
    const stored = ['+94 77 123 4567', '0771234567', '94771234567', '+94-77-123-4567'];
    const typed = ['0771234567', '+94771234567', '77 123 4567', '94 77 123 4567'];
    for (const s of stored) {
      for (const t of typed) {
        expect(phoneMatches(s, t), `${t} should find ${s}`).toBe(true);
      }
    }
  });

  it('works for Malaysian and Indian numbers too', () => {
    expect(phoneMatches('+60 12-345 6789', '0123456789')).toBe(true);
    expect(phoneMatches('+91 98765 43210', '09876543210')).toBe(true);
  });

  it('does not match a different number', () => {
    expect(phoneMatches('+94 77 123 4567', '0777654321')).toBe(false);
    expect(phoneMatches(null, '0771234567')).toBe(false);
  });

  it('ignores a term too short to be a number', () => {
    expect(phoneNeedle('12')).toBeNull();
    expect(phoneNeedle('Perera')).toBeNull();
    expect(phoneMatches('+94 77 123 4567', '45')).toBe(false);
  });

  it('keeps the part of the number that survives every format', () => {
    expect(phoneNeedle('+94 77 123 4567')).toBe('771234567');
    expect(phoneNeedle('0771234567')).toBe('771234567');
  });
});
