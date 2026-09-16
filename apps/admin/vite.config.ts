import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base /admin/ + outDir dist/admin: Worker assets directory = apps/admin/dist
// → URL /admin/ trỏ file dist/admin/index.html.
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
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    ...(devProxy ? { server: { proxy: devProxy } } : {}),
    build: { outDir: 'dist/admin', emptyOutDir: true },
  };
});
