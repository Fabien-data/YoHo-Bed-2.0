import { and, asc, eq, sql } from 'drizzle-orm';
import { bookings, folios, type Tx } from '@yohobed/db';

/**
 * Folio windows and who pays them (Development Phase 02, Sprint 5).
 *
 * Room charges always land on window 1; Bill To decides who window 1's payer is. Routing only moves
 * the other sources — extras, point-of-sale, inclusions — to the window that claims them, which is
 * how "room and tax to the company, extras to the guest" works without splitting a single night.
 */

/** `levy` (Sprint 7): a window may claim the tourism tax; unclaimed, it stays on window 1. */
export type RoutedSource = 'manual' | 'pos' | 'inclusion' | 'levy';

export interface WindowPayer {
  payerType: 'guest' | 'company' | 'travel_agent';
  payerCustomerId?: string | null;
  payerLedgerAccountId?: string | null;
  routes?: RoutedSource[];
}

/** Get or create a window; when it is created (or `payer` is given) it takes that payer. */
export async function ensureWindow(
  tx: Tx,
  tenantId: string,
  booking: { id: string; propertyId: string; currency: string },
  window: number,
  label: string,
  payer?: WindowPayer,
) {
  const [existing] = await tx
    .select()
    .from(folios)
    .where(and(eq(folios.bookingId, booking.id), eq(folios.window, window)));
  if (existing) {
    if (!payer) return existing;
    const [updated] = await tx
      .update(folios)
      .set({
        label,
        payerType: payer.payerType,
        payerCustomerId: payer.payerCustomerId ?? null,
        payerLedgerAccountId: payer.payerLedgerAccountId ?? null,
        routes: payer.routes ?? existing.routes,
        updatedAt: new Date(),
      })
      .where(eq(folios.id, existing.id))
      .returning();
    return updated!;
  }
  // Window 1 with no payer given bills the booking's guest.
  const guestId =
    !payer && window === 1
      ? ((
          await tx
            .select({ customerId: bookings.customerId })
            .from(bookings)
            .where(eq(bookings.id, booking.id))
        )[0]?.customerId ?? null)
      : null;
  const [created] = await tx
    .insert(folios)
    .values({
      tenantId,
      propertyId: booking.propertyId,
      bookingId: booking.id,
      window,
      label,
      currency: booking.currency,
      payerType: payer?.payerType ?? 'guest',
      payerCustomerId: payer?.payerCustomerId ?? guestId,
      payerLedgerAccountId: payer?.payerLedgerAccountId ?? null,
      routes: payer?.routes ?? [],
    })
    .onConflictDoNothing({ target: [folios.bookingId, folios.window] })
    .returning();
  if (created) return created;
  // Lost a race to create it; the other writer's row is the one to use.
  const [raced] = await tx
    .select()
    .from(folios)
    .where(and(eq(folios.bookingId, booking.id), eq(folios.window, window)));
  return raced!;
}

/**
 * The window a charge of `source` goes to: the lowest open window that routes it, else window 1.
 * A closed window never takes a new line.
 */
export async function routedWindow(
  tx: Tx,
  tenantId: string,
  booking: { id: string; propertyId: string; currency: string },
  source: RoutedSource,
) {
  const [routed] = await tx
    .select()
    .from(folios)
    .where(
      and(
        eq(folios.bookingId, booking.id),
        eq(folios.status, 'open'),
        sql`${source} = any(${folios.routes})`,
      ),
    )
    .orderBy(asc(folios.window))
    .limit(1);
  return routed ?? ensureWindow(tx, tenantId, booking, 1, 'Guest');
}
