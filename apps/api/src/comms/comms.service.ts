import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { notifications, messages, templates, languages, starterTemplate } from '@yohobed/db';
import { CUSTOM_CHECKOUT_PREFIX, isCustomCheckoutKey } from '@yohobed/domain';
import { DatabaseService } from '../database/database.service';
import { MailerService } from '../email/mailer.service';
import type { CreateTemplateDto, UpdateTemplateDto } from './dto';

/** Enough for a hotel's seasons and guest types, few enough to pick from at the desk. */
const MAX_CUSTOM_TEMPLATES = 20;

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
      const [current] = await tx.select().from(templates).where(eq(templates.id, id));
      if (!current) throw new NotFoundException('Template not found');
      if (dto.name !== undefined && !isCustomCheckoutKey(current.key))
        throw new BadRequestException('The starter emails keep their names');
      const [row] = await tx
        .update(templates)
        .set({
          subject: dto.subject,
          body: dto.body,
          ...(dto.name !== undefined && { name: dto.name }),
          updatedAt: new Date(),
        })
        .where(eq(templates.id, id))
        .returning();
      return row!;
    });
  }

  /**
   * Add a check-out email of the hotel's own — a VIP farewell, a corporate thank-you — which the
   * desk picks per reservation under "Send email at check-out".
   */
  createTemplate(tenantId: string, dto: CreateTemplateDto) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(templates)
        .where(sql`starts_with(${templates.key}, ${CUSTOM_CHECKOUT_PREFIX})`);
      if ((count?.n ?? 0) >= MAX_CUSTOM_TEMPLATES)
        throw new ConflictException(
          `You already have ${MAX_CUSTOM_TEMPLATES} check-out emails — delete one you no longer use first.`,
        );
      const [row] = await tx
        .insert(templates)
        .values({
          tenantId,
          key: `${CUSTOM_CHECKOUT_PREFIX}${randomBytes(4).toString('hex')}`,
          language: 'en',
          channel: 'email',
          name: dto.name,
          subject: dto.subject,
          body: dto.body,
        })
        .returning();
      return row!;
    });
  }

  /**
   * Delete a check-out email the hotel added. Reservations that chose it get the starter thank-you
   * instead; the starter emails themselves are never deleted, only reworded or reset.
   */
  deleteTemplate(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(templates).where(eq(templates.id, id));
      if (!row) throw new NotFoundException('Template not found');
      if (!isCustomCheckoutKey(row.key))
        throw new ConflictException({
          reason: 'starter_template',
          message: 'A starter email cannot be deleted — reset it to the starter text instead.',
        });
      await tx.delete(templates).where(and(eq(templates.id, id), eq(templates.key, row.key)));
      return { deleted: true, id };
    });
  }

  /** Put a starter email back to the text every hotel starts with. */
  resetTemplate(tenantId: string, id: string) {
    return this.dbs.withTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(templates).where(eq(templates.id, id));
      if (!row) throw new NotFoundException('Template not found');
      const starter = starterTemplate(row.key, row.language);
      if (!starter)
        throw new ConflictException({
          reason: 'no_starter_text',
          message: 'This email is your own, so there is no starter text to go back to.',
        });
      const [updated] = await tx
        .update(templates)
        .set({ subject: starter.subject, body: starter.body, updatedAt: new Date() })
        .where(eq(templates.id, id))
        .returning();
      return updated!;
    });
  }

  // --- Languages (global lookup) --------------------------------------------
  listLanguages() {
    return this.dbs.db.select().from(languages).orderBy(desc(languages.isDefault), languages.name);
  }
}
