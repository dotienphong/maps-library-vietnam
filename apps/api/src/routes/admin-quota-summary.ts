import { Hono } from 'hono';
import { type KhoaQuota, legacyUsageForKeys, type MucDungNhom } from '../billing/legacy-usage';
import { quotaObject } from '../billing/object';
import { cachedJson } from '../cache';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../errors';

type WaitUntil = { waitUntil(promise: Promise<unknown>): void };

/** Trần tenant đọc trong một lần. Trang đích không phải chỗ quét cả cơ sở khách hàng. */
const MAX_TENANTS = 25;
/** Trần khoá mỗi tenant: mỗi khoá tốn hai lượt đọc KV. */
const MAX_KEYS = 50;
/** Ngưỡng "đáng chú ý" của phần trăm hạn mức. */
export const NGUONG_CANH_BAO = 80;
const CACHE_SEC = 60;
const CACHE_URL = 'https://cache.mapslibvn/admin-quota-summary';

/**
 * Phần trăm hạn mức ngày đã dùng, lấy nhóm cao hơn trong hai nhóm. Cắt ở 100 và coi hạn mức 0 là
 * 0%: tenant `internal` cố ý không đếm lượt, chia cho 0 ra Infinity và ô số liệu sẽ hiện chữ đó.
 */
export function phanTram(places: MucDungNhom, directions: MucDungNhom): number {
  const mot = (g: MucDungNhom) => (g.limit > 0 ? Math.min(100, (g.used / g.limit) * 100) : 0);
  return Math.round(Math.max(mot(places), mot(directions)));
}

interface TenantRow {
  id: string;
  name: string;
  quota_mode: 'legacy' | 'commercial';
}

async function docTenant(
  env: Env,
  ctx: WaitUntil,
): Promise<{ rows: TenantRow[]; truncated: boolean }> {
  const sql = getSql(env);
  try {
    const rows = await sql<TenantRow[]>`
      SELECT t.id::text AS id, t.name,
             -- to_jsonb thay vì tham chiếu cột: Postgres phân giải cột ngay lúc parse, nên Worker
             -- deploy trước một migration thêm cột sẽ làm hỏng CẢ câu (sự cố 06/09/2026).
             coalesce(to_jsonb(t) ->> 'quota_mode', 'legacy') AS quota_mode
      FROM tenant t
      ORDER BY t.created_at DESC
      LIMIT ${MAX_TENANTS + 1}`;
    return { rows: rows.slice(0, MAX_TENANTS), truncated: rows.length > MAX_TENANTS };
  } finally {
    endSql(ctx, sql);
  }
}

async function khoaCuaTenant(env: Env, ctx: WaitUntil, tenantId: string): Promise<KhoaQuota[]> {
  const sql = getSql(env);
  try {
    return await sql<KhoaQuota[]>`
      SELECT k.key_hash, k.key_prefix, k.label, k.quota_places_per_day,
             (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day
      FROM api_key k
      WHERE k.tenant_id = ${tenantId}::uuid AND k.active AND k.revoked_at IS NULL
      ORDER BY k.created_at
      LIMIT ${MAX_KEYS}`;
  } finally {
    endSql(ctx, sql);
  }
}

async function mucDung(
  env: Env,
  ctx: WaitUntil,
  tenant: TenantRow,
): Promise<{ places: MucDungNhom; directions: MucDungNhom }> {
  if (tenant.quota_mode === 'commercial') {
    const usage = await quotaObject(env, tenant.id).readUsage();
    return {
      places: { used: usage.places.used, limit: usage.places.limit },
      directions: { used: usage.directions.used, limit: usage.directions.limit },
    };
  }
  // Nhánh legacy KHÔNG được chạm Durable Object: readUsage() TẠO sổ quota cho tenant chưa có, và
  // một lần mở trang chủ không phải lý do để đẻ ra sổ.
  const keys = await khoaCuaTenant(env, ctx, tenant.id);
  const { total } = await legacyUsageForKeys(env, keys);
  return total;
}

export const adminQuotaSummary = new Hono<AppEnv>();

adminQuotaSummary.get('/v1/admin/quota-summary', async (c) => {
  const response = await cachedJson(c.executionCtx, CACHE_URL, CACHE_SEC, CACHE_SEC, async () => {
    const { rows, truncated } = await docTenant(c.env, c.executionCtx);
    const items = await Promise.all(
      rows.map(async (tenant) => {
        try {
          const { places, directions } = await mucDung(c.env, c.executionCtx, tenant);
          return {
            tenant_id: tenant.id,
            name: tenant.name,
            quota_mode: tenant.quota_mode,
            places,
            directions,
            pct: phanTram(places, directions),
          };
        } catch (error) {
          // Một tenant hỏng sổ không được làm mất số của những tenant còn lại.
          console.error('quota-summary tenant', tenant.id, error);
          return null;
        }
      }),
    );
    const tenants = items.filter((item) => item !== null);
    return {
      computed_at: new Date().toISOString(),
      truncated,
      tenants: tenants.sort((a, b) => b.pct - a.pct),
      above: tenants.filter((t) => t.pct >= NGUONG_CANH_BAO).length,
    };
  }).catch((error: unknown) => {
    if (error instanceof ApiError) throw error;
    console.error('admin/quota-summary', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được mức dùng hạn mức');
  });

  const out = new Response(response.body, response);
  // cachedJson lưu bằng `public, max-age` (bắt buộc, nếu không Cache API không nhận). Đổi lại SAU
  // khi đã put, nếu không số liệu khách hàng nằm trong cache trình duyệt.
  out.headers.set('cache-control', 'private, no-store');
  return out;
});
