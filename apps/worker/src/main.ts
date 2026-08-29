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
import { fetchAndStoreRates, DEFAULT_FX_URL } from './fx';

// The API fails fast on a bad environment (Zod schema); the worker must not be the one process
// that boots happily onto dev-port fallbacks and then errors every 1.5s in a log nobody watches.
// In production the URLs must be explicit; anywhere else a used fallback is announced loudly.
if (process.env.NODE_ENV === 'production') {
  const missing = ['APP_DATABASE_URL', 'REDIS_URL'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[worker] FATAL: missing required env in production: ${missing.join(', ')}`);
    process.exit(1);
  }
} else {
  for (const k of ['APP_DATABASE_URL', 'REDIS_URL']) {
    if (!process.env[k]) console.warn(`[worker] WARNING: ${k} not set — using the dev fallback`);
  }
}

const DATABASE_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://yoho_app:yoho_app_pw@localhost:5433/yohobed';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6380';
const QUEUE = 'cm-push';
const FX_URL = process.env.FX_PROVIDER_URL ?? DEFAULT_FX_URL;
// How often to refresh FX rates. Append-only, so extra refreshes are cheap; default 6h keeps rates
// fresh through the day without hammering the free provider. Set FX_FETCH_INTERVAL_MS=0 to disable.
// A malformed value (e.g. "6h") must not silently disable FX — fall back to the default instead.
const FX_INTERVAL_MS = (() => {
  const raw = process.env.FX_FETCH_INTERVAL_MS;
  const n = Number(raw ?? 6 * 60 * 60 * 1000);
  if (Number.isFinite(n)) return n;
  console.warn(`[worker] WARNING: FX_FETCH_INTERVAL_MS="${raw}" is not a number — using 6h`);
  return 6 * 60 * 60 * 1000;
})();

const redisUrl = new URL(REDIS_URL);
// Let BullMQ own the Redis client (avoids two-copies-of-ioredis type clashes). maxRetriesPerRequest
// must be null for the blocking worker. Credentials, database index and TLS from the URL must all
// survive the translation — dropping them means connecting unauthenticated/plaintext the day Redis
// gets a password, and ioredis would retry NOAUTH forever without crashing.
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port) || 6379,
  ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  ...(redisUrl.pathname && redisUrl.pathname !== '/'
    ? { db: Number(redisUrl.pathname.slice(1)) || 0 }
    : {}),
  ...(redisUrl.protocol === 'rediss:' ? { tls: {} } : {}),
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

// An 'error' event with no listener crashes the process (EventEmitter semantics) — so a transient
// Redis blip would crash-loop the worker until PM2 gives up and leaves it stopped. Log and let the
// clients reconnect instead; the relay loop and at-least-once outbox make missed work safe.
queue.on('error', (err) => console.error(`[queue] redis error: ${err.message}`));

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

worker.on('error', (err) => console.error(`[cm-push] worker error: ${err.message}`));

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
      // jobId = outbox id gives idempotent enqueue while a job is queued/retrying — but BullMQ
      // silently ignores add() when a job with that id exists in ANY state, including `failed`.
      // A retained failed job would therefore make the documented dead-letter replay (re-set the
      // outbox row to `pending`) a permanent no-op. The outbox row itself is the durable
      // dead-letter record (status='failed' + last_error), so the Redis job can go.
      await queue.add('push', row, {
        jobId: row.id,
        attempts: row.maxAttempts,
        backoff: { type: 'exponential', delay: 400 },
        removeOnComplete: true,
        removeOnFail: true,
      });
    }
    if (rows.length) console.log(`[relay] enqueued ${rows.length} event(s)`);
  } catch (e) {
    console.error('[relay] error', e);
  }
}

const relayTimer = setInterval(relay, 1500);
void relay();

// FX rate refresh: fetch once at startup, then on an interval. Errors are logged, never fatal.
let fxTimer: NodeJS.Timeout | undefined;
if (FX_INTERVAL_MS > 0) {
  void fetchAndStoreRates(db, { url: FX_URL });
  fxTimer = setInterval(() => void fetchAndStoreRates(db, { url: FX_URL }), FX_INTERVAL_MS);
}

console.log(
  `[worker] YoHoBed CM worker started — queue=${QUEUE} redis=${REDIS_URL} provider=${adapter.provider} ` +
    `fx=${FX_INTERVAL_MS > 0 ? `${FX_URL} every ${Math.round(FX_INTERVAL_MS / 3600000)}h` : 'disabled'}`,
);

// Guarded against re-entry: PM2 sends SIGINT and follows up before kill_timeout expires, and a
// second concurrent close() would race the first. A failed close still exits (non-zero) rather
// than hanging until PM2's SIGKILL, which would leave claimed rows in `processing` for the full
// stale-requeue window.
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayTimer);
  if (fxTimer) clearInterval(fxTimer);
  try {
    await worker.close();
    await queue.close();
    await close();
    process.exit(0);
  } catch (e) {
    console.error('[worker] shutdown error', e);
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
