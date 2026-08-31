// Test tích hợp cần Postgres dev đang chạy (pnpm db:up). Chạy: pnpm test:db
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['db/**/*.dbtest.mjs', 'pipelines/*/tests/**/*.dbtest.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
