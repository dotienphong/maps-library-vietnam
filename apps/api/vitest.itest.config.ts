import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/api/test-db/**/*.itest.mjs'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
