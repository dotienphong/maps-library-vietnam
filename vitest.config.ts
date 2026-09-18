import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // `import.meta.url` không dùng được ở đây: tsconfig.scripts.json typecheck file này với
    // module CommonJS. Vitest luôn chạy từ gốc repo nên cwd là mốc đúng.
    alias: { '@': resolve(process.cwd(), 'apps/admin/src') },
  },
  test: {
    // setupFiles áp cho MỌI file test; bản thân file setup tự bỏ qua khi không ở jsdom.
    setupFiles: ['./apps/admin/src/test-setup.ts'],
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
      'apps/site/src/**/*.test.ts',
      // Test giao diện trang Admin. Môi trường jsdom khai bằng docblock `@vitest-environment`
      // ở đầu từng file, không đặt toàn cục — bộ test này còn chạy scripts/**/*.test.mjs trên Node.
      'apps/admin/src/**/*.test.{ts,tsx}',
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
