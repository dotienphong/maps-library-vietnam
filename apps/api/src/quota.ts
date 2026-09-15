import type { Context, Next } from 'hono';
import type { AuthInfo } from './auth';
import type { ReserveResult, SettlementReceipt } from './billing/types';
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

/** Số giây còn lại tới 00:00 giờ VN kế tiếp — quota ngày legacy reset đúng mốc này, nên
 * `retry-after` nói thật thay vì hằng số 3600 cũ. */
export function secondsUntilVnDayReset(now: Date = new Date()): number {
  const nextDayStart = vnDayStartUtc(now).getTime() + 86_400_000;
  return Math.max(1, Math.ceil((nextDayStart - now.getTime()) / 1000));
}

/** Đếm xấp xỉ trong KV, chặn 429 khi vượt 2× quota (tránh chặn nhầm vì đếm trễ).
 * Tenant internal: không đọc/ghi KV (Workers Free chỉ cho 1.000 ghi KV/ngày). */
export function quotaMiddleware(group: QuotaGroup, preflight?: (c: Context<AppEnv>) => void) {
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
    // Hono gọi handler GET cho HEAD (spec 14.3), nên phải chặn theo raw method — và chặn cho MỌI
    // tenant, không riêng commercial: tenant legacy đang chạy trọn handler rồi tăng cả bộ đếm KV,
    // tức HEAD bị tính lượt trái spec mục 6. Đặt sau burst (HEAD flood vẫn phải bị rate limit)
    // nhưng trước preflight, vì sai method thì không cần bàn tới tham số.
    if (c.req.raw.method === 'HEAD') {
      return c.body(null, 405, { Allow: 'GET', 'cache-control': 'private, no-store' });
    }
    preflight?.(c);
    if ((auth.quotaMode ?? 'legacy') === 'commercial') {
      return commercialQuota(c, next, auth, group);
    }
    if (c.env.QUOTA_ENABLED !== '1' || auth.plan === 'internal') return next();
    const limit = dailyLimit(auth, group);
    const key = `quota:${auth.keyHash}:${vnDay()}:${group}`;
    const count = Number((await c.env.META.get(key)) ?? 0);
    if (count >= limit * 2) {
      throw new ApiError(
        429,
        'quota_exceeded',
        `Vượt quota ${group} theo ngày`,
        secondsUntilVnDayReset(),
      );
    }
    c.executionCtx.waitUntil(c.env.META.put(key, String(count + 1), { expirationTtl: 2 * 86_400 }));
    await next();
  };
}

type DenialReason = Extract<ReserveResult, { allowed: false }>['reason'];

/**
 * Lý do từ chối → hợp đồng lỗi công khai. Không gộp tất cả thành "hết quota, mua thêm":
 * spec mục 9 đòi 403 khi hết QUYỀN, 14.1 cấm gợi ý mua thêm cho `ack_required`,
 * 14.4 cấm gợi ý mua thêm cho nghẽn tạm thời.
 */
const QUOTA_DENIAL: Record<
  DenialReason,
  {
    status: 403 | 429;
    code: string;
    message: string;
    actions: string[];
    retryAfter?: number;
  }
> = {
  daily: {
    status: 429,
    code: 'quota_exceeded',
    message: 'Hết hạn mức trong ngày',
    actions: ['wait', 'upgrade'],
  },
  period: {
    status: 429,
    code: 'quota_exceeded',
    message: 'Hết hạn mức của kỳ',
    actions: ['upgrade', 'buy_more'],
  },
  trial_total: {
    status: 429,
    code: 'quota_exceeded',
    message: 'Hết tổng lượt dùng thử',
    actions: ['upgrade'],
  },
  trial_expired: {
    status: 403,
    code: 'subscription_expired',
    message: 'Bản dùng thử đã hết hạn',
    actions: ['upgrade'],
  },
  subscription_expired: {
    status: 403,
    code: 'subscription_expired',
    message: 'Thuê bao đã hết hạn',
    actions: ['renew'],
  },
  no_entitlement: {
    status: 403,
    code: 'subscription_expired',
    message: 'Chưa có quyền sử dụng thương mại',
    actions: ['renew'],
  },
  suspended: {
    status: 403,
    code: 'subscription_expired',
    message: 'Thuê bao đang bị tạm dừng',
    actions: ['renew'],
  },
  ack_required: {
    status: 429,
    code: 'ack_required',
    message: 'Còn receipt chưa xác nhận',
    actions: ['wait'],
  },
  concurrency_limit: {
    status: 429,
    code: 'concurrency_limit',
    message: 'Quá nhiều request đồng thời',
    actions: ['wait'],
    retryAfter: 5,
  },
};

const RECEIPT_VERSION = '1';
const COMMERCIAL_HANDLER_TIMEOUT_MS = 30_000;

async function commercialQuota(
  c: Context<AppEnv>,
  next: Next,
  auth: AuthInfo,
  group: QuotaGroup,
): Promise<Response | undefined> {
  // Không kiểm lại cổng admission hay xung đột plan internal ở đây: đó là CHÍNH SÁCH ai được dùng
  // thương mại, thuộc tầng auth và đã chạy trong `validateCommercialAuth` trước khi tới middleware
  // này. Nhân đôi ở đây chỉ tạo hai bản thông điệp phải giữ đồng bộ, mà nhánh dưới không bao giờ
  // chạy tới trong production. Hàm này chỉ lo phần ĐO ĐẾM.
  const requestId = crypto.randomUUID();
  const object = c.env.QUOTA.get(c.env.QUOTA.idFromName(auth.tenantId));
  const reservation = await quotaRpc(
    () => object.reserve(requestId, group, auth.keyHash) as unknown as Promise<ReserveResult>,
  );
  if (!reservation.allowed) {
    const denial = QUOTA_DENIAL[reservation.reason];
    // resetAt chỉ có khi thật sự có mốc cấp lại (spec mục 9): hạn mức ngày của trial thì có,
    // còn kỳ trả phí chưa thanh toán thì KHÔNG hứa reset.
    const retryAfter =
      reservation.resetAt === null
        ? denial.retryAfter
        : Math.max(1, Math.ceil((Date.parse(reservation.resetAt) - Date.now()) / 1000));
    throw new ApiError(denial.status, denial.code, `${denial.message} (${group})`, retryAfter, {
      group,
      reason: reservation.reason,
      resetAt: reservation.resetAt,
      actions: denial.actions,
    });
  }

  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        next(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ApiError(503, 'upstream_timeout', 'Xử lý API quá thời hạn')),
            COMMERCIAL_HANDLER_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  } catch (error) {
    await releaseQuietly(object, requestId, 'handler_throw');
    throw error;
  }

  const response = c.res;
  if (response.status < 200 || response.status >= 300) {
    await releaseQuietly(object, requestId, `handler_${response.status}`);
    sealPrivate(response);
    return;
  }

  const token = crypto.randomUUID();
  const tokenHash = await sha256Token(token);
  let receipt: SettlementReceipt;
  try {
    receipt = await quotaRpc(() => object.prepare(requestId, tokenHash));
  } catch (error) {
    await releaseQuietly(object, requestId, 'prepare_failed');
    throw error;
  }
  sealPrivate(response);
  response.headers.set('x-mapslibvn-receipt-id', requestId);
  response.headers.set('x-mapslibvn-receipt-token', token);
  // Hạn do DO cấp, không tự suy từ hằng số phía Worker: DO mới là nơi giữ đồng hồ lease.
  response.headers.set('x-mapslibvn-receipt-expires-at', receipt.expiresAt);
  response.headers.set('x-mapslibvn-receipt-version', RECEIPT_VERSION);
}

/**
 * Sửa header TRÊN CHÍNH response hiện tại. Không được gán `c.res = new Response(...)`: Hono
 * `set res` chép mọi header của response cũ đè lên response mới (context.js), nên `cache-control`
 * của handler — `cachedJson` đặt `public, max-age=…` — sẽ ghi đè lại `private, no-store` và biến
 * response mang receipt token thành tài nguyên cache chung ở biên.
 */
function sealPrivate(response: Response): void {
  response.headers.set('cache-control', 'private, no-store');
  response.headers.delete('expires');
  response.headers.delete('pragma');
}

/**
 * Sổ quota lỗi lúc release không được nuốt mất lỗi/response thật của handler: khách phải thấy đúng
 * 400/404 của mình thay vì 503. Lượt vẫn về khi lease hết hạn, và log là đầu mối đối soát Task 6.
 */
async function releaseQuietly(
  object: ReturnType<Env['QUOTA']['get']>,
  requestId: string,
  reason: string,
): Promise<void> {
  try {
    await quotaRpc(() => object.release(requestId, reason));
  } catch (error) {
    console.error('quota release', requestId, reason, error);
  }
}

async function sha256Token(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function quotaRpc<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await withRpcTimeout(call);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const message = error instanceof Error ? error.message.toLowerCase() : String(error);
      if (attempt === 1 || message.includes('overload')) {
        throw new ApiError(503, 'quota_unavailable', 'Không truy cập được sổ quota');
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 21)));
    }
  }
  throw new ApiError(503, 'quota_unavailable', 'Không truy cập được sổ quota');
}

async function withRpcTimeout<T>(call: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('quota_timeout')), 2_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
