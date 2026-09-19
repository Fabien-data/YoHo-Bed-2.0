import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E for the PMS shell.
 *
 * The Vitest suites cover the API and the domain; nothing covered the browser, which is exactly
 * where the riskiest upcoming code lives (the Stay View tape chart, the 7-tab ARI grid). This is
 * the harness those will land in.
 *
 * Both servers are started here rather than assumed: `next start` needs a built app, and the app
 * is useless without the API, so a bare `pnpm e2e` should bring up everything it needs. A
 * migrated, seeded database is the one prerequisite — see docs/OPERATIONS.md §3.
 */
const WEB_PORT = 3100;
/**
 * Must match the `NEXT_PUBLIC_API_URL` default baked into the bundle at build time — a
 * `NEXT_PUBLIC_*` value is inlined by `next build`, so setting it on the start command has no
 * effect. Running the API on its normal port is simpler than rebuilding the app per test run.
 */
const API_PORT = 3001;

const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ?? 'postgres://yoho_app:yoho_app_pw@127.0.0.1:5433/yohobed';

export default defineConfig({
  testDir: './e2e',
  // Serial: every spec drives the same seeded tenant, so parallel runs would fight over its data.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        APP_DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-jwt-key-32-characters!!',
        CM_WEBHOOK_SECRET: process.env.CM_WEBHOOK_SECRET ?? 'e2e-cm-webhook-secret-000001',
        EMAIL_PROVIDER: 'console',
        WEB_URL: `http://127.0.0.1:${WEB_PORT}`,
        MEDIA_DIR: './uploads-e2e',
        PRIVATE_FILES_DIR: './private-e2e',
        // The browser calls the API from the Playwright origin, which is not the dev default —
        // without this every request is blocked by CORS and only the logged-out tests pass.
        CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: `node node_modules/next/dist/bin/next start -p ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
