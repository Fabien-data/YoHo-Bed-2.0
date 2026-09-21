import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  unique,
  jsonb,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './identity';
import { bookings } from './bookings';

/**
 * Communications (Compartment E) — the legacy messaging/notifications/templates/i18n surface.
 *
 * - `languages`: the supported UI/message languages (global lookup).
 * - `templates`: per-tenant, per-language message templates with `{{placeholder}}` variables,
 *   rendered by `renderTemplate` in @yohobed/domain.
 * - `notifications`: in-app notifications for a tenant's users (new booking, approvals, …).
 * - `messages`: the outbound comms log (email/SMS confirmations), rendered from a template.
 */

export const messageChannel = pgEnum('message_channel', ['email', 'sms']);
// 'sending' is the delivery claim: concurrent deliverers atomically flip queued → sending, so two
// overlapping bursts can never send the same confirmation twice.
export const messageStatus = pgEnum('message_status', ['queued', 'sending', 'sent', 'failed']);

/** Global language lookup (e.g. en, si, ta). Not tenant-scoped. */
export const languages = pgTable('languages', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
});

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Event key, e.g. 'booking_created', 'booking_approved'. */
    key: text('key').notNull(),
    language: text('language').notNull().default('en'),
    channel: messageChannel('channel').notNull().default('email'),
    subject: text('subject').notNull(),
    /** Body with `{{guestName}}` / `{{reference}}` / … placeholders. */
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyLangUnique: unique('templates_tenant_key_lang_uq').on(t.tenantId, t.key, t.language),
  }),
);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  /** Null = for any of the tenant's users. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  entity: text('entity'),
  entityId: uuid('entity_id'),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  channel: messageChannel('channel').notNull().default('email'),
  toAddress: text('to_address'),
  templateKey: text('template_key').notNull(),
  language: text('language').notNull().default('en'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  /** Frozen PDF bytes so a retried email sends the document the operator previewed. */
  attachments: jsonb('attachments').$type<Array<{ filename: string; content: string }>>(),
  status: messageStatus('status').notNull().default('queued'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  /** Provider error on the last delivery attempt (Compartment H real sending). */
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
