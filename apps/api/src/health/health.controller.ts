import { Controller, Get, HttpException, HttpStatus, Query } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { systemHeartbeats, type OutboxHealth } from '@yohobed/db';
import { DatabaseService } from '../database/database.service';

/** A worker that hasn't beaten for this long is presumed dead (it beats every 30 s). */
const WORKER_STALE_SECONDS = 120;
/** A pending push older than this means the channel pipeline is stuck. */
const OUTBOX_STUCK_SECONDS = 600;

type Check = 'ok' | 'degraded' | 'down';

/**
 * Health (UX-0). It used to answer "ok" whatever state the system was in, so nothing noticed a
 * dead database or a crash-looping worker. Now it actually looks:
 *
 * - `GET /health` answers 200 whenever the API can reach its database, so `deploy.sh` and nginx
 *   keep their simple liveness check; the body says what is degraded.
 * - `GET /health?strict=1` answers 503 on anything degraded, for an external uptime monitor that
 *   only watches status codes.
 *
 * Public by design, so it reports states and counts only — never tenant data.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly dbs: DatabaseService) {}

  @Get()
  async check(@Query('strict') strict?: string) {
    const checks: Record<string, Check> = { database: 'down', worker: 'down', outbox: 'ok' };
    let outbox: OutboxHealth | null = null;
    let workerSeenSecondsAgo: number | null = null;

    try {
      await this.dbs.db.execute(sql`select 1`);
      checks.database = 'ok';

      const [row] = await this.dbs.db
        .select()
        .from(systemHeartbeats)
        .where(eq(systemHeartbeats.name, 'worker'));
      if (row) {
        workerSeenSecondsAgo = Math.round((Date.now() - row.beatAt.getTime()) / 1000);
        checks.worker = workerSeenSecondsAgo <= WORKER_STALE_SECONDS ? 'ok' : 'degraded';
        outbox = (row.info?.outbox as OutboxHealth | undefined) ?? null;
        if (outbox && (outbox.failed > 0 || outbox.oldestPendingSeconds > OUTBOX_STUCK_SECONDS)) {
          checks.outbox = 'degraded';
        }
      }
    } catch {
      checks.database = 'down';
    }

    const values = Object.values(checks);
    const status: Check = values.includes('down')
      ? checks.database === 'down'
        ? 'down'
        : 'degraded'
      : values.includes('degraded')
        ? 'degraded'
        : 'ok';
    const body = {
      status,
      service: 'yohobed-api',
      time: new Date().toISOString(),
      checks,
      workerSeenSecondsAgo,
      outbox,
    };

    // Without a database the API can do nothing useful: fail even the lenient check.
    if (checks.database === 'down') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    if (strict && status !== 'ok') throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
