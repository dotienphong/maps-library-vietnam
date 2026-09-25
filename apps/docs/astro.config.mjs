import { copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';
import { API_BASE, DOCS_URL, SITE_URL } from './docs.config.mjs';
import { lastmodChoUrl } from './scripts/lastmod.mjs';

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

const GOC_DOCS = fileURLToPath(new URL('.', import.meta.url));
/** Trang không lên sitemap: bản chép giấy phép (noindex), demo mỏng (noindex) và trang lỗi. */
const KHONG_LEN_SITEMAP = ['/thong-bao-ben-thu-ba/', '/react-demo/', '/404/'];

export default defineConfig({
  site: DOCS_URL,
  integrations: [
    // Tự khai sitemap để có `lastmod` thật từ git (Starlight thấy có sẵn thì bỏ bản của nó).
    sitemap({
      filter: (page) => !KHONG_LEN_SITEMAP.some((duong) => page.endsWith(duong)),
      customPages: [`${DOCS_URL}/playground`],
      serialize(item) {
        const lastmod = lastmodChoUrl(item.url, GOC_DOCS);
        return lastmod ? { ...item, lastmod } : item;
      },
    }),
    starlight({
      title: 'MapsLibVN',
      // "Trang — MapsLibVN" giống website, thay cho "Trang | MapsLibVN" mặc định của Starlight.
      titleDelimiter: '—',
      // OG, JSON-LD, noindex cho từng trang (spec SEO-AI mục 6.2).
      routeMiddleware: './src/route-data.ts',
      // "Cập nhật lần cuối: …" cuối mỗi trang — tín hiệu độ mới mà AI dựa vào khi chọn nguồn.
      // Đọc từ git, nên deploy-docs.yml phải checkout đủ lịch sử.
      lastUpdated: true,
      components: { Footer: './src/components/Footer.astro' },
      // llms.txt / llms-full.txt / llms-small.txt cho AI và trợ lý lập trình (spec SEO-AI mục 6.7).
      // Nhãn nhóm bằng tiếng Anh để URL /_llms-txt/<nhóm>.txt là ASCII sạch; mô tả vẫn tiếng Việt.
      // KHÔNG ghi số tiền: docs cố ý không chép cứng giá (xem khoa-api.md), giá đọc ở /v1/catalog.
      plugins: [
        starlightLlmsTxt({
          projectName: 'MapsLibVN',
          description:
            'Tài liệu kỹ thuật của MapsLibVN — API bản đồ, tìm kiếm địa điểm, geocode và dẫn đường cho Việt Nam, kèm SDK cho web, React và React Native.',
          details: [
            `- API base: \`${API_BASE}\`; mọi endpoint \`/v1/*\` cần khoá API gửi qua header \`X-Api-Key\`.`,
            '- Ba loại khoá: `web` (kiểm origin của trình duyệt), `mobile`, `server`. Khoá demo chỉ để thử trên playground và `localhost`; ứng dụng thật cần khoá riêng.',
            '- Bốn gói npm: `@mapslibvn/web` (bản đồ web), `@mapslibvn/react` (React), `@mapslibvn/react-native` (iOS, Android), `@mapslibvn/core` (client API, không giao diện).',
            '- Ghi nguồn là bắt buộc: SDK luôn hiện attribution và không có tuỳ chọn tắt.',
            `- Giá và hạn mức: đọc bằng máy ở \`GET /v1/catalog\`, hoặc xem ${SITE_URL}/bang-gia/.`,
          ].join('\n'),
          customSets: [
            {
              label: 'Getting started',
              description: 'Cài đặt, khoá API, bản đồ đầu tiên trong 5 phút, React Native',
              paths: ['cai-dat', 'khoa-api', 'bat-dau', 'react-native'],
            },
            {
              label: 'Guides',
              description:
                'Bản đồ web, tìm kiếm, dẫn đường trên web và React Native, đội xe, React, độ chính xác geocode, đóng góp POI',
              paths: [
                'ban-do-web',
                'tim-kiem',
                'dan-duong',
                'dan-duong-react-native',
                'doi-xe',
                'react',
                'do-chinh-xac',
                'dong-gop',
              ],
            },
            {
              label: 'Reference',
              description: 'Tham chiếu REST API và SDK JavaScript',
              paths: ['api', 'sdk'],
            },
          ],
          optionalLinks: [
            { label: 'Website MapsLibVN', url: `${SITE_URL}/`, description: 'giới thiệu sản phẩm' },
            {
              label: 'Bảng giá',
              url: `${SITE_URL}/bang-gia/`,
              description: 'bốn gói, giá VND, hạn mức',
            },
            { label: 'So với Google Maps Platform', url: `${SITE_URL}/so-sanh/google-maps-api/` },
            { label: 'So với VIETMAP', url: `${SITE_URL}/so-sanh/vietmap/` },
          ],
          demote: ['dieu-khoan', 'giay-phep', 'thong-bao-ben-thu-ba'],
          exclude: ['thong-bao-ben-thu-ba'],
        }),
      ],
      defaultLocale: 'root',
      locales: { root: { label: 'Tiếng Việt', lang: 'vi' } },
      customCss: ['./src/styles/custom.css'],
      /**
       * TỐI là mặc định, đồng bộ với website và cổng khách hàng (spec 22/09 mục 4.5). Starlight
       * vốn theo `prefers-color-scheme`, nên phần lớn khách đặt máy sáng sẽ không bao giờ thấy
       * bản tối.
       *
       * Phải GHI VÀO `localStorage['starlight-theme']` chứ không chỉ đặt `data-theme`: script này
       * nằm trước `StarlightThemeProvider` trong <head>, mà provider đó đọc localStorage rồi rơi
       * về `prefers-color-scheme` và ghi đè `data-theme` ngay sau đó. Đặt data-theme thôi thì bị
       * xoá trong cùng một khung hình mà không có lỗi nào — đã đo trên bản dựng.
       *
       * Chỉ ghi khi người dùng CHƯA chọn gì, nên công tắc của Starlight vẫn thắng về sau.
       */
      head: [
        {
          tag: 'script',
          content:
            "(function(){try{if(!localStorage.getItem('starlight-theme'))localStorage.setItem('starlight-theme','dark')}catch(e){document.documentElement.dataset.theme='dark'}})()",
        },
      ],
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
            { label: 'Dẫn đường', slug: 'dan-duong' },
            { label: 'Dẫn đường React Native', slug: 'dan-duong-react-native' },
            { label: 'Giao hàng & đội xe', slug: 'doi-xe' },
            { label: 'React', slug: 'react' },
            { label: 'Độ chính xác geocode', slug: 'do-chinh-xac' },
            { label: 'Đóng góp & sửa POI', slug: 'dong-gop' },
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
            { label: 'Playground', link: '/playground' },
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
