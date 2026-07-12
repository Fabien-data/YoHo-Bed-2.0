import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { tenants, bookings, auditLog } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { BookingService } from '../bookings/booking.service';
import type { AuthPrincipal } from '../auth/dto';

@Injectable()
export class StaffService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly bookingService: BookingService,
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
    const [t] = await this.dbs.db
      .update(tenants)
      .set({ status, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId))
      .returning();
    if (!t) throw new NotFoundException('Tenant not found');
    await this.audit(actor, tenantId, 'tenant.status', 'tenant', tenantId, { status });
    return t;
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
