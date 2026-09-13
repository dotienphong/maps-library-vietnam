import type { Context, Next } from 'hono';
import { getSql } from './db';
import { sha256Hex } from './edits/hash';
import type { AppEnv } from './env';
import { ApiError } from './errors';

/**
 * Audit 09/09/2026: DB, KV, analytics và `poi_edit.api_key` chỉ giữ `sha256(khoá)`. Khoá plaintext
 * chỉ tồn tại ở client và trong header của request; lộ dump DB không còn kéo theo lộ khoá.
 */
export interface AuthInfo {
  /** sha256 hex của khoá — định danh khoá ở mọi nơi phía máy chủ. */
  keyHash: string;
  /** `mlv_live_` + 8 ký tự đầu: chỉ để nhận diện trong báo cáo/thu hồi. */
  keyPrefix: string;
  tenantId: string;
  plan: 'internal' | 'free' | 'paid';
  kind: 'web' | 'mobile' | 'server';
  scopes: string[];
  allowedOrigins: string[];
  quotaPlacesPerDay: number | null;
  /** NULL → mặc định plan (FREE_DIRECTIONS_PER_DAY). Cột thêm ở migration 0012. */
  quotaDirectionsPerDay: number | null;
}

const KV_TTL_S = 300;
/** TTL cache âm: ngắn hơn cache dương để khoá vừa cấp dùng được trong vòng một phút. 60 s cũng là
 * mức tối thiểu Cloudflare KV chấp nhận cho `expirationTtl`. */
const KV_TTL_MISS_S = 60;

/** Entry KV đánh dấu "đã tra, không có khoá này" — phân biệt với AuthInfo bằng cờ `notFound`. */
interface NotFoundEntry {
  notFound: true;
}

/**
 * Dạng khoá cấp ra (`scripts/lib/api-key.mjs` KEY_RE): `mlv_live_` + 24 ký tự [0-9A-Za-z].
 *
 * Dùng làm cổng chặn TRƯỚC khi chạm KV/Postgres. Trước 13/09/2026 mọi chuỗi bất kỳ trong header
 * `X-Api-Key` đều đi thẳng xuống DB: KV không bao giờ cache kết quả âm, còn bộ giới hạn tần suất
 * nằm trong `quotaMiddleware` chạy SAU `requireAuth`, nên request khoá rác không bị chặn ở đâu cả
 * và mỗi lần là một kết nối Hyperdrive + một truy vấn vào Postgres máy chủ nhà. Khoá `web` vốn
 * công khai nên giá trị khoá lưu hành rộng; đây là đường rẻ nhất để làm nghẽn DB.
 */
export function isApiKeyFormat(key: string): boolean {
  return /^mlv_live_[0-9A-Za-z]{24}$/.test(key);
}

/** Hyperdrive dùng `fetch_types: false`, vì vậy PostgreSQL text[] có thể về dạng `{a,b}`. */
export function normalizeTextArray(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  if (value === '{}') return [];
  if (!value.startsWith('{') || !value.endsWith('}')) return [value];
  return value
    .slice(1, -1)
    .split(',')
    .map((item) => item.replace(/^"|"$/g, '').replace(/\\([\\"])/g, '$1'));
}

/**
 * Khớp Origin/Referer với allowed_origins: so protocol + hostname (mọi port),
 * hỗ trợ wildcard subdomain `https://*.example.com` (khớp cả example.com).
 */
export function originAllowed(origin: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  for (const pattern of allowed) {
    let allowedUrl: URL;
    try {
      allowedUrl = new URL(pattern.replace('*.', 'any-sub.'));
    } catch {
      continue;
    }
    if (allowedUrl.protocol !== url.protocol) continue;
    if (pattern.includes('*.')) {
      const suffix = allowedUrl.hostname.replace(/^any-sub\./, '');
      if (url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)) return true;
    } else if (allowedUrl.hostname === url.hostname) {
      return true;
    }
  }
  return false;
}

interface ApiKeyRow {
  key_hash: string;
  key_prefix: string;
  kind: AuthInfo['kind'];
  scopes: string[] | string;
  allowed_origins: string[] | string;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
  tenant_id: string;
  plan: AuthInfo['plan'];
}

/**
 * `quota_directions_per_day` đọc qua `to_jsonb(k) ->> …` thay vì tham chiếu cột: Postgres phân giải
 * cột lúc parse, nên tham chiếu trực tiếp sẽ làm MỌI request có khoá 503 nếu Worker deploy trước
 * migration 0012 (sự cố 06–07/09/2026). Cột chưa có → NULL → dùng mặc định plan.
 */
export function selectApiKey(sql: ReturnType<typeof getSql>, keyHash: string) {
  return sql<ApiKeyRow[]>`SELECT k.key_hash, k.key_prefix, k.kind, k.scopes, k.allowed_origins,
        k.quota_places_per_day,
        (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day,
        t.id AS tenant_id, t.plan
      FROM api_key k JOIN tenant t ON t.id = k.tenant_id
      WHERE k.key_hash = ${keyHash} AND k.active AND k.revoked_at IS NULL`;
}

async function loadAuth(c: Context<AppEnv>, key: string): Promise<AuthInfo | null> {
  const keyHash = await sha256Hex(key);
  const kvKey = `apikey:${keyHash}`;
  const cached = await c.env.META.get<AuthInfo | NotFoundEntry>(kvKey, 'json');
  if (cached) {
    if ((cached as NotFoundEntry).notFound === true) return null;
    const info = cached as AuthInfo;
    return {
      ...info,
      scopes: normalizeTextArray(info.scopes as string[] | string),
      allowedOrigins: normalizeTextArray(info.allowedOrigins as string[] | string),
      quotaDirectionsPerDay: info.quotaDirectionsPerDay ?? null,
    };
  }

  const sql = getSql(c.env);
  try {
    const [row] = await selectApiKey(sql, keyHash);
    // Cache cả kết quả âm: khoá đúng định dạng nhưng không có trong DB (đã thu hồi, gõ nhầm, hoặc
    // dò bằng khoá ngẫu nhiên) nếu không cache thì mỗi request là một truy vấn vào Postgres.
    if (!row) {
      c.executionCtx.waitUntil(
        c.env.META.put(kvKey, JSON.stringify({ notFound: true } satisfies NotFoundEntry), {
          expirationTtl: KV_TTL_MISS_S,
        }),
      );
      return null;
    }

    const info: AuthInfo = {
      keyHash: row.key_hash,
      keyPrefix: row.key_prefix,
      tenantId: row.tenant_id,
      plan: row.plan,
      kind: row.kind,
      scopes: normalizeTextArray(row.scopes),
      allowedOrigins: normalizeTextArray(row.allowed_origins),
      quotaPlacesPerDay: row.quota_places_per_day,
      quotaDirectionsPerDay: row.quota_directions_per_day,
    };
    c.executionCtx.waitUntil(
      c.env.META.put(kvKey, JSON.stringify(info), { expirationTtl: KV_TTL_S }),
    );
    return info;
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
}

/** Middleware cho các route places/edits: 401 thiếu/sai khoá, 403 sai origin/scope. */
export function requireAuth(scope = 'places:read') {
  return async (c: Context<AppEnv>, next: Next) => {
    // Chỉ nhận header: khoá trên URL lọt vào log CDN, Referer và cache trung gian.
    const key = c.req.header('X-Api-Key');
    if (!key) {
      throw new ApiError(401, 'missing_key', 'Thiếu khoá API (header X-Api-Key)');
    }
    // Chặn trước KV/DB. Cùng mã lỗi với khoá không tồn tại: người gọi không cần biết mình trượt ở
    // bước định dạng hay bước tra cứu.
    if (!isApiKeyFormat(key)) {
      throw new ApiError(401, 'invalid_key', 'Khoá API không hợp lệ hoặc đã thu hồi');
    }

    let info: AuthInfo | null;
    try {
      info = await loadAuth(c, key);
    } catch (err) {
      console.error('auth', err);
      throw new ApiError(503, 'upstream_unavailable', 'Không tra được khoá API');
    }
    if (!info) {
      throw new ApiError(401, 'invalid_key', 'Khoá API không hợp lệ hoặc đã thu hồi');
    }
    if (!info.scopes.includes(scope)) {
      throw new ApiError(403, 'scope', `Khoá không có scope ${scope}`);
    }
    if (info.kind === 'web') {
      const origin = c.req.header('Origin') ?? c.req.header('Referer') ?? '';
      // Khoá web nằm trong HTML của khách nên coi như công khai. Đọc: không có Origin (curl,
      // server-side) vẫn cho qua ở MVP. GHI (edits:write): bắt buộc Origin hợp lệ — nếu không, ai
      // lấy khoá từ trang nhúng cũng gửi được edit từ máy lạ (audit 09/09/2026).
      if (!origin && scope === 'edits:write') {
        throw new ApiError(403, 'origin_required', 'Khoá web ghi edit phải gửi từ trang có Origin');
      }
      if (origin && !originAllowed(origin, info.allowedOrigins)) {
        throw new ApiError(403, 'origin_not_allowed', 'Origin không nằm trong allowed_origins');
      }
    }
    if (info.kind === 'mobile') {
      const bundle = c.req.header('X-Bundle-Id');
      // Kiểm mềm (spec 6.4): log theo tenant, không ghi khoá API ra log.
      if (bundle) console.log('bundle-id', info.tenantId, bundle);
    }
    c.set('auth', info);
    await next();
  };
}
