import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';
import { rooms } from './inventory';

/**
 * Owner profile & media (Compartment H).
 *  - payout_accounts: where settlement money goes (legacy owner bank details). One per tenant.
 *  - media: uploaded property/room photos. Binary lives on the storage adapter (local disk for
 *    now, S3-compatible later); this table is the source of truth for what exists and its order.
 */

export const payoutAccounts = pgTable(
  'payout_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bankName: text('bank_name').notNull(),
    branchName: text('branch_name'),
    accountName: text('account_name').notNull(),
    accountNumber: text('account_number').notNull(),
    swiftCode: text('swift_code'),
    currency: text('currency').notNull().default('LKR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ onePerTenant: unique('payout_accounts_tenant_uq').on(t.tenantId) }),
);

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  propertyId: uuid('property_id').references(() => properties.id, { onDelete: 'cascade' }),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
  /** Stored object key (random name + extension); never the user-supplied filename. */
  storageKey: text('storage_key').notNull().unique(),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
