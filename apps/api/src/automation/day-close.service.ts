import {
  ConflictException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, isNull, lt, or } from 'drizzle-orm';
import {
  bookings,
  businessDates,
  dayCloseDueProperties,
  localDateIn,
  properties,
} from '@yohobed/db';
import { nightAuditDueAt, resolvePropertySettings, wallClockIn } from '@yohobed/domain';
import type { Env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { BookingService } from '../bookings/booking.service';
import { NightAuditService } from '../nightaudit/nightaudit.service';
import { BillingService } from '../billing/billing.service';
import { MailerService } from '../email/mailer.service';

/** How many overdue stays one pass checks out per property; the rest wait for the next pass. */
const CHECKOUT_BATCH = 100;
/** How many missed days one pass closes per property, catching a lagging business date up. */
const MAX_AUDITS_PER_PASS = 7;
/**
 * A stay checked in less than this long ago is left alone even if its dates are past: that is the
 * desk recording a stay after the fact, which it checks out itself a moment later.
 */
const RECORDING_GRACE_MS = 10 * 60_000;
/** How long a tenant without night audit on its plan is skipped before being asked again. */
const NO_AUDIT_TTL_MS = 10 * 60_000;

export interface AutoCheckout {
  id: string;
  reference: string;
  /** What the guest still owes, with its currency — null when nothing. */
  owed: string | null;
}

export interface DayCloseResult {
  tenantId: string;
  propertyId: string;
  checkedOut: AutoCheckout[];
  /** The business dates closed, oldest first. */
  audits: string[];
  error?: string;
}

/**
 * The hotel's day closes by itself (owner brief, 2026-09-26: "the calendar reservations are not
 * properly getting updated … the status has not yet turned to checked out after the check-out
 * date").
 *
 * Two jobs, both property settings the owner can switch off (UX-STANDARD §1.2, "automate the
 * routine"):
 * - **Automatic check-out.** A stay still in house once its departure day is over is checked out
 *   — the desk's own check-out, recorded as the system's, so the room turns dirty and gets its
 *   departure clean. What the guest owes stays on the bill, and the desk is told.
 * - **Automatic night audit.** At the owner's chosen hotel time the day's audit runs, exactly as if
 *   the owner had pressed Run: room charges, no-shows, tills, the business date. A property that
 *   fell behind is caught up a few days per pass.
 *
 * It runs inside the API (one process under PM2) on a timer, because both jobs are the API's own
 * services; the worker cannot reach them. Every property works in its own tenant transaction, a
 * pass never overlaps the previous one, and the audit's unique date lock makes a double run
 * impossible even with a second API process.
 */
@Injectable()
export class DayCloseService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('DayClose');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly noNightAudit = new Map<string, number>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly dbs: DatabaseService,
    private readonly desk: BookingService,
    private readonly audit: NightAuditService,
    private readonly billing: BillingService,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap(): void {
    const every = this.config.get('DAY_CLOSE_INTERVAL_MS', { infer: true });
    if (!every) return;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref();
    // The first pass shortly after boot, once the deploy's health checks have had the process.
    setTimeout(() => void this.tick(), Math.min(every, 15_000)).unref();
    this.log.log(`Day close runs every ${Math.round(every / 1000)}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const results = await this.runDue();
      for (const r of results) {
        if (r.error) this.log.error(`Property ${r.propertyId}: ${r.error}`);
        else if (r.checkedOut.length || r.audits.length)
          this.log.log(
            `Property ${r.propertyId}: checked out ${r.checkedOut.length}, closed ${r.audits.join(', ') || 'no day'}`,
          );
      }
    } catch (e) {
      this.log.error(`Day close pass failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass over every property whose day needs closing. */
  async runDue(at: Date = new Date()): Promise<DayCloseResult[]> {
    // A property can be due for both reasons; it is closed once.
    const due = new Map<string, string>();
    for (const p of await dayCloseDueProperties(this.dbs.db, at)) due.set(p.propertyId, p.tenantId);
    const results: DayCloseResult[] = [];
    for (const [propertyId, tenantId] of due)
      results.push(await this.closeProperty(tenantId, propertyId, at));
    return results;
  }

  /** Close one property's day: first the overdue stays, then each night audit that is due. */
  async closeProperty(
    tenantId: string,
    propertyId: string,
    at: Date = new Date(),
  ): Promise<DayCloseResult> {
    const result: DayCloseResult = { tenantId, propertyId, checkedOut: [], audits: [] };
    try {
      result.checkedOut = await this.checkOutOverdue(tenantId, propertyId, at);
      result.audits = await this.runDueAudits(tenantId, propertyId, at);
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
  }

  /**
   * Check out every stay still in house after its departure day. Each in its own savepoint: one
   * that is refused stays in house, and the rest still go.
   */
  async checkOutOverdue(
    tenantId: string,
    propertyId: string,
    at: Date = new Date(),
  ): Promise<AutoCheckout[]> {
    const done = await this.dbs.withTenant(tenantId, async (tx) => {
      const [property] = await tx
        .select({ timezone: properties.timezone, settings: properties.settings })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!property || !resolvePropertySettings(property.settings).autoCheckout) return [];
      const today = localDateIn(property.timezone, at);
      const overdue = await tx
        .select({ id: bookings.id, reference: bookings.reference })
        .from(bookings)
        .where(
          and(
            eq(bookings.propertyId, propertyId),
            eq(bookings.status, 'CheckedIn'),
            lt(bookings.checkout, today),
            or(
              isNull(bookings.checkedInAt),
              lt(bookings.checkedInAt, new Date(at.getTime() - RECORDING_GRACE_MS)),
            ),
          ),
        )
        .orderBy(asc(bookings.checkout))
        .limit(CHECKOUT_BATCH);

      const out: AutoCheckout[] = [];
      for (const b of overdue) {
        try {
          const r = await tx.transaction((sp) => this.desk.autoCheckOutWithin(sp, tenantId, b.id));
          if (r) out.push(r);
        } catch (e) {
          this.log.warn(
            `Could not check out ${b.reference}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
      return out;
    });
    // After commit: the thank-you and review emails the check-outs queued.
    if (done.length) this.mailer.deliverQueuedSafe(tenantId);
    return done;
  }

  /**
   * Run the night audit for every business date whose closing time has passed, oldest first —
   * a property left behind for days catches up a few per pass. Only on a plan with night audit,
   * and only while the owner leaves the audit automatic.
   */
  async runDueAudits(tenantId: string, propertyId: string, at: Date = new Date()) {
    const skippedAt = this.noNightAudit.get(tenantId);
    if (skippedAt && at.getTime() - skippedAt < NO_AUDIT_TTL_MS) return [];
    if (!(await this.billing.has(tenantId, 'night_audit'))) {
      this.noNightAudit.set(tenantId, at.getTime());
      return [];
    }
    this.noNightAudit.delete(tenantId);

    const closed: string[] = [];
    for (let i = 0; i < MAX_AUDITS_PER_PASS; i += 1) {
      const date = await this.dateDueForAudit(tenantId, propertyId, at);
      if (!date) break;
      try {
        const run = await this.audit.run(tenantId, propertyId, null, null, [], {
          trigger: 'auto',
        });
        closed.push(run.fromDate);
      } catch (e) {
        // Someone ran it by hand a moment ago: the day is closed, which is all this wanted.
        if (e instanceof ConflictException) break;
        throw e;
      }
    }
    return closed;
  }

  /**
   * The business date whose automatic audit is due at `at`, or null. A property without a
   * business date yet has its first day opened today (as Run would), and closes it tomorrow.
   */
  private async dateDueForAudit(tenantId: string, propertyId: string, at: Date) {
    const bd = await this.audit.businessDate(tenantId, propertyId);
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [p] = await tx
        .select({ timezone: properties.timezone, settings: properties.settings })
        .from(properties)
        .where(eq(properties.id, propertyId));
      if (!p) return null;
      const s = resolvePropertySettings(p.settings);
      if (s.nightAudit.mode !== 'auto') return null;
      const [current] = await tx
        .select({ date: businessDates.currentDate })
        .from(businessDates)
        .where(eq(businessDates.propertyId, propertyId));
      const date = current?.date ?? bd.currentDate;
      return wallClockIn(p.timezone, at) >= nightAuditDueAt(date, s.nightAudit.time) ? date : null;
    });
  }
}
