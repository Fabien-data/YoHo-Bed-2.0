import { pgTable, uuid, integer, jsonb, timestamp, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SmartPropertyDocument } from '@yohobed/domain';
import { properties, tenants } from './identity';

/** Draft editing cannot change live prices; published policies use a separate snapshot. */
export const smartPropertyPolicies = pgTable(
  'smart_property_policies',
  {
    propertyId: uuid('property_id')
      .primaryKey()
      .references(() => properties.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    draft: jsonb('draft').$type<SmartPropertyDocument>().notNull(),
    draftVersion: integer('draft_version').notNull().default(1),
    published: jsonb('published').$type<SmartPropertyDocument>(),
    publishedVersion: integer('published_version'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    versionValid: check(
      'smart_policy_versions_valid',
      sql`${t.draftVersion} > 0 and (${t.publishedVersion} is null or ${t.publishedVersion} <= ${t.draftVersion})`,
    ),
  }),
);
