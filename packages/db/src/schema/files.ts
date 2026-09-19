import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, index, check } from 'drizzle-orm/pg-core';
import { tenants, users } from './identity';

/**
 * Files only the hotel's own staff may see (Development Phase 02, Sprint 5): payment slips and ID
 * scans.
 *
 * Deliberately NOT the `media` table: media carries a public-read policy so property photos can be
 * served to anonymous browsers, which is exactly wrong for a passport scan. These rows are fenced by
 * RLS like every other tenant table, and the bytes are served only to a signed-in member of the
 * tenant, with `Cache-Control: no-store`, from a directory of their own (`PRIVATE_FILES_DIR`).
 */
export const privateFiles = pgTable(
  'private_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Server-generated random name on disk; never user input. */
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** What it is for, so a slip cannot be passed off as an ID scan. */
    purpose: text('purpose').notNull().default('other'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('private_files_tenant_idx').on(t.tenantId, t.createdAt),
    purposeValid: check(
      'private_files_purpose_valid',
      sql`${t.purpose} in ('payment_slip', 'id_document', 'other')`,
    ),
  }),
);
