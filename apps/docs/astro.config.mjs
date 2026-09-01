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
        { label: 'Bắt đầu 5 phút', slug: 'bat-dau' },
        { label: 'Đóng góp & sửa POI', slug: 'dong-gop' },
        { label: 'Playground', link: '/playground.html' },
      ],
    }),
    react(),
  ],
});
