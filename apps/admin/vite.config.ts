import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base /admin/ + outDir dist/admin: Worker assets directory = apps/admin/dist
// → URL /admin/ trỏ file dist/admin/index.html.
/**
 * maplibre giải mã ô trong Web Worker và dựng URL worker cạnh chunk của chính nó
 * (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`). Vite không xuất tệp đó, nên thiếu nó
 * thì ô không bao giờ được giải mã: nền bản đồ trắng, chốt vị trí vẫn hiện, và KHÔNG có lỗi nào
 * để hiển thị — mất hẳn manh mối. Sự cố 16/09/2026.
 *
 * `packages/web/vite.umd.config.ts` đã phải làm đúng việc này cho bản UMD; đây là bản tương ứng
 * cho bản ESM của trang admin. Worker còn import `maplibre-gl-shared.mjs` nên phải chép cả hai.
 */
function xuatWorkerMaplibre(thuMucRa: string) {
  return {
    name: 'mapslibvn-xuat-worker-maplibre',
    closeBundle() {
      const nguon = fileURLToPath(new URL('./node_modules/maplibre-gl/dist/', import.meta.url));
      const dich = fileURLToPath(new URL(`./${thuMucRa}/assets/`, import.meta.url));
      mkdirSync(dich, { recursive: true });
      for (const tep of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        copyFileSync(`${nguon}${tep}`, `${dich}${tep}`);
      }
    },
  };
}

/**
 * `_headers` (CSP, X-Frame-Options, HSTS cho /admin và /console) phải nằm ở GỐC thư mục assets
 * của Worker (`apps/admin/dist`), không phải trong `dist/admin`. Vite chỉ chép `public/` vào
 * outDir, nên chép tay sau khi build xong.
 */
function chepHeaders() {
  return {
    name: 'mapslibvn-chep-headers',
    closeBundle() {
      copyFileSync(
        fileURLToPath(new URL('./_headers', import.meta.url)),
        fileURLToPath(new URL('./dist/_headers', import.meta.url)),
      );
    },
  };
}

export default defineConfig(async ({ command }) => {
  // Chỉ nạp Access giả khi chạy `vite dev`. Import tĩnh sẽ sinh cặp khoá trong .cache/ ngay cả
  // lúc build trên CI, nơi không có và không cần thứ đó.
  const devProxy =
    command === 'serve'
      ? await (async () => {
          const { signAccessJwt } = await import('../../scripts/lib/access-fake.mjs');
          const jwt = signAccessJwt({ email: 'dev@local' });
          return {
            // Harness `node scripts/api-db-test.mjs --serve` phục vụ API ở cổng này. Trình duyệt
            // ở chế độ dev không có cookie Cloudflare Access, nên proxy tự chèn JWT giả — cùng
            // cặp khoá mà harness đang công bố qua JWKS.
            '/v1': {
              target: 'http://127.0.0.1:8799',
              changeOrigin: true,
              headers: { 'Cf-Access-Jwt-Assertion': jwt },
            },
          };
        })()
      : undefined;

  return {
    base: '/admin/',
    plugins: [react(), tailwindcss(), xuatWorkerMaplibre('dist/admin'), chepHeaders()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // @mapslibvn/ui là source trong workspace; bảo đảm nó và admin dùng CÙNG một bản React,
      // nếu không hook trong component dùng chung sẽ ném "Invalid hook call".
      dedupe: ['react', 'react-dom'],
    },
    ...(devProxy ? { server: { proxy: devProxy } } : {}),
    build: { outDir: 'dist/admin', emptyOutDir: true },
  };
});
