import { Hono } from 'hono';
import { queryAnalytics } from '../analytics-sql';
import { cachedJson } from '../cache';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';
import {
  type Khoang,
  type MetricsWindow,
  parseWindow,
  routeSql,
  soAe,
  tenantSql,
  windowRange,
} from './admin-metrics-sql';

/** Cache 5 phút mỗi cửa sổ. Quét lại Analytics cho mỗi lần bấm F5 là tốn tiền mà không thêm tin. */
const CACHE_SEC = 300;
const cacheUrl = (window: MetricsWindow): string =>
  `https://cache.mapslibvn/admin-metrics?window=${window}`;

interface DongRouteTho {
  route: string;
  requests: string | number;
  errors_5xx: string | number;
  quota_429: string | number;
  p95_ms: string | number;
}
interface DongTenantTho extends Omit<DongRouteTho, 'route'> {
  tenant_id: string;
}

/**
 * Nhãn tenant để người trực đọc được tên thay vì uuid. Bảng `tenant` chỉ có vài dòng nên đọc cả
 * bảng: `WHERE id = ANY(...)` phải bind mảng, mà bind mảng + ::uuid[] đã từng vỡ trên production
 * trong khi unit test vẫn xanh. Hỏng lời gọi này KHÔNG được làm hỏng cả trang — mất nhãn thôi.
 */
async function nhanTenant(env: Env, ctx: ExecutionContext): Promise<Record<string, string>> {
  const sql = getSql(env);
  try {
    const rows = await sql<{ id: string; name: string }[]>`
      SELECT id::text AS id, name FROM tenant`;
    return Object.fromEntries(rows.map((r) => [r.id, r.name]));
  } catch (error) {
    console.error('admin/metrics nhãn tenant', error);
    return {};
  } finally {
    endSql(ctx, sql);
  }
}

async function tinhSoLieu(env: Env, ctx: ExecutionContext, khoang: Khoang) {
  const [routes, tenants, nhan] = await Promise.all([
    queryAnalytics<DongRouteTho>(env, routeSql(khoang)),
    queryAnalytics<DongTenantTho>(env, tenantSql(khoang)),
    nhanTenant(env, ctx),
  ]);

  return {
    computed_at: new Date().toISOString(),
    routes: routes.map((r) => ({
      route: r.route,
      requests: soAe(r.requests),
      errors_5xx: soAe(r.errors_5xx),
      quota_429: soAe(r.quota_429),
      p95_ms: Math.round(soAe(r.p95_ms)),
    })),
    tenants: tenants.map((r) => ({
      tenant_id: r.tenant_id,
      ten: nhan[r.tenant_id] ?? null,
      requests: soAe(r.requests),
      errors_5xx: soAe(r.errors_5xx),
      quota_429: soAe(r.quota_429),
      p95_ms: Math.round(soAe(r.p95_ms)),
    })),
  };
}

export const adminMetrics = new Hono<AppEnv>();

adminMetrics.get('/v1/admin/metrics', async (c) => {
  const window = parseWindow(new URL(c.req.url).searchParams.get('window'));
  const khoang = windowRange(window, new Date());

  // `cachedJson` lưu vào Cache API với `cache-control: public` — bắt buộc phải công khai thì Cache
  // API mới nhận. Header trả cho TRÌNH DUYỆT thì đổi lại thành private/no-store, và đổi SAU khi
  // cachedJson đã put xong, không phải trước.
  const response = await cachedJson(c.executionCtx, cacheUrl(window), CACHE_SEC, CACHE_SEC, () =>
    tinhSoLieu(c.env, c.executionCtx, khoang),
  ).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    console.error('admin/metrics', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được số liệu');
  });

  const out = new Response(response.body, response);
  out.headers.set('cache-control', 'private, no-store');
  // `window` không nằm trong phần được cache: nó là câu hỏi, không phải câu trả lời.
  out.headers.set('x-mlv-window', window);
  return out;
});
