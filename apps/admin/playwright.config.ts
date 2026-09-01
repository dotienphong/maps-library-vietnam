import { defineConfig } from '@playwright/test';

// webServer = harness itest ở chế độ --serve: DB cô lập + seed + wrangler dev :8799 + JWKS giả.
// cwd tương đối được Playwright resolve theo thư mục chứa config; api-db-test.mjs đọc đường dẫn
// tương đối gốc repo (apps/api/test-db/setup.sql…) nên phải chạy từ gốc.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:8799', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/api-db-test.mjs --serve',
    cwd: '../..',
    url: 'http://127.0.0.1:8799/healthz',
    // Dev: tái dùng harness đang chạy (`node scripts/api-db-test.mjs --serve`) cho nhanh.
    // CI: luôn dựng mới để DB sạch.
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    timeout: 180_000,
    // Harness giữ tiến trình sống bằng promise vô hạn; không có gracefulShutdown thì Playwright
    // chờ nó tự thoát và treo sau khi test đã xong.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
