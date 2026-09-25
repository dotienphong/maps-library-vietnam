import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4321', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @mapslibvn/api dev:e2e',
      url: 'http://localhost:8787/healthz',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm preview',
      url: 'http://localhost:4321/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Astro 7 tự chạy preview ở NỀN khi nhận diện agent, nên Playwright không tắt được và server
        // sót lại chặn mọi lần preview sau ("Another astro preview server is already running").
        // Cùng cách chữa với apps/site/playwright.config.ts (commit 96cd980).
        ASTRO_PREVIEW_BACKGROUND: '0',
        CLAUDECODE: '',
      },
    },
  ],
});
