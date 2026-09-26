import { and, eq } from 'drizzle-orm';
import { templates } from './schema';
import type { Database } from './client';
import type { Tx } from './scope';

/**
 * Starter texts replaced by better ones (Configuration → Email templates, 2026-09-26): the
 * confirmation said "Rs" whatever the hotel's currency, and the confirmation and the review
 * invitation were signed "YoHoBed" instead of by the hotel. A tenant still on the old text word
 * for word gets the new one; a template the hotel has edited is never touched.
 */
const STARTER_UPGRADES: Array<{
  key: string;
  language: string;
  from: { subject: string; body: string };
}> = [
  {
    key: 'booking_created',
    language: 'en',
    from: {
      subject: 'Booking confirmed — {{reference}}',
      body:
        'Dear {{guestName}},\n\nYour booking {{reference}} is confirmed for {{checkin}} to ' +
        '{{checkout}} ({{nights}} nights).\nTotal: Rs {{amount}}.\n\nThank you for choosing us.\nYoHoBed',
    },
  },
  {
    key: 'review_invite',
    language: 'en',
    from: {
      subject: 'How was your stay at {{propertyName}}?',
      body:
        'Dear {{guestName}},\n\nThank you for staying at {{propertyName}} ({{checkin}} → {{checkout}}).\n' +
        'We would love to hear about your stay — it takes a minute:\n{{link}}\n\nYoHoBed',
    },
  },
];

/**
 * The message templates every tenant starts with.
 *
 * Single source of truth for BOTH the dev seed and self-serve registration — when these drifted
 * apart, registered owners silently sent no guest email at all (their tenant had no templates,
 * and the queue-from-template step just found nothing). Owners can edit these in Comms.
 */
export function defaultTemplates(tenantId: string): (typeof templates.$inferInsert)[] {
  return [
    {
      tenantId,
      key: 'booking_created',
      language: 'en',
      channel: 'email' as const,
      subject: 'Booking confirmed — {{reference}}',
      body:
        'Dear {{guestName}},\n\nYour booking {{reference}} at {{propertyName}} is confirmed for ' +
        '{{checkin}} to {{checkout}} ({{nights}} nights).\nTotal: {{total}}.\n\n' +
        'Thank you for choosing us.\n{{propertyName}}',
    },
    {
      tenantId,
      key: 'booking_approved',
      language: 'en',
      channel: 'email' as const,
      subject: 'Booking approved — {{reference}}',
      body:
        'Dear {{guestName}},\n\nGreat news — your booking {{reference}} ({{checkin}} → {{checkout}}) ' +
        'has been approved. We look forward to welcoming you.\n\nYoHoBed',
    },
    {
      tenantId,
      key: 'review_invite',
      language: 'en',
      channel: 'email' as const,
      subject: 'How was your stay at {{propertyName}}?',
      body:
        'Dear {{guestName}},\n\nThank you for staying at {{propertyName}} ({{checkin}} → {{checkout}}).\n' +
        'We would love to hear about your stay — it takes a minute:\n{{link}}\n\n{{propertyName}}',
    },
    {
      // The booking voucher (Development Phase 02, Sprint 6). Money arrives already formatted in the
      // booking's currency, so a USD booking never reads "Rs".
      tenantId,
      key: 'booking_voucher',
      language: 'en',
      channel: 'email' as const,
      subject: 'Your booking at {{propertyName}} — {{reference}}',
      body:
        'Dear {{guestName}},\n\nThank you for booking with {{propertyName}}. Your booking voucher:\n\n' +
        'Booking no.: {{reference}}\nArrival: {{checkin}} from {{checkinTime}}\n' +
        'Departure: {{checkout}} by {{checkoutTime}}\nNights: {{nights}}\n\nRooms:\n{{rooms}}\n\n' +
        'Total: {{total}}\nPaid: {{paid}}\nBalance due: {{balance}}\n\n{{linkLine}}' +
        '{{propertyName}}\n{{propertyAddress}}\n{{propertyContact}}',
    },
    {
      tenantId,
      key: 'checkout_thank_you',
      language: 'en',
      channel: 'email' as const,
      subject: 'Thank you for staying at {{propertyName}}',
      body:
        'Dear {{guestName}},\n\nThank you for staying with us ({{checkin}} → {{checkout}}). ' +
        'We hope you had a pleasant stay and look forward to welcoming you back.\n\n{{propertyName}}',
    },
    {
      tenantId,
      key: 'booking_created',
      language: 'si',
      channel: 'email' as const,
      subject: 'වෙන්කරවා ගැනීම තහවුරුයි — {{reference}}',
      body:
        'ආදරණීය {{guestName}},\n\nඔබගේ වෙන්කරවා ගැනීම {{reference}} {{checkin}} සිට {{checkout}} දක්වා ' +
        '({{nights}} රාත්‍රී) තහවුරු කර ඇත.\nමුළු මුදල: රු {{amount}}.\n\nස්තූතියි.\nYoHoBed',
    },
  ];
}

/**
 * Add the named starter templates a tenant does not have yet (in any form it has edited, the
 * tenant's version stays). Run on every migrate, so tenants created before a template existed get
 * it too.
 */
export async function ensureTemplates(
  tx: Tx | Database,
  tenantId: string,
  keys: readonly string[],
): Promise<void> {
  const wanted = defaultTemplates(tenantId).filter((t) => keys.includes(t.key));
  if (wanted.length === 0) return;
  await tx
    .insert(templates)
    .values(wanted)
    .onConflictDoNothing({ target: [templates.tenantId, templates.key, templates.language] });
}

/** Give a new tenant its starter templates. Idempotent — safe on re-registration/re-seed. */
export async function seedDefaultTemplates(tx: Tx | Database, tenantId: string): Promise<void> {
  await tx
    .insert(templates)
    .values(defaultTemplates(tenantId))
    .onConflictDoNothing({ target: [templates.tenantId, templates.key, templates.language] });
}

/** The starter text of a template, for "Reset to the starter text". */
export function starterTemplate(
  key: string,
  language = 'en',
): { subject: string; body: string } | undefined {
  const t = defaultTemplates('00000000-0000-0000-0000-000000000000').find(
    (d) => d.key === key && d.language === language,
  );
  return t ? { subject: t.subject, body: t.body } : undefined;
}

/** Move a tenant's untouched old starter texts to the current ones. Run on every migrate. */
export async function upgradeStarterTemplates(
  tx: Tx | Database,
  tenantId: string,
): Promise<number> {
  let upgraded = 0;
  for (const u of STARTER_UPGRADES) {
    const to = starterTemplate(u.key, u.language);
    if (!to) continue;
    const rows = await tx
      .update(templates)
      .set({ subject: to.subject, body: to.body, updatedAt: new Date() })
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.key, u.key),
          eq(templates.language, u.language),
          eq(templates.subject, u.from.subject),
          eq(templates.body, u.from.body),
        ),
      )
      .returning({ id: templates.id });
    upgraded += rows.length;
  }
  return upgraded;
}
