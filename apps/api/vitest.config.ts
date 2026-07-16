import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * API e2e tests boot the real Nest app against the real Postgres (docker compose) — the same
 * path production takes, RLS and all. SWC (not esbuild) does the transform because Nest's DI
 * needs `emitDecoratorMetadata`, which esbuild cannot emit.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Real database + a real HTTP stack: give them room.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Suites provision their own tenants, but they share one Postgres — run them serially so
    // concurrency tests measure their own contention, not each other's.
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        // Nest's DI reads `design:paramtypes`; without legacy decorators + metadata the
        // controllers silently vanish and every route 404s.
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
