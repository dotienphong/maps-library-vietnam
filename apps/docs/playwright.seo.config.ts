import { defineConfig } from '@playwright/test';

// Chỉ bài SEO. Khác `playwright.config.ts`: không dựng API ở máy (wrangler dev + seed) vì bài này
// chỉ đọc HTML tĩnh, và chạy trên bản BUILD mới dựng — giống e2e của website.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'seo.spec.ts',
  timeout: 180_000,
  use: { baseURL: 'http://localhost:4324', trace: 'retain-on-failure' },
  webServer: {
    // Cổng 4324 riêng: `reuseExistingServer` chỉ nhìn cổng, dùng chung 4321 với `pnpm dev` là kiểm
    // nhầm dev server.
    command: 'pnpm build && pnpm exec astro preview --port 4324',
    url: 'http://localhost:4324/',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // Astro 7 tự chạy nền khi nhận diện agent; Playwright cần server ở tiền cảnh.
      ASTRO_PREVIEW_BACKGROUND: '0',
      CLAUDECODE: '',
    },
  },
});
