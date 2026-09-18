import { sql } from 'drizzle-orm';
import { documentSequences } from './schema';
import type { Tx } from './scope';

export type DocumentType = 'receipt' | 'invoice' | 'credit_note' | 'proforma';

/**
 * Take the next number of a property's document series, inside the caller's transaction.
 *
 * One statement: insert the series at 2 (handing out 1), or bump it and hand out the value it had.
 * The row lock the upsert takes serialises concurrent callers, and because the bump is part of the
 * caller's transaction, a rollback gives the number back — the series stays gap-free.
 */
export async function nextDocumentNumber(
  tx: Tx,
  args: { tenantId: string; propertyId: string; docType: DocumentType; period: string },
): Promise<number> {
  const [row] = await tx
    .insert(documentSequences)
    .values({
      tenantId: args.tenantId,
      propertyId: args.propertyId,
      docType: args.docType,
      period: args.period,
      nextValue: 2,
    })
    .onConflictDoUpdate({
      target: [documentSequences.propertyId, documentSequences.docType, documentSequences.period],
      set: { nextValue: sql`${documentSequences.nextValue} + 1`, updatedAt: new Date() },
    })
    .returning({ next: documentSequences.nextValue });
  return row!.next - 1;
}

/** A receipt number: `RC26-00042` — the series restarts each calendar year. */
export async function nextReceiptNo(
  tx: Tx,
  args: { tenantId: string; propertyId: string; date: string },
): Promise<string> {
  const year = args.date.slice(0, 4);
  const n = await nextDocumentNumber(tx, {
    tenantId: args.tenantId,
    propertyId: args.propertyId,
    docType: 'receipt',
    period: year,
  });
  return `RC${year.slice(2)}-${String(n).padStart(5, '0')}`;
}
