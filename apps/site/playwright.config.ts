import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4323', trace: 'retain-on-failure' },
  webServer: {
    // Chạy trên bản BUILD chứ không phải dev server: dev không sinh sitemap, không tối ưu ảnh và
    // không phải thứ bot sẽ tải về. Kiểm SEO trên dev là kiểm nhầm sản phẩm.
    // Cổng 4323 chứ không phải 4322 của `pnpm dev`: `reuseExistingServer` chỉ nhìn cổng, nên nếu
    // ai đó đang mở dev server ở 4322 thì Playwright lặng lẽ kiểm NHẦM dev thay vì bản build —
    // và dev có thanh công cụ riêng với vài thẻ h1, làm các bài "đúng một h1" đỏ một cách khó hiểu.
    command: 'pnpm build && pnpm exec astro preview --port 4323',
    url: 'http://localhost:4323/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Astro 7 tự chạy nền khi nhận diện agent; Playwright cần server ở tiền cảnh.
      // Biến này tắt nhánh tự chạy nền của Astro (giá trị chỉ cần khác rỗng).
      ASTRO_PREVIEW_BACKGROUND: '0',
      CLAUDECODE: '',
    },
  },
});
