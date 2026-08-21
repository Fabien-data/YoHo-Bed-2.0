/**
 * Test-run environment. Set before any module loads so the app's env validation passes.
 * Points at the docker-compose Postgres; override via env in CI.
 */
export default async function setup() {
  process.env.APP_DATABASE_URL ??= 'postgres://yoho_app:yoho_app_pw@localhost:5433/yohobed';
  process.env.TEST_DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5433/yohobed';
  process.env.JWT_SECRET ??= 'test-secret-jwt-key-32-characters!!';
  process.env.CM_WEBHOOK_SECRET ??= 'test-cm-webhook-secret-000001';
  process.env.EMAIL_PROVIDER ??= 'console';
  process.env.WEB_URL ??= 'http://localhost:3000';
  process.env.MEDIA_DIR ??= './uploads-test';

  // Seed the plan catalogue ONCE for the whole run.
  //
  // Every fixture tenant needs a subscription, and a subscription needs a plan. Upserting the
  // catalogue per-tenant instead meant every suite hammering the same three global rows
  // concurrently — the suites run in parallel against one database, and the contention made
  // unrelated tests fail intermittently. `plans` is a global catalogue, so once is also correct.
  const { createDb, seedDefaultPlans } = await import('@yohobed/db');
  const handle = createDb(process.env.TEST_DATABASE_URL, { max: 1 });
  try {
    await seedDefaultPlans(handle.db);
  } finally {
    await handle.close();
  }
}
