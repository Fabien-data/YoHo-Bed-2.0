import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests for the web app's pure logic (the Stay View model, shared booking rules). Browser
 * behaviour is Playwright's job (e2e/); these run in plain Node, in milliseconds.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    include: ['components/**/*.test.ts', 'lib/**/*.test.ts'],
    environment: 'node',
  },
});
