import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, date, boolean, integer, timestamp, unique, index, jsonb, check } from 'drizzle-orm/pg-core';
import { tenants, properties, users } from './identity';
import { roomUnits } from './inventory';
import { bookings } from './bookings';

/** A room's location is optional; the UI supplies a corridor layout until it is placed. */
export const floorLayouts = pgTable('floor_layouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  floor: text('floor').notNull(),
  landmarks: jsonb('landmarks').$type<Array<{ id: string; kind: 'corridor' | 'lift' | 'stairs' | 'service'; x: number; y: number; label?: string }>>().notNull().default([]),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ propertyFloorUnique: unique('floor_layouts_property_floor_uq').on(t.propertyId, t.floor) }));

/** Stay-scoped operational signals. Safety is deliberately explicit and access-controlled. */
export const roomStaySignals = pgTable('room_stay_signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  doNotDisturb: boolean('do_not_disturb').notNull().default(false),
  requestedSafetyFlag: boolean('requested_safety_flag').notNull().default(false),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ bookingUnique: unique('room_stay_signals_booking_uq').on(t.bookingId) }));

/** One deduplicated housekeeping job per room, date and trigger. */
export const housekeepingTasks = pgTable('housekeeping_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  roomUnitId: uuid('room_unit_id').notNull().references(() => roomUnits.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('queued'),
  rush: boolean('rush').notNull().default(false),
  assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, { onDelete: 'set null' }),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  notes: text('notes'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  roomDateKindUnique: unique('housekeeping_tasks_room_date_kind_uq').on(t.roomUnitId, t.date, t.kind),
  propertyDateIdx: index('housekeeping_tasks_property_date_idx').on(t.propertyId, t.date),
  kindValid: check('housekeeping_tasks_kind_valid', sql`${t.kind} in ('departure', 'stayover', 'arrival_prep')`),
  statusValid: check('housekeeping_tasks_status_valid', sql`${t.status} in ('queued', 'in_progress', 'done', 'cancelled')`),
}));

/** Audited room changes; a planned move can be stopped before its effective date. */
export const roomMoves = pgTable('room_moves', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  legId: uuid('leg_id').notNull(),
  destinationLegId: uuid('destination_leg_id'),
  fromRoomUnitId: uuid('from_room_unit_id').notNull().references(() => roomUnits.id),
  toRoomUnitId: uuid('to_room_unit_id').notNull().references(() => roomUnits.id),
  effectiveDate: date('effective_date').notNull(),
  status: text('status').notNull().default('planned'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  stoppedAt: timestamp('stopped_at', { withTimezone: true }),
}, t => ({ statusValid: check('room_moves_status_valid', sql`${t.status} in ('planned', 'completed', 'stopped')`) }));
