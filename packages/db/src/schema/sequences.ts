import { pgTable, uuid, text, integer, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants, properties } from './identity';

/**
 * Gap-free document numbers per property (Development Phase 02): payment receipts now, tax invoices
 * and credit notes in Sprint 6.
 *
 * One row per (property, document type, period). A number is taken with a single
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the transaction that uses it, so two desks
 * never get the same number and a rolled-back reservation gives its number back — never
 * `count(*) + 1`, which two concurrent requests both compute alike.
 */
export const documentSequences = pgTable(
  'document_sequences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),
    /** receipt | invoice | credit_note | proforma */
    docType: text('doc_type').notNull(),
    /** The numbering period: a year (`2026`), a fiscal year (`26-27`), or `all`. */
    period: text('period').notNull(),
    /** The number the next document gets. */
    nextValue: integer('next_value').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    seqUnique: unique('document_sequences_property_type_period_uq').on(
      t.propertyId,
      t.docType,
      t.period,
    ),
  }),
);
