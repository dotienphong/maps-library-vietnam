import { defineConfig } from 'vitest/config';

// Test tích hợp chỉ đường: cần Valhalla fixture + wrangler dev đang chạy — chạy qua `pnpm test:routing`.
export default defineConfig({
  test: {
    include: ['apps/api/test-routing/**/*.rtest.mjs'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
