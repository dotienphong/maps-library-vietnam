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
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Giới thiệu',
          items: [{ label: 'Tính năng', slug: 'tinh-nang' }],
        },
        {
          label: 'Bắt đầu',
          items: [
            { label: 'Cài đặt', slug: 'cai-dat' },
            { label: 'Khoá API', slug: 'khoa-api' },
            { label: 'Bắt đầu 5 phút', slug: 'bat-dau' },
            { label: 'React Native', slug: 'react-native' },
          ],
        },
        {
          label: 'Hướng dẫn',
          items: [
            { label: 'Bản đồ web', slug: 'ban-do-web' },
            { label: 'Tìm kiếm & autocomplete', slug: 'tim-kiem' },
            { label: 'React', slug: 'react' },
            { label: 'Độ chính xác geocode', slug: 'do-chinh-xac' },
            { label: 'Đóng góp & sửa POI', slug: 'dong-gop' },
            { label: 'Tự host', slug: 'tu-host' },
          ],
        },
        {
          label: 'Tham chiếu',
          items: [
            { label: 'REST API', slug: 'api' },
            { label: 'SDK JavaScript', slug: 'sdk' },
          ],
        },
        {
          label: 'Thử nghiệm',
          items: [
            { label: 'Playground', link: '/playground.html' },
            { label: 'React demo', link: '/react-demo/' },
            { label: 'Nhúng thử trang của bạn', slug: 'nhung-thu' },
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
      ],
    }),
    react(),
  ],
});
