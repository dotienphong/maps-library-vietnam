import type { Context, Next } from 'hono';
import type { AppEnv } from './env';

/** Workers Analytics Engine: (tenant, sha256(key), endpoint) + (status, ms, stage_hit) cho mọi request
 * /v1/*. Ghi hash chứ không ghi khoá — báo cáo tuần tra nhãn qua `api_key.key_hash`.
 * Binding optional — thiếu thì bỏ qua, không lỗi. */
export function analyticsMiddleware() {
  return async (c: Context<AppEnv>, next: Next) => {
    const t0 = Date.now();
    try {
      await next();
    } finally {
      const auth = c.get('auth');
      c.env.ANALYTICS?.writeDataPoint({
        // blob4 = MẪU route (`/v1/places/:id`), blob3 giữ nguyên đường dẫn THÔ. Hai cột chứ không
        // phải một: `report:weekly` đọc blob3, và lịch sử trước 18/09/2026 không có blob4 (truy vấn
        // vẫn chạy, cột trả chuỗi rỗng). Đường dẫn không khớp route nào rơi vào `/v1/*`.
        blobs: [
          auth?.tenantId ?? '',
          auth?.keyHash ?? '',
          new URL(c.req.url).pathname,
          c.req.routePath ?? '',
        ],
        // stage_hit: -1 route khác, -2 autocomplete trúng cache, 0 chạy mà rỗng, 1..3 bậc trúng.
        doubles: [c.res.status, Date.now() - t0, c.get('stageHit') ?? -1],
        indexes: [auth?.keyHash ?? 'anon'],
      });
    }
  };
}
