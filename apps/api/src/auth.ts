import type { Context, Next } from 'hono';
import { getSql } from './db';
import type { AppEnv } from './env';
import { ApiError } from './errors';

export interface AuthInfo {
  key: string;
  tenantId: string;
  plan: 'internal' | 'free' | 'paid';
  kind: 'web' | 'mobile' | 'server';
  scopes: string[];
  allowedOrigins: string[];
  quotaPlacesPerDay: number | null;
}

const KV_TTL_S = 300;

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

async function loadAuth(c: Context<AppEnv>, key: string): Promise<AuthInfo | null> {
  const kvKey = `apikey:${key}`;
  const cached = await c.env.META.get<AuthInfo>(kvKey, 'json');
  if (cached) return cached;

  const sql = getSql(c.env);
  try {
    const [row] = await sql<
      {
        key: string;
        kind: AuthInfo['kind'];
        scopes: string[];
        allowed_origins: string[];
        quota_places_per_day: number | null;
        tenant_id: string;
        plan: AuthInfo['plan'];
      }[]
    >`SELECT k.key, k.kind, k.scopes, k.allowed_origins, k.quota_places_per_day,
        t.id AS tenant_id, t.plan
      FROM api_key k JOIN tenant t ON t.id = k.tenant_id
      WHERE k.key = ${key} AND k.active AND k.revoked_at IS NULL`;
    if (!row) return null;

    const info: AuthInfo = {
      key: row.key,
      tenantId: row.tenant_id,
      plan: row.plan,
      kind: row.kind,
      scopes: row.scopes,
      allowedOrigins: row.allowed_origins,
      quotaPlacesPerDay: row.quota_places_per_day,
    };
    c.executionCtx.waitUntil(
      c.env.META.put(kvKey, JSON.stringify(info), { expirationTtl: KV_TTL_S }),
    );
    return info;
  } finally {
    c.executionCtx.waitUntil(sql.end({ timeout: 1 }));
  }
}

/** Middleware cho các route places: 401 thiếu/sai khoá, 403 sai origin/scope. */
export function requireAuth() {
  return async (c: Context<AppEnv>, next: Next) => {
    const key = c.req.header('X-Api-Key') ?? c.req.query('key');
    if (!key) {
      throw new ApiError(401, 'missing_key', 'Thiếu khoá API (header X-Api-Key hoặc ?key=)');
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
    if (!info.scopes.includes('places:read')) {
      throw new ApiError(403, 'scope', 'Khoá không có scope places:read');
    }
    if (info.kind === 'web') {
      const origin = c.req.header('Origin') ?? c.req.header('Referer') ?? '';
      // Không có Origin (curl, server-side) thì cho qua ở MVP — khoá web vốn không phải bí mật.
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
