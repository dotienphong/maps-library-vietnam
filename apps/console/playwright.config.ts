import { defineConfig } from '@playwright/test';

// webServer = harness itest ở chế độ --serve: DB cô lập + seed + wrangler dev :8799 + JWKS giả.
// Dùng chung harness với trang Admin thay vì dựng máy chủ riêng: cổng khách hàng cần Postgres
// thật và sổ quota thật, hai thứ mà một máy chủ tĩnh không có.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:8799', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/api-db-test.mjs --serve',
    cwd: '../..',
    url: 'http://127.0.0.1:8799/healthz',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    timeout: 180_000,
    // Harness giữ tiến trình sống bằng promise vô hạn; không có gracefulShutdown thì Playwright
    // chờ nó tự thoát và treo sau khi test đã xong.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
