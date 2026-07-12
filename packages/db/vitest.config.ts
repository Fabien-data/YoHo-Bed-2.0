import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration tests need a running Postgres; give them room.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
