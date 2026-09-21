import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import { messages } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';
import { EmailService } from './email.service';

/**
 * Delivers queued rows from the tenant's `messages` log through the email provider.
 * Called fire-and-forget AFTER the transaction that queued them commits — a provider outage
 * marks the message 'failed' (visible + retryable in the Comms screen) but never breaks the
 * business action that produced it.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);

  constructor(
    private readonly dbs: DatabaseService,
    private readonly email: EmailService,
  ) {}

  /** Send every queued message for a tenant. Returns counts for tests/ops. */
  async deliverQueued(tenantId: string): Promise<{ sent: number; failed: number }> {
    // CLAIM the rows (queued → sending) before touching the provider. Two booking actions in the
    // same tenant routinely overlap, and two plain SELECTs would both see the same queued rows —
    // the guest gets two identical confirmations. Rows stuck in 'sending' (a process died between
    // claim and result) are reclaimed after 15 minutes by the next delivery pass.
    const queued = await this.dbs.withTenant(tenantId, (tx) =>
      tx
        .update(messages)
        .set({ status: 'sending' })
        .where(
          and(
            eq(messages.channel, 'email'),
            or(
              eq(messages.status, 'queued'),
              and(
                eq(messages.status, 'sending'),
                lt(messages.createdAt, sql`now() - interval '15 minutes'`),
              ),
            ),
          ),
        )
        .returning(),
    );
    let sent = 0;
    let failed = 0;
    for (const m of queued) {
      let ok = false;
      let error: string | undefined;
      if (!m.toAddress) {
        error = 'no recipient email';
      } else {
        const res = await this.email.send({ to: m.toAddress, subject: m.subject, text: m.body, attachments: m.attachments ?? undefined });
        ok = res.ok;
        if (!res.ok) error = res.error;
      }
      await this.dbs.withTenant(tenantId, (tx) =>
        tx
          .update(messages)
          .set(
            ok
              ? { status: 'sent', sentAt: new Date() }
              : { status: 'failed', error: error ?? null },
          )
          .where(eq(messages.id, m.id)),
      );
      ok ? sent++ : failed++;
    }
    if (queued.length > 0) {
      this.log.log(
        `delivered tenant=${tenantId}: ${sent} sent, ${failed} failed (${this.email.providerName})`,
      );
    }
    return { sent, failed };
  }

  /** Fire-and-forget wrapper — never lets email delivery break the caller. */
  deliverQueuedSafe(tenantId: string): void {
    void this.deliverQueued(tenantId).catch((e) =>
      this.log.error(`delivery crashed tenant=${tenantId}: ${e instanceof Error ? e.message : e}`),
    );
  }
}
