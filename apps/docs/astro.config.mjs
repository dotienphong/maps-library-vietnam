import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const require = createRequire(import.meta.url);

/**
 * MapLibre 6 chạy worker ESM riêng và tự suy URL của nó lúc chạy bằng
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`. Vite gộp maplibre vào một chunk trong
 * `_astro/` nhưng không phát ra hai file đó, nên `/react-demo/` đi tìm
 * `/_astro/maplibre-gl-worker.mjs` và nhận 404 → worker chết → bản đồ trống trong khi style,
 * sprite và pmtiles vẫn 200. Cùng cách xử lý với `packages/web/vite.umd.config.ts` cho bundle UMD
 * (file `/sdk/`) và với `public/sdk/` do `scripts/copy-sdk.mjs` chuẩn bị.
 *
 * `astro dev` không cần bước này: khi đó maplibre được Vite phục vụ từ `node_modules`, nên worker
 * nằm ngay cạnh và giải đúng — chỉ bản build mới hỏng.
 */
function copyMaplibreWorker() {
  return {
    name: 'mapslibvn-copy-maplibre-worker',
    hooks: {
      'astro:build:done': ({ dir }) => {
        for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
          copyFileSync(
            require.resolve(`maplibre-gl/dist/${file}`),
            fileURLToPath(new URL(`_astro/${file}`, dir)),
          );
        }
      },
    },
  };
}

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
    copyMaplibreWorker(),
  ],
});
