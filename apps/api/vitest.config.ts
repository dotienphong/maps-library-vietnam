import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          TILES_BASE: 'https://tiles.test',
          ENVIRONMENT: 'test',
          QUOTA_ENABLED: '1',
          COMMERCIAL_ADMISSION: '1',
          ROUTING_BASE: 'https://routing.test',
          FLEET_BASE: 'https://fleet.test',
          ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
          ACCESS_AUD: 'test-aud',
          BILLING_ADMIN_EMAILS: 'billing@test.local',
          // Quyền sao lưu/phục hồi tách riêng: `billing@test.local` KHÔNG có mặt ở đây, để test
          // chứng minh quản trị thuê bao không tự động ghi đè được sổ.
          BILLING_BACKUP_EMAILS: 'backup@test.local',
          IP_HASH_PEPPER: 'test-pepper',
        },
        // Tầng test này KHÔNG được cần Postgres (dbtest là workflow riêng). Trỏ binding
        // Hyperdrive vào cổng đóng để nhánh lỗi của /healthz/db xác định ở mọi máy và CI.
        hyperdrives: { DB: 'postgres://nobody:nobody@127.0.0.1:59999/nowhere' },
        // Ngưỡng cao để state dùng chung giữa test files không gây 429 chéo; quyết định deny
        // được test riêng bằng fake RateLimit trong quota.test.ts.
        ratelimits: {
          PLACES_RATE_LIMITER: { namespace_id: '20260910', simple: { limit: 10_000, period: 60 } },
          DIRECTIONS_RATE_LIMITER: {
            namespace_id: '20260911',
            simple: { limit: 10_000, period: 60 },
          },
          DIRECTIONS_KEY_RATE_LIMITER: {
            namespace_id: '20260912',
            simple: { limit: 10_000, period: 60 },
          },
          MATRIX_RATE_LIMITER: {
            namespace_id: '20260923',
            simple: { limit: 10_000, period: 60 },
          },
          FLEET_RATE_LIMITER: {
            namespace_id: '20260924',
            simple: { limit: 10_000, period: 60 },
          },
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    /**
     * Vitest 4 tính unhandled rejection là đỏ (vitest 2 im lặng) — tín hiệu đáng giữ, nên ở đây
     * chỉ lọc ĐÚNG HAI thông điệp và chỉ khi stack đến từ polyfill của postgres.js, không dùng
     * `dangerouslyIgnoreUnhandledErrors`.
     *
     * Cả hai phát bên trong postgres.js và KHÔNG chặn được từ mã của ta: `read()` trong
     * cf/polyfills.js bắt lỗi socket rồi `tcp.emit('error', err)`, lúc teardown không còn listener
     * nào cho `'error'` nên chỗ emit throw ngược vào frame async của `read()`, mà hàm đó không
     * được ai await. Đã thử sửa ở chỗ gọi bằng `endSql()` + `.catch()` trên `end()`: không giảm
     * được lỗi nào. Binding Hyperdrive ở trên lại CHỦ Ý trỏ vào cổng đóng để nhánh lỗi
     * /healthz/db xác định, nên tình huống này luôn xảy ra trong bộ test.
     *
     * - `Stream was cancelled.` — có từ M3, khi client bị đóng giữa chừng.
     * - `Network connection lost.` — thêm 19/09/2026 cùng `test/scheduled.test.ts`: cron chạy với
     *   DB không nối được là ĐÚNG cảnh bài đó dựng ra để kiểm (spec 9.4). Chỉ đỏ trên CI, không
     *   tái hiện ở máy — khác biệt về cách cổng đóng trả lời.
     */
    onUnhandledError: (error) => {
      const tuPostgresPolyfill =
        ['Stream was cancelled.', 'Network connection lost.'].includes(error.message) &&
        (error.stack ?? '').includes('postgres/cf/polyfills.js');
      return tuPostgresPolyfill ? false : undefined;
    },
  },
});
