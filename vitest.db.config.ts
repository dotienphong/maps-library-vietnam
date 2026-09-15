// Test tích hợp cần Postgres dev đang chạy (pnpm db:up). Chạy: pnpm test:db
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vitest 5 đổi mặc định `clearMocks` thành true (vitest 4 là false): mọi call của `vi.fn()`
    // ghi ngoài thân test — pha collection hoặc `beforeAll` — đều bị xoá trước mỗi `it()`. Bộ test
    // này viết theo hành vi cũ, nên giữ nguyên và khai tường minh thay vì để mặc định đổi ngầm.
    clearMocks: false,
    include: ['db/**/*.dbtest.mjs', 'pipelines/*/tests/**/*.dbtest.mjs'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
