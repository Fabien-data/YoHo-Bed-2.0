import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { notifications, messages, templates, languages } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../email/mailer.service';
import type { UpdateTemplateDto } from './dto';

/**
 * Communications (Compartment E): in-app notifications, the outbound message log, message
 * templates, and the language lookup. Notifications + confirmation messages are *produced* by
 * BookingService at booking time; this service is the read/manage surface.
 */
@Injectable()
export class CommsService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly mailer: MailerService,
  ) {}

  // --- Notifications ---------------------------------------------------------
  listNotifications(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(50),
    );
  }

  async unreadCount(tenantId: string) {
    const [row] = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(eq(notifications.read, false)),
    );
    return { count: row?.count ?? 0 };
  }

  markRead(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const res = await tx
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.id, id))
        .returning({ id: notifications.id });
      if (!res.length) throw new NotFoundException('Notification not found');
      return { read: true };
    });
  }

  markAllRead(tenantId: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const res = await tx
        .update(notifications)
        .set({ read: true })
        .where(eq(notifications.read, false))
        .returning({ id: notifications.id });
      return { updated: res.length };
    });
  }

  // --- Messages (outbound log) ----------------------------------------------
  listMessages(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(messages).orderBy(desc(messages.createdAt)).limit(100),
    );
  }

  /**
   * Re-queue a failed message and run a delivery pass. The recovery path the Comms screen and
   * the ops runbook both describe — a failed message must never be a dead end.
   */
  async retryMessage(tenantId: string, id: string) {
    await this.dbs.withTenant(tenantId, async (tx) => {
      const [m] = await tx.select().from(messages).where(eq(messages.id, id));
      if (!m) throw new NotFoundException('Message not found');
      if (m.status === 'sent') throw new BadRequestException('That message was already sent');
      await tx.update(messages).set({ status: 'queued', error: null }).where(eq(messages.id, id));
    });
    return this.mailer.deliverQueued(tenantId);
  }

  // --- Templates -------------------------------------------------------------
  listTemplates(tenantId: string) {
    return this.dbs.withTenant(tenantId, (tx) =>
      tx.select().from(templates).orderBy(templates.key, templates.language),
    );
  }

  updateTemplate(tenantId: string, id: string, dto: UpdateTemplateDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .update(templates)
        .set({ subject: dto.subject, body: dto.body, updatedAt: new Date() })
        .where(eq(templates.id, id))
        .returning();
      if (!row) throw new NotFoundException('Template not found');
      return row;
    });
  }

  // --- Languages (global lookup) --------------------------------------------
  listLanguages() {
    return this.dbs.db.select().from(languages).orderBy(desc(languages.isDefault), languages.name);
  }
}
