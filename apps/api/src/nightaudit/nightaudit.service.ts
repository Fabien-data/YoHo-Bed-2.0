import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import {
  bookingApprovals,
  bookingDays,
  bookings,
  businessDates,
  cashDrawers,
  customers,
  drawerSessions,
  enqueueOutbox,
  noShowReleaseFrom,
  releaseBookingInventory,
  sweepReservationLifecycle,
  folioCharges,
  folios,
  nightAuditRuns,
  properties,
  users,
  type Tx,
} from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { CashieringService } from '../cashiering/cashiering.service';
import { postInclusionsForNight } from '../folio/inclusions';
import { postLeviesForNight } from '../folio/levies';
import { localToday } from '../common/local-date';

const money = (n: number) => n.toFixed(2);

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class NightAuditService {
  constructor(private readonly dbs: DatabaseService) {}

  /** The property's current business date, seeded to today the first time it is asked for. */
  businessDate(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) => this.ensureBusinessDate(tx, tenantId, propertyId));
  }

  private async ensureBusinessDate(tx: Tx, tenantId: string, propertyId: string) {
    const [existing] = await tx
      .select()
      .from(businessDates)
      .where(eq(businessDates.propertyId, propertyId));
    if (existing) return existing;

    const [property] = await tx.select().from(properties).where(eq(properties.id, propertyId));
    if (!property) throw new NotFoundException('Property not found');

    // Seed in the property's OWN timezone — this column exists precisely so nothing keys off the
    // wall clock. UTC "today" is yesterday for a UTC+5:30 hotel until 05:30 local, and a business
    // date born a day behind re-posts room charges the desk already billed.
    const [created] = await tx
      .insert(businessDates)
      .values({ tenantId, propertyId, currentDate: localToday(property.timezone) })
      .onConflictDoNothing({ target: businessDates.propertyId })
      .returning();
    if (created) return created;

    const [raced] = await tx
      .select()
      .from(businessDates)
      .where(eq(businessDates.propertyId, propertyId));
    return raced!;
  }

  /**
   * What the audit *would* do, without doing it.
   *
   * A night auditor should be able to see the damage before committing to it — this is the one
   * action in the product that cannot be undone by clicking something else.
   */
  preview(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const bd = await this.ensureBusinessDate(tx, tenantId, propertyId);
      return this.plan(tx, propertyId, bd.currentDate);
    });
  }

  /** The work the run will do on `date`, gathered once so preview and run cannot disagree. */
  private async plan(tx: Tx, propertyId: string, date: string) {
    // In-house stays owe a room charge for the night just ending.
    const dueCharges = await tx
      .select({
        bookingId: bookings.id,
        reference: bookings.reference,
        rooms: bookings.rooms,
        sellingPrice: bookingDays.sellingPrice,
        tax: bookingDays.tax,
      })
      .from(bookings)
      .innerJoin(
        bookingDays,
        and(eq(bookingDays.bookingId, bookings.id), eq(bookingDays.date, date)),
      )
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          sql`${bookings.status} in ('Approved', 'CheckedIn')`,
          lte(bookings.checkin, date),
          sql`${bookings.checkout} > ${date}`,
        ),
      );

    // Reservations due in on or before this date that never arrived. `<=`, not `=`: if an audit
    // was skipped, yesterday's unarrived booking is still Approved and would otherwise keep
    // accruing nightly room charges forever without ever being flagged.
    const noShows = await tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        checkin: bookings.checkin,
        guestName: customers.name,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          lte(bookings.checkin, date),
          eq(bookings.status, 'Approved'),
        ),
      );

    // Pre-checks (UX-1a): what the auditor should settle before the date moves. The run never
    // checks anyone out, so an in-house guest past their departure stays in house — flagged here.
    const overstays = await tx
      .select({
        id: bookings.id,
        reference: bookings.reference,
        checkout: bookings.checkout,
        guestName: customers.name,
      })
      .from(bookings)
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(
        and(
          eq(bookings.propertyId, propertyId),
          eq(bookings.status, 'CheckedIn'),
          lte(bookings.checkout, date),
        ),
      );
    const openTills = await tx
      .select({
        sessionId: drawerSessions.id,
        drawer: cashDrawers.name,
        openedBy: users.name,
        openedAt: drawerSessions.openedAt,
      })
      .from(drawerSessions)
      .innerJoin(cashDrawers, eq(cashDrawers.id, drawerSessions.drawerId))
      .leftJoin(users, eq(users.id, drawerSessions.openedByUserId))
      .where(and(eq(cashDrawers.propertyId, propertyId), eq(drawerSessions.status, 'open')));

    const charges = dueCharges.reduce((s, c) => s + Number(c.sellingPrice) * c.rooms, 0);
    const taxes = dueCharges.reduce((s, c) => s + Number(c.tax) * c.rooms, 0);

    return {
      date,
      nextDate: nextDay(date),
      roomsToCharge: dueCharges.length,
      chargesToPost: money(charges),
      taxesToPost: money(taxes),
      noShows: noShows.map((n) => n.reference),
      /** Due in and not arrived: each becomes a no-show unless the run is told to `keep` it. */
      unarrived: noShows,
      overstays,
      /** Tills still open: the run closes them as UNCOUNTED — count them first if you can. */
      openTills,
      dueCharges,
      noShowIds: noShows.map((n) => n.id),
    };
  }

  /**
   * Run the audit and roll the business date.
   *
   * Everything happens in one transaction: post the night's room charges, no-show what never
   * arrived, force-close any till still open, then move the date. A half-run audit — charges
   * posted but the date not moved — would double-post on the next attempt, so the all-or-nothing
   * matters more here than anywhere else in the system.
   */
  async run(
    tenantId: string,
    propertyId: string,
    userId: string | null,
    ip: string | null,
    keep: string[] = [],
  ) {
    const kept = new Set(keep);
    return this.dbs.withTenant(tenantId, async (tx) => {
      const bd = await this.ensureBusinessDate(tx, tenantId, propertyId);
      const date = bd.currentDate;

      // The date is the lock: an audit for a date already closed cannot run twice, because the
      // property is no longer on that date.
      const [already] = await tx
        .select({ id: nightAuditRuns.id })
        .from(nightAuditRuns)
        .where(and(eq(nightAuditRuns.propertyId, propertyId), eq(nightAuditRuns.fromDate, date)));
      if (already) {
        throw new ConflictException(`The audit for ${date} has already been run`);
      }

      // 0. Holds past their release time give their rooms back first, so a released hold is
      //    neither charged for tonight nor marked a no-show below (Development Phase 02).
      const swept = await sweepReservationLifecycle(tx, tenantId);

      const p = await this.plan(tx, propertyId, date);

      // 1. Post the night's room charges onto each stay's folio.
      //
      // The desk may already have billed this night by hand, and the unique index would refuse a
      // second one. It is NOT enough to insert and catch the violation: in Postgres an error
      // aborts the whole transaction, so every later statement — the no-shows, the drawer close,
      // the date roll — would fail even though the error was "handled". So the already-posted
      // nights are looked up first and skipped, and no violation is ever provoked.
      let posted = 0;
      let skipped = 0;
      for (const c of p.dueCharges) {
        const folio = await this.ensureFolio(tx, tenantId, propertyId, c.bookingId);

        // Across EVERY window of the booking, not just window 1 — a room charge transferred to
        // the company window is still posted, and the per-folio unique index cannot see it.
        const [existing] = await tx
          .select({ id: folioCharges.id })
          .from(folioCharges)
          .innerJoin(folios, eq(folios.id, folioCharges.folioId))
          .where(
            and(
              eq(folios.bookingId, c.bookingId),
              eq(folioCharges.source, 'room'),
              eq(folioCharges.bookingDate, date),
              isNull(folioCharges.voidedAt),
            ),
          );
        if (existing) {
          skipped += 1;
          continue;
        }

        const total = Number(c.sellingPrice) * c.rooms;
        const tax = Number(c.tax) * c.rooms;
        await tx.insert(folioCharges).values({
          tenantId,
          folioId: folio.id,
          source: 'room',
          description:
            c.rooms > 1 ? `Room charge — ${date} (${c.rooms} rooms)` : `Room charge — ${date}`,
          postedFor: date,
          bookingDate: date,
          quantity: money(c.rooms),
          unitPrice: c.sellingPrice,
          net: money(total - tax),
          tax: money(tax),
          total: money(total),
          postedByUserId: userId,
        });
        posted += 1;
      }

      // 1b. What the in-house guests' stays include — breakfast, a driver's room — for the night,
      //     routed to the window that pays for extras (Development Phase 02).
      const inclusions = await postInclusionsForNight(tx, tenantId, propertyId, date, userId);

      // 1c. Levies for the night — Malaysia's tourism tax on every foreign guest in house
      //     (Development Phase 02, Sprint 7). Only CheckedIn stays: a no-show is never charged.
      const levies = await postLeviesForNight(tx, tenantId, propertyId, date, userId);

      // 2. No-show anything that was due to arrive and did not. The night just charged stays
      //    held; the rest of the stay goes back on sale. An OTA booking also tells the channel.
      //    A booking the desk said to `keep` (a late arrival they still expect) is charged its
      //    night above but stays a reservation.
      const noShowIds = p.noShowIds.filter((id) => !kept.has(id));
      for (const id of noShowIds) {
        const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
        if (!b || b.status !== 'Approved') continue;
        await tx
          .update(bookings)
          .set({ status: 'NoShow', updatedAt: new Date() })
          .where(eq(bookings.id, id));
        const from = noShowReleaseFrom(b.checkin, b.checkout, date);
        if (from) await releaseBookingInventory(tx, b, { from, origin: 'no_show' });
        await tx.insert(bookingApprovals).values({
          tenantId,
          bookingId: id,
          action: 'no_show',
          reason: `night audit ${date}`,
          actorUserId: userId,
        });
        if (b.source === 'OTA') {
          await enqueueOutbox(tx, {
            tenantId,
            aggregate: 'booking',
            aggregateId: b.id,
            eventType: 'booking.no_show',
            payload: { propertyId: b.propertyId, bookingId: b.id, reference: b.reference },
          });
        }
      }

      // 3. Close any till left open — the date cannot roll under a live shift.
      const drawersClosed = await CashieringService.forceCloseOpenSessions(tx, propertyId, userId);

      // 4. Roll the business date.
      await tx
        .update(businessDates)
        .set({ currentDate: p.nextDate, updatedAt: new Date() })
        .where(eq(businessDates.propertyId, propertyId));

      try {
        const [run] = await tx
          .insert(nightAuditRuns)
          .values({
            tenantId,
            propertyId,
            fromDate: date,
            toDate: p.nextDate,
            roomsCharged: posted,
            chargesPosted: p.chargesToPost,
            taxesPosted: p.taxesToPost,
            noShows: noShowIds.length,
            drawersClosed,
            summary: {
              roomsDue: p.roomsToCharge,
              roomsPosted: posted,
              roomsSkipped: skipped,
              inclusionsPosted: inclusions.posted,
              inclusionsTotal: money(inclusions.total),
              leviesPosted: levies,
              noShowReferences: p.unarrived.filter((u) => !kept.has(u.id)).map((u) => u.reference),
              keptAsLateArrivals: p.unarrived.filter((u) => kept.has(u.id)).map((u) => u.reference),
              overstays: p.overstays.map((o) => o.reference),
              tillsClosedUncounted: drawersClosed,
              holdsReleased: swept.released.map((r) => r.reference),
              unconfirmedCancelled: swept.expired.map((r) => r.reference),
            },
            runByUserId: userId,
            runFromIp: ip,
          })
          .returning();
        return run;
      } catch (e) {
        // The unique index on (property_id, from_date) is the real lock — the SELECT above is
        // only a friendly fast path and two concurrent runs (a double-click) both pass it.
        if ((e as { code?: string })?.code === '23505') {
          throw new ConflictException(`The audit for ${date} has already been run`);
        }
        throw e;
      }
    });
  }

  /** The Night Audit Log. */
  history(tenantId: string, propertyId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: nightAuditRuns.id,
          fromDate: nightAuditRuns.fromDate,
          toDate: nightAuditRuns.toDate,
          roomsCharged: nightAuditRuns.roomsCharged,
          chargesPosted: nightAuditRuns.chargesPosted,
          taxesPosted: nightAuditRuns.taxesPosted,
          noShows: nightAuditRuns.noShows,
          drawersClosed: nightAuditRuns.drawersClosed,
          summary: nightAuditRuns.summary,
          runFromIp: nightAuditRuns.runFromIp,
          runBy: users.name,
          createdAt: nightAuditRuns.createdAt,
        })
        .from(nightAuditRuns)
        .leftJoin(users, eq(users.id, nightAuditRuns.runByUserId))
        .where(eq(nightAuditRuns.propertyId, propertyId))
        .orderBy(desc(nightAuditRuns.fromDate)),
    );
  }

  /**
   * Revenue posted over a period, straight off the folio lines.
   *
   * This is the number that has to agree with the payout statement. It reads `folio_charges`
   * rather than recomputing from rates, because the folio is what the guest was actually billed.
   */
  revenue(tenantId: string, propertyId: string, from: string, to: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          nights: sql<number>`count(*)::int`,
          net: sql<string>`coalesce(sum(${folioCharges.net}), 0)::text`,
          tax: sql<string>`coalesce(sum(${folioCharges.tax}), 0)::text`,
          total: sql<string>`coalesce(sum(${folioCharges.total}), 0)::text`,
        })
        .from(folioCharges)
        .innerJoin(folios, eq(folios.id, folioCharges.folioId))
        .where(
          and(
            eq(folios.propertyId, propertyId),
            eq(folioCharges.source, 'room'),
            isNull(folioCharges.voidedAt),
            sql`${folioCharges.postedFor} >= ${from}`,
            sql`${folioCharges.postedFor} <= ${to}`,
          ),
        );
      return { from, to, ...row };
    });
  }

  /** Get or create window 1 for a booking, so the audit always has somewhere to post. */
  private async ensureFolio(tx: Tx, tenantId: string, propertyId: string, bookingId: string) {
    const [existing] = await tx
      .select()
      .from(folios)
      .where(and(eq(folios.bookingId, bookingId), eq(folios.window, 1)));
    if (existing) return existing;

    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const [created] = await tx
      .insert(folios)
      .values({
        tenantId,
        propertyId,
        bookingId,
        window: 1,
        label: 'Guest',
        currency: booking!.currency,
        payerType: 'guest',
        payerCustomerId: booking!.customerId,
      })
      .onConflictDoNothing({ target: [folios.bookingId, folios.window] })
      .returning();
    if (created) return created;

    const [raced] = await tx
      .select()
      .from(folios)
      .where(and(eq(folios.bookingId, bookingId), eq(folios.window, 1)));
    return raced!;
  }
}
