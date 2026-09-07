import type { Context, Next } from 'hono';
import type { AppEnv } from './env';

/** Workers Analytics Engine: (tenant, key, endpoint) + (status, ms, stage_hit) cho mọi request /v1/*.
 * Binding optional — thiếu thì bỏ qua, không lỗi. */
export function analyticsMiddleware() {
  return async (c: Context<AppEnv>, next: Next) => {
    const t0 = Date.now();
    try {
      await next();
    } finally {
      const auth = c.get('auth');
      c.env.ANALYTICS?.writeDataPoint({
        blobs: [auth?.tenantId ?? '', auth?.key ?? '', new URL(c.req.url).pathname],
        // stage_hit: -1 route khác, -2 autocomplete trúng cache, 0 chạy mà rỗng, 1..3 bậc trúng.
        doubles: [c.res.status, Date.now() - t0, c.get('stageHit') ?? -1],
        indexes: [auth?.key ?? 'anon'],
      });
    }
  };
}
