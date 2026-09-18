import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  date,
  timestamp,
  unique,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { tenants, properties, users } from './identity';
import { roomUnits } from './inventory';
import { bookings } from './bookings';

/**
 * The housekeeping cycle every hotel runs on: a departed room is `dirty`, the attendant makes it
 * `clean`, a supervisor may `inspected` it before it is sold again. `out_of_order` is the
 * housekeeping-side flag for a room that cannot be sold at all.
 *
 * The type is named `housekeeping_state`, not `housekeeping_status`: Postgres gives every table
 * an implicit composite type of the same name, so an enum sharing the table's name cannot be
 * created alongside it.
 *
 * `out_of_order` overlaps in spirit with a `maintenance_blocks` row, and the two are deliberately
 * separate: a block reserves DATES (it is what stops the room being assigned next week), whereas
 * this is the state of the room TODAY. A supervisor marking a room out of order at 9am should not
 * silently cancel next month's reservations.
 */
export const housekeepingStatusEnum = pgEnum('housekeeping_state', [
  'dirty',
  'clean',
  'inspected',
  'out_of_order',
]);

/**
 * One row per room per day — the House Status grid, and the audit of who cleaned what.
 *
 * Keyed by date rather than holding a single "current status" column so that history survives:
 * "who cleaned 05 on the 12th, and when" is a question housekeeping supervisors actually ask, and
 * night audit will need the same rows to roll the business date forward.
 *
 * A missing row means `clean` — a room nobody has touched is not dirty. Rows are created lazily,
 * so a 200-room hotel does not accrue 73,000 rows a year for rooms that were never occupied.
 */
export const housekeepingStatus = pgTable(
  'housekeeping_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    roomUnitId: uuid('room_unit_id')
      .notNull()
      .references(() => roomUnits.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    status: housekeepingStatusEnum('status').notNull().default('clean'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    remarks: text('remarks'),
    /** Stamped when the status last moved, for "cleaned at 11:04" on the grid. */
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    changedByUserId: uuid('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roomDateUnique: unique('housekeeping_status_room_date_uq').on(t.roomUnitId, t.date),
    propertyDateIdx: index('housekeeping_status_property_date_idx').on(t.propertyId, t.date),
  }),
);

export const workOrderPriority = pgEnum('work_order_priority', ['low', 'medium', 'high', 'urgent']);
export const workOrderStatus = pgEnum('work_order_status', [
  'open',
  'in_progress',
  'done',
  'cancelled',
]);

/**
 * A maintenance job — Yanolja's Work Order / Task module.
 *
 * `roomUnitId` is nullable on purpose: plenty of work orders are about the lobby, the pool or the
 * lift, and forcing them onto a room would make the room's history lie.
 */
export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    roomUnitId: uuid('room_unit_id').references(() => roomUnits.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    priority: workOrderPriority('priority').notNull().default('medium'),
    status: workOrderStatus('status').notNull().default('open'),
    assignedToUserId: uuid('assigned_to_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    deadline: date('deadline'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * The reservation a task was raised from ("Create Task" on a room line): an airport pick-up,
     * a cot in the room, flowers on arrival. Null for a task about the building.
     */
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    /** Who does it. */
    department: text('department').notNull().default('maintenance'),
    /**
     * When it becomes due: straight away, when the guest checks in, or when they check out. A task
     * waiting for its trigger is not on anyone's list yet. Only a task with a booking can wait;
     * the API enforces that (a CHECK would make deleting the booking fail, since the link is SET
     * NULL).
     */
    trigger: text('trigger').notNull().default('instant'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    propertyStatusIdx: index('work_orders_property_status_idx').on(t.propertyId, t.status),
    bookingIdx: index('work_orders_booking_idx').on(t.bookingId),
    departmentValid: check(
      'work_orders_department_valid',
      sql`${t.department} in ('housekeeping', 'maintenance', 'front_desk', 'food_beverage', 'transport', 'other')`,
    ),
    triggerValid: check(
      'work_orders_trigger_valid',
      sql`${t.trigger} in ('instant', 'checkin', 'checkout')`,
    ),
  }),
);
