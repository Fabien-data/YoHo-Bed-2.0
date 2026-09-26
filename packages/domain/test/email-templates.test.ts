import { describe, expect, it } from 'vitest';
import {
  EMAIL_TEMPLATES,
  emailTemplateSpec,
  isCustomCheckoutKey,
  renderTemplate,
  sampleVariables,
  unknownVariables,
} from '../src';

describe('email template catalogue', () => {
  it('names every guest email the API sends, each variable once', () => {
    expect(EMAIL_TEMPLATES.map((t) => t.key)).toEqual([
      'booking_created',
      'booking_voucher',
      'checkout_thank_you',
      'review_invite',
    ]);
    for (const t of EMAIL_TEMPLATES) {
      const names = t.variables.map((v) => v.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('reads a hotel’s own check-out email as the thank-you', () => {
    expect(isCustomCheckoutKey('checkout_custom_3fa9c2d1')).toBe(true);
    expect(isCustomCheckoutKey('checkout_thank_you')).toBe(false);
    expect(isCustomCheckoutKey('checkout_custom_Bad Key')).toBe(false);
    expect(emailTemplateSpec('checkout_custom_3fa9c2d1')?.key).toBe('checkout_thank_you');
  });

  it('previews with sample values for exactly the variables the email has', () => {
    const vars = sampleVariables('review_invite');
    expect(Object.keys(vars)).toContain('link');
    expect(renderTemplate('Dear {{guestName}}, {{link}}', vars)).toBe(
      'Dear Nimal Perera, https://yova.markui.lk/review/…',
    );
  });

  it('flags a variable the email is not sent with, since it would come out empty', () => {
    expect(
      unknownVariables('checkout_thank_you', 'Hi {{guestName}}, you owe {{balance}} {{ balance }}'),
    ).toEqual(['balance']);
    expect(unknownVariables('booking_created', 'Total: {{total}} ({{amount}})')).toEqual([]);
  });
});
