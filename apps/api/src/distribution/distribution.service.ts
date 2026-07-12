import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { outbox, enqueueOutbox } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class DistributionService {
  constructor(private readonly dbs: DatabaseService) {}

  /** Channel-sync health for a tenant: status counts + the most recent events. */
  async health(tenantId: string) {
    const grouped = await this.dbs.db
      .select({ status: outbox.status, n: sql<number>`count(*)::int` })
      .from(outbox)
      .where(eq(outbox.tenantId, tenantId))
      .groupBy(outbox.status);

    const counts: Record<string, number> = { pending: 0, processing: 0, sent: 0, failed: 0 };
    for (const g of grouped) counts[g.status] = g.n;

    const recent = await this.dbs.db
      .select({
        id: outbox.id,
        aggregate: outbox.aggregate,
        aggregateId: outbox.aggregateId,
        eventType: outbox.eventType,
        status: outbox.status,
        attempts: outbox.attempts,
        lastError: outbox.lastError,
        updatedAt: outbox.updatedAt,
      })
      .from(outbox)
      .where(eq(outbox.tenantId, tenantId))
      .orderBy(desc(outbox.createdAt))
      .limit(20);

    return { counts, recent };
  }

  /**
   * Enqueue a deliberately-failing push, so the retry → dead-letter → alert path (the BUG #3 fix)
   * can be demonstrated end-to-end without a live OTA outage.
   */
  async triggerTestFailure(tenantId: string) {
    await this.dbs.withTenant(tenantId, (tx) =>
      enqueueOutbox(tx, {
        tenantId,
        aggregate: 'test',
        aggregateId: 'demo',
        eventType: 'ari.test',
        payload: { __fail: true, __failReason: 'forced demo failure' },
      }),
    );
    return { enqueued: true };
  }
}
