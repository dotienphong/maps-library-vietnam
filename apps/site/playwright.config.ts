import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:4322', trace: 'retain-on-failure' },
  webServer: {
    // Chạy trên bản BUILD chứ không phải dev server: dev không sinh sitemap, không tối ưu ảnh và
    // không phải thứ bot sẽ tải về. Kiểm SEO trên dev là kiểm nhầm sản phẩm.
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4322/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Astro 7 dò môi trường agent (gói `am-i-vibing`) và TỰ đẩy `astro preview` xuống chạy nền.
      // Tiến trình nền thoát ngay, nên Playwright báo "webServer exited early" — một thông báo
      // không hề dẫn tới nguyên nhân thật. Xoá biến này để preview chạy ở tiền cảnh như Playwright
      // cần. Chỉ ảnh hưởng tiến trình máy chủ, không đụng môi trường của phần còn lại.
      CLAUDECODE: '',
    },
  },
});
