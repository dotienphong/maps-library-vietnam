import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mapslibvn-docs.pages.dev',
  integrations: [
    starlight({
      title: 'MapsLibVN',
      defaultLocale: 'root',
      locales: { root: { label: 'Tiếng Việt', lang: 'vi' } },
      sidebar: [
        {
          label: 'Hướng dẫn',
          items: [
            { label: 'Bắt đầu 5 phút', slug: 'bat-dau' },
            { label: 'Độ chính xác geocode', slug: 'do-chinh-xac' },
            { label: 'Đóng góp & sửa POI', slug: 'dong-gop' },
            { label: 'Tự host', slug: 'tu-host' },
          ],
        },
        {
          label: 'Pháp lý',
          items: [
            { label: 'Giấy phép & ghi nguồn', slug: 'giay-phep' },
            { label: 'Điều khoản tenant', slug: 'dieu-khoan' },
            { label: 'Thông báo bên thứ ba', slug: 'thong-bao-ben-thu-ba' },
          ],
        },
        { label: 'Playground', link: '/playground.html' },
      ],
    }),
    react(),
  ],
});
