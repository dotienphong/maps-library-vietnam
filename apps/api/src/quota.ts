import type { Context, Next } from 'hono';
import type { AuthInfo } from './auth';
import type { AppEnv, Env } from './env';
import { ApiError } from './errors';

/** Mặc định plan free (spec 6.4): 20.000 places/ngày. */
export const FREE_PLACES_PER_DAY = 20_000;
/** Mặc định plan free cho /v1/directions (spec dẫn đường A mục 5.5): một lượt tính tuyến đắt hơn một lượt tìm. */
export const FREE_DIRECTIONS_PER_DAY = 2_000;
export type QuotaGroup = 'places' | 'directions';
type LimiterEnv = Pick<
  Env,
  'PLACES_RATE_LIMITER' | 'DIRECTIONS_RATE_LIMITER' | 'DIRECTIONS_KEY_RATE_LIMITER'
>;

export function dailyLimit(auth: AuthInfo, group: QuotaGroup): number {
  if (group === 'directions') return auth.quotaDirectionsPerDay ?? FREE_DIRECTIONS_PER_DAY;
  return auth.quotaPlacesPerDay ?? FREE_PLACES_PER_DAY;
}

/** Burst theo khoá+IP tại edge: directions có binding riêng, ngưỡng thấp hơn Places. */
export function burstLimiterFor(env: LimiterEnv, group: QuotaGroup): RateLimit | undefined {
  return group === 'directions' ? env.DIRECTIONS_RATE_LIMITER : env.PLACES_RATE_LIMITER;
}

/**
 * Trần tổng theo khoá (mọi IP cộng lại) cho khoá `web`/`mobile` ở directions. Khoá loại này nằm công
 * khai trong HTML/app nên plan internal cũng không được miễn (quyết định PHONG 10/09/2026 sau review
 * bảo mật); khoá `server` (app của chính PHONG) không chịu trần. Dùng Rate Limiting thay KV: không tốn
 * write KV (Workers Free 1.000 ghi/ngày) và kẻ tấn công không làm cạn được ngân sách KV của tài khoản.
 */
export function keyCapLimiterFor(
  env: LimiterEnv,
  auth: AuthInfo,
  group: QuotaGroup,
): RateLimit | undefined {
  if (group !== 'directions' || auth.kind === 'server') return undefined;
  return env.DIRECTIONS_KEY_RATE_LIMITER;
}

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
export function quotaMiddleware(group: QuotaGroup) {
  return async (c: Context<AppEnv>, next: Next) => {
    const auth = c.get('auth');
    if (!auth) return next();
    const burst = burstLimiterFor(c.env, group);
    if (burst) {
      const actor = await rateLimitActor(
        auth.keyHash,
        c.req.header('cf-connecting-ip') ?? 'unknown',
      );
      await enforceBurstLimit(burst, actor);
    }
    const cap = keyCapLimiterFor(c.env, auth, group);
    if (cap) await enforceBurstLimit(cap, auth.keyHash);
    if (c.env.QUOTA_ENABLED !== '1' || auth.plan === 'internal') return next();
    const limit = dailyLimit(auth, group);
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
