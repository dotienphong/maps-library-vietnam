import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // vitest 5 đổi mặc định `clearMocks` thành true (vitest 4 là false): mọi call của `vi.fn()`
    // ghi ngoài thân test — pha collection hoặc `beforeAll` — đều bị xoá trước mỗi `it()`. Bộ test
    // này có những chỗ cố ý chạy MỘT lần mô phỏng rồi khẳng định nhiều điều về nó
    // (navigator.test.ts), nên giữ hành vi cũ và khai tường minh thay vì để mặc định đổi ngầm.
    clearMocks: false,
    include: [
      'scripts/**/*.test.mjs',
      'packages/*/src/**/*.test.{ts,tsx,mjs}',
      'packages/*/tests/**/*.test.ts',
      'pipelines/*/src/**/*.test.{ts,mjs}',
      'pipelines/*/tests/**/*.test.mjs',
      'apps/docs/scripts/**/*.test.mjs',
      'apps/docs/src/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/**/node_modules/**',
      'apps/**/dist/**',
      'apps/**/e2e/**',
      '**/*.dbtest.mjs',
    ],
  },
});
