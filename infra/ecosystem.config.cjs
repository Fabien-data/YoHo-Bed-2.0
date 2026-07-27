/**
 * PM2 process definitions for the YoHoBed 2.0 server.
 *
 * Installed at /srv/yohobed/ecosystem.config.cjs; paths resolve relative to this
 * file so the whole tree can be relocated without editing anything.
 *
 * Binaries are referenced through each app's own node_modules/.bin. pnpm does not
 * hoist to the workspace root, so there is no top-level node_modules/.bin/tsx and
 * `command -v tsx` finds nothing — which is exactly how the first deploy attempt
 * failed on 2026-07-27.
 *
 * Environment comes from /srv/yohobed/env/production.env, which deploy.sh sources
 * (set -a) before invoking pm2 with --update-env. It is deliberately not duplicated
 * here: the env file holds secrets and must stay the single source of truth.
 */
const path = require('path');

const APP = path.join(__dirname, 'app');

/** Shared settings — restart on crash, but give up on a genuine crash loop. */
const common = {
  exec_mode: 'fork',
  instances: 1,
  autorestart: true,
  max_restarts: 10,
  min_uptime: '20s',
  restart_delay: 2000,
  kill_timeout: 10000,
  max_memory_restart: '600M',
  time: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'yoho-api',
      cwd: path.join(APP, 'apps/api'),
      script: 'dist/main.js',
      interpreter: 'node',
    },
    {
      ...common,
      name: 'yoho-worker',
      cwd: path.join(APP, 'apps/worker'),
      script: 'node_modules/.bin/tsx',
      args: 'src/main.ts',
      interpreter: 'none',
    },
    {
      ...common,
      name: 'yoho-web',
      cwd: path.join(APP, 'apps/web-extranet'),
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      interpreter: 'none',
      // Next.js holds the built output in .next; a restart must not race the build.
      max_memory_restart: '900M',
    },
  ],
};
