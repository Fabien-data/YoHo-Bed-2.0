import {
  pgTable,
  uuid,
  text,
  jsonb,
  boolean,
  timestamp,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core';
import { tenants, properties, memberships } from './identity';

export const HOTEL_PERMISSIONS = [
  'reservation_read',
  'reservation_change',
  'check_in_out',
  'room_assignment',
  'financial_read',
  'price_change',
  'minimum_exception',
  'housekeeping',
  'setup',
] as const;
export type HotelPermission = (typeof HOTEL_PERMISSIONS)[number];

/** Legacy membership roles remain in force unless a hotel role is explicitly assigned. */
export const hotelRoles = pgTable(
  'hotel_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    permissions: jsonb('permissions').$type<HotelPermission[]>().notNull().default([]),
    isTemplate: boolean('is_template').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantNameUnique: unique('hotel_roles_tenant_name_uq').on(table.tenantId, table.name),
  }),
);

/** A role gives no property access until the hotel grants each property explicitly. */
export const hotelRoleProperties = pgTable(
  'hotel_role_properties',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => hotelRoles.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
  },
  (table) => ({ pk: primaryKey({ columns: [table.roleId, table.propertyId] }) }),
);

export const hotelRoleAssignments = pgTable('hotel_role_assignments', {
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  membershipId: uuid('membership_id')
    .primaryKey()
    .references(() => memberships.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').references(() => hotelRoles.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
