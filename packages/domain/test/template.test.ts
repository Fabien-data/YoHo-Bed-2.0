import { describe, it, expect } from 'vitest';
import { renderTemplate } from '../src/index';

describe('renderTemplate', () => {
  it('replaces {{placeholders}} with their values', () => {
    expect(renderTemplate('Hi {{guestName}}, booking {{reference}}', { guestName: 'Alice', reference: 'ABC123' })).toBe(
      'Hi Alice, booking ABC123',
    );
  });

  it('tolerates whitespace inside the braces and coerces numbers', () => {
    expect(renderTemplate('{{ nights }} nights, Rs {{amount}}', { nights: 3, amount: 26881.25 })).toBe(
      '3 nights, Rs 26881.25',
    );
  });

  it('renders unknown placeholders as empty', () => {
    expect(renderTemplate('start{{missing}}end', {})).toBe('startend');
  });
});
