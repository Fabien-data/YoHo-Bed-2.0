import { Queue, Worker, type Job } from 'bullmq';
import {
  createDb,
  claimPendingOutbox,
  requeueStaleOutbox,
  markOutboxSent,
  markOutboxRetry,
  markOutboxFailed,
  type OutboxRow,
} from '@yohobed/db';
import { resolveAdapter } from '@yohobed/cm-adapter';

const DATABASE_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://yoho_app:yoho_app_pw@localhost:5433/yohobed';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
const QUEUE = 'cm-push';

const redisUrl = new URL(REDIS_URL);
// Let BullMQ own the Redis client (avoids two-copies-of-ioredis type clashes). maxRetriesPerRequest
// must be null for the blocking worker.
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  maxRetriesPerRequest: null,
};
const { db, close } = createDb(DATABASE_URL);

/**
 * Which channel manager we actually talk to. `fake` (the default) is dev/demo only.
 * Set CM_PROVIDER=axisrooms + CM_URL_AXISROOMS to go live; the endpoint paths mirror the legacy
 * CM_AXISROOMS_*_ENDPOINT env vars. resolveAdapter throws rather than silently degrading to the
 * fake if axisrooms is selected without a URL — pretending to sync is worse than refusing to boot.
 */
const adapter = resolveAdapter(process.env.CM_PROVIDER ?? 'fake', {
  latencyMs: 40,
  axisrooms: {
    baseUrl: process.env.CM_URL_AXISROOMS ?? '',
    channelId: process.env.AXISROOMS_CHANNEL_ID,
    apiKey: process.env.CM_AXISROOMS_API_KEY,
    timeoutMs: Number(process.env.CM_TIMEOUT_MS ?? 15000),
    endpoints: {
      ...(process.env.CM_AXISROOMS_INVENTORY_ENDPOINT
        ? { inventory: process.env.CM_AXISROOMS_INVENTORY_ENDPOINT }
        : {}),
      ...(process.env.CM_AXISROOMS_RATE_ENDPOINT
        ? { rate: process.env.CM_AXISROOMS_RATE_ENDPOINT }
        : {}),
      ...(process.env.CM_AXISROOMS_NO_SHOW_ENDPOINT
        ? { noShow: process.env.CM_AXISROOMS_NO_SHOW_ENDPOINT }
        : {}),
      ...(process.env.CM_AXISROOMS_INVENTORY_BLOCK_ENDPOINT
        ? { inventoryBlock: process.env.CM_AXISROOMS_INVENTORY_BLOCK_ENDPOINT }
        : {}),
      ...(process.env.CM_AXISROOMS_INVENTORY_UNBLOCK_ENDPOINT
        ? { inventoryUnblock: process.env.CM_AXISROOMS_INVENTORY_UNBLOCK_ENDPOINT }
        : {}),
    },
  },
});

const queue = new Queue(QUEUE, { connection });

/**
 * Process one channel-manager push. On success the outbox row is marked `sent`; on failure we
 * record the attempt and re-throw so BullMQ retries with backoff. The final failure is handled in
 * the `failed` listener below (dead-letter + alert) — so a push can never fail silently.
 */
const worker = new Worker<OutboxRow>(
  QUEUE,
  async (job: Job<OutboxRow>) => {
    const row = job.data;
    const attempts = job.attemptsMade + 1;
    try {
      const result = await adapter.push({
        aggregate: row.aggregate,
        aggregateId: row.aggregateId,
        eventType: row.eventType,
        payload: row.payload,
      });
      await markOutboxSent(db, row.id, attempts);
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markOutboxRetry(db, row.id, attempts, msg);
      throw e;
    }
  },
  { connection, concurrency: 8 },
);

worker.on('completed', (job) => {
  console.log(
    `[cm-push] ✓ sent outbox=${job.data.id} (${job.data.aggregate}:${job.data.aggregateId})`,
  );
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  const attempts = job.attemptsMade;
  const max = job.opts.attempts ?? 1;
  if (attempts >= max) {
    await markOutboxFailed(db, job.data.id, attempts, err.message).catch(() => {});
    // The concrete replacement for the legacy silent failure: a dead letter + a loud alert.
    console.error(
      `[ALERT] CM push PERMANENTLY FAILED after ${attempts} attempts — outbox=${job.data.id} ` +
        `${job.data.aggregate}:${job.data.aggregateId} — ${err.message}`,
    );
  } else {
    console.warn(
      `[cm-push] attempt ${attempts}/${max} failed (outbox=${job.data.id}): ${err.message} — retrying`,
    );
  }
});

/** Relay: move committed outbox rows onto the queue (and rescue any stuck by a crashed worker). */
async function relay(): Promise<void> {
  try {
    await requeueStaleOutbox(db, 120);
    const rows = await claimPendingOutbox(db, 20);
    for (const row of rows) {
      await queue.add('push', row, {
        jobId: row.id,
        attempts: row.maxAttempts,
        backoff: { type: 'exponential', delay: 400 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    }
    if (rows.length) console.log(`[relay] enqueued ${rows.length} event(s)`);
  } catch (e) {
    console.error('[relay] error', e);
  }
}

const relayTimer = setInterval(relay, 1500);
void relay();

console.log(
  `[worker] YoHoBed CM worker started — queue=${QUEUE} redis=${REDIS_URL} provider=${adapter.provider}`,
);

async function shutdown(): Promise<void> {
  clearInterval(relayTimer);
  await worker.close();
  await queue.close();
  await close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
