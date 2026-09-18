import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { SITE_URL } from './site.config.mjs';

// Tĩnh hoàn toàn: mọi trang dựng sẵn thành HTML lúc build nên bot đọc được ngay và không có
// máy chủ nào phải chạy. KHÔNG dùng @astrojs/react: mọi tương tác của site này nhỏ tới mức một
// <script> vài chục dòng làm xong, còn React + hydration thì tốn ~45 kB gzip cho mỗi trang.
export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'always',
  integrations: [sitemap({ filter: (page) => !page.includes('/404') })],
  vite: { plugins: [tailwindcss()] },
  build: { inlineStylesheets: 'auto' },
});
