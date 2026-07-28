import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { tenants, bookings, properties, auditLog } from '@yohobed/db';
import type { BaseCurrencyCode } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { BookingService } from '../bookings/booking.service';
import { EmailService } from '../email/email.service';
import type { AuthPrincipal } from '../auth/dto';

@Injectable()
export class StaffService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly bookingService: BookingService,
    private readonly email: EmailService,
  ) {}

  /** Every tenant, with a count of bookings awaiting approval (staff overview). */
  async listTenants() {
    const rows = await this.dbs.db.select().from(tenants).orderBy(tenants.name);
    const out = [];
    for (const t of rows) {
      const [c] = await this.dbs.withTenant(t.id, (tx) =>
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(bookings)
          .where(eq(bookings.status, 'Pending')),
      );
      out.push({ id: t.id, name: t.name, email: t.email, status: t.status, pending: c?.n ?? 0 });
    }
    return out;
  }

  /** A tenant's bookings (staff can view any tenant). Reuses the owner-facing list under RLS. */
  tenantBookings(tenantId: string) {
    return this.bookingService.list(tenantId);
  }

  async approveBooking(actor: AuthPrincipal, tenantId: string, bookingId: string) {
    const booking = await this.bookingService.approve(tenantId, bookingId);
    await this.audit(actor, tenantId, 'booking.approve', 'booking', bookingId, {
      reference: booking?.reference,
    });
    return booking;
  }

  async rejectBooking(actor: AuthPrincipal, tenantId: string, bookingId: string, reason?: string) {
    const booking = await this.bookingService.reject(tenantId, bookingId, reason);
    await this.audit(actor, tenantId, 'booking.reject', 'booking', bookingId, { reason });
    return booking;
  }

  async setTenantStatus(
    actor: AuthPrincipal,
    tenantId: string,
    status: 'active' | 'inactive' | 'suspended',
  ) {
    const [before] = await this.dbs.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!before) throw new NotFoundException('Tenant not found');
    const [t] = await this.dbs.db
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    await this.audit(actor, tenantId, 'tenant.status', 'tenant', tenantId, {
      status,
      previous: before.status,
    });

    // Approving a self-registered owner (pending → active) sends the welcome email.
    if (before.status === 'pending' && status === 'active') {
      void this.email.send({
        to: t!.email,
        subject: 'Your YoHoBed account is approved 🎉',
        text:
          `Great news — "${t!.name}" has been approved on YoHoBed.\n\n` +
          `Your property can now take bookings. Sign in to finish your setup:\n` +
          `${this.email.webUrl}\n\n— The YoHoBed team`,
      });
    }
    return t;
  }

  /** A tenant's properties with their base currency — the staff view behind the currency control. */
  listTenantProperties(tenantId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: properties.id,
          name: properties.name,
          currency: properties.currency,
          bookings: sql<number>`count(${bookings.id})::int`,
        })
        .from(properties)
        .leftJoin(bookings, eq(bookings.propertyId, properties.id))
        .groupBy(properties.id)
        .orderBy(properties.name);
      // `locked` is the same rule the mutation enforces, surfaced so the UI can disable the control
      // instead of offering an action that will 409.
      return rows.map((r) => ({ ...r, locked: r.bookings > 0 }));
    });
  }

  /**
   * Set a property's base currency. Staff-only (it decides settlement denomination and must match
   * the payee bank account), and refused once the property has bookings: those bookings carry a
   * snapshotted FX rate and amounts denominated in the old currency, so changing it would silently
   * reinterpret history rather than convert it. This is a data-integrity rule, not a permission
   * one — it binds staff too.
   */
  async setPropertyCurrency(
    actor: AuthPrincipal,
    tenantId: string,
    propertyId: string,
    currency: BaseCurrencyCode,
  ) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [prop] = await tx.select().from(properties).where(eq(properties.id, propertyId));
      if (!prop) throw new NotFoundException('Property not found');

      if (prop.currency === currency) return prop; // no-op, don't burn an audit row

      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(bookings)
        .where(eq(bookings.propertyId, propertyId));
      if ((used?.n ?? 0) > 0) {
        throw new ConflictException({
          error: 'currency_locked',
          message:
            `"${prop.name}" already has ${used!.n} booking(s) denominated in ${prop.currency}. ` +
            `Changing the base currency would reinterpret their amounts, not convert them.`,
        });
      }

      const [row] = await tx
        .update(properties)
        .set({ currency, updatedAt: new Date() })
        .where(eq(properties.id, propertyId))
        .returning();
      await this.audit(actor, tenantId, 'property.currency', 'property', propertyId, {
        currency,
        previous: prop.currency,
      });
      return row;
    });
  }

  recentAudit() {
    return this.dbs.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(50);
  }

  private async audit(
    actor: AuthPrincipal,
    tenantId: string | null,
    action: string,
    entity: string,
    entityId: string,
    detail: unknown,
  ) {
    await this.dbs.db.insert(auditLog).values({
      tenantId,
      actorUserId: actor.sub,
      actorEmail: actor.email,
      action,
      entity,
      entityId,
      detail: detail as never,
    });
  }
}
