import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TILES_BASE: 'https://tiles.test',
            ENVIRONMENT: 'test',
            QUOTA_ENABLED: '1',
            ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com',
            ACCESS_AUD: 'test-aud',
            IP_HASH_PEPPER: 'test-pepper',
          },
          // Tầng test này KHÔNG được cần Postgres (dbtest là workflow riêng). Trỏ binding
          // Hyperdrive vào cổng đóng để nhánh lỗi của /healthz/db xác định ở mọi máy và CI.
          hyperdrives: { DB: 'postgres://nobody:nobody@127.0.0.1:59999/nowhere' },
          // Ngưỡng cao để state dùng chung giữa test files không gây 429 chéo; quyết định deny
          // được test riêng bằng fake RateLimit trong quota.test.ts.
          ratelimits: { PLACES_RATE_LIMITER: { simple: { limit: 10_000, period: 60 } } },
        },
      },
    },
  },
});
