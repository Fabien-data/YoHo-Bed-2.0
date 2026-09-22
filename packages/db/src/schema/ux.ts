import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './identity';

/**
 * UX measurement (UX Excellence Program, UX-0). How long the core front-desk tasks take and how
 * many clicks they cost, measured in the product rather than guessed — the scoreboard behind
 * docs/UX-STANDARD.md.
 *
 * NO GUEST DATA, EVER: a row names a task, never a booking, guest, room or amount. Like
 * `audit_log`, these tables are written by every tenant's actions and read only through the staff
 * console, so they carry no RLS (see rls.sql) and every read filters by tenant explicitly.
 */
export const uxEvents = pgTable(
  'ux_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** The caller's role in the tenant when it happened — tasks differ by role. */
    role: text('role'),
    /** task | client_error | survey_shown | survey_dismissed */
    kind: text('kind').notNull(),
    /** A fixed key from the web app's task catalogue, e.g. `reservation.quick`. */
    task: text('task'),
    /** completed | abandoned (tasks only). */
    outcome: text('outcome'),
    durationMs: integer('duration_ms'),
    clicks: smallint('clicks'),
    /** Distinct fields typed into. */
    fields: smallint('fields'),
    /** The route pattern, never a URL with ids or query values. */
    route: text('route'),
    appVersion: text('app_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCreated: index('ux_events_tenant_created_idx').on(t.tenantId, t.createdAt),
    kindTaskCreated: index('ux_events_kind_task_created_idx').on(t.kind, t.task, t.createdAt),
  }),
);

/**
 * The in-app pulse survey. The items are the Cloudbeds/NYU report's own statements, so our scores
 * sit directly beside the 500-employee industry baseline. Answers are 1 (strongly disagree) to
 * 5 (strongly agree), keyed by item.
 */
export const uxSurveyResponses = pgTable(
  'ux_survey_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    role: text('role'),
    answers: jsonb('answers').$type<Record<string, number>>().notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreated: index('ux_survey_user_created_idx').on(t.userId, t.createdAt),
  }),
);

/**
 * One row per background process, rewritten on every beat. `/health` reads it to tell a live
 * worker from a crash-looping one — PM2 reporting "online" is not the same as doing the work.
 * Global (no tenant), like `plans`.
 */
export const systemHeartbeats = pgTable('system_heartbeats', {
  name: text('name').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true }).notNull().defaultNow(),
  /** Whatever the process wants /health to know, e.g. outbox backlog. */
  info: jsonb('info').$type<Record<string, unknown>>(),
});
