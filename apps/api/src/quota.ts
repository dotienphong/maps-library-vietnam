import type { Context, Next } from 'hono';
import type { AppEnv } from './env';
import { ApiError } from './errors';

/** Mặc định plan free (spec 6.4): 20.000 places/ngày. */
export const FREE_PLACES_PER_DAY = 20_000;

/** YYYY-MM-DD theo giờ VN (UTC+7, không DST). */
export function vnDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Mốc UTC bắt đầu ngày VN hiện tại (00:00 UTC+7) — dùng cho đếm edit theo ngày bằng SQL. */
export function vnDayStartUtc(now: Date = new Date()): Date {
  const vn = new Date(now.getTime() + 7 * 3600 * 1000);
  return new Date(
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - 7 * 3600 * 1000,
  );
}

/** Đếm xấp xỉ trong KV, chặn 429 khi vượt 2× quota (tránh chặn nhầm vì đếm trễ).
 * Tenant internal: không đọc/ghi KV (Workers Free chỉ cho 1.000 ghi KV/ngày). */
export function quotaMiddleware(group: 'places') {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get('auth');
    if (!auth) return next();
    if (c.env.PLACES_RATE_LIMITER) {
      const actor = await rateLimitActor(
        auth.keyHash,
        c.req.header('cf-connecting-ip') ?? 'unknown',
      );
      await enforceBurstLimit(c.env.PLACES_RATE_LIMITER, actor);
    }
    if (c.env.QUOTA_ENABLED !== '1' || auth.plan === 'internal') return next();
    const limit = auth.quotaPlacesPerDay ?? FREE_PLACES_PER_DAY;
    const key = `quota:${auth.keyHash}:${vnDay()}:${group}`;
    const count = Number((await c.env.META.get(key)) ?? 0);
    if (count >= limit * 2) {
      throw new ApiError(429, 'quota_exceeded', `Vượt quota ${group} theo ngày`);
    }
    c.executionCtx.waitUntil(c.env.META.put(key, String(count + 1), { expirationTtl: 2 * 86_400 }));
    await next();
  };
}

/** Tách boundary để kiểm thử quyết định allow/deny mà không dùng bộ đếm dùng chung của Miniflare. */
export async function enforceBurstLimit(limiter: RateLimit, keyHash: string): Promise<void> {
  const burst = await limiter.limit({ key: keyHash });
  if (!burst.success) {
    throw new ApiError(429, 'rate_limit_exceeded', 'Gửi quá nhiều request trong một phút', 60);
  }
}

/** Không đưa IP thô vào counter key; cùng một người vẫn bị giới hạn riêng trong từng tenant. */
export async function rateLimitActor(keyHash: string, ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${keyHash}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
