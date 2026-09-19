import { Hono } from 'hono';
import { legacyUsageForKeys } from '../billing/legacy-usage';
import { quotaObject } from '../billing/object';
import { endSql, getSql } from '../db';
import type { AppEnv, Env } from '../env';

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

/** Trần số khoá đọc trong một lần: mỗi khoá tốn hai lượt đọc KV, đừng để một tenant lạ làm nổ. */
const MAX_KEYS = 50;

interface KeyRow {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
}

interface BillingReadDependencies {
  tenantInfo?: (tenantId: string, env: Env) => Promise<{ plan: string } | null>;
  tenantKeys?: (tenantId: string, env: Env) => Promise<KeyRow[]>;
}

async function tenantInfoTuDb(
  tenantId: string,
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
) {
  const sql = getSql(env);
  try {
    const rows = await sql<
      { plan: string }[]
    >`SELECT plan FROM tenant WHERE id = ${tenantId}::uuid`;
    return rows[0] ?? null;
  } finally {
    endSql(executionCtx, sql);
  }
}

async function tenantKeysTuDb(
  tenantId: string,
  env: Env,
  executionCtx: { waitUntil(promise: Promise<unknown>): void },
) {
  const sql = getSql(env);
  try {
    // `quota_directions_per_day` đọc qua to_jsonb thay vì tham chiếu cột: Postgres phân giải cột
    // ngay lúc parse, nên Worker deploy trước migration thêm cột sẽ làm hỏng CẢ câu (sự cố 06/09).
    return await sql<KeyRow[]>`
      SELECT k.key_hash, k.key_prefix, k.label, k.quota_places_per_day,
             (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day
      FROM api_key k
      WHERE k.tenant_id = ${tenantId}::uuid AND k.active AND k.revoked_at IS NULL
      ORDER BY k.created_at
      LIMIT ${MAX_KEYS}`;
  } finally {
    endSql(executionCtx, sql);
  }
}

/**
 * Hai route CHỈ ĐỌC của nhóm billing, dạng nhà máy để test tiêm được cổng đọc Postgres
 * (apps/api/test/** không có DB). Mount BÊN TRONG `billingAdmin()` nên hưởng đúng middleware kiểm
 * tenant tồn tại, và ở index.ts cả tiền tố đã nằm sau requireSameSiteGhi() + requireBillingAccess().
 */
export function billingReadWith(dependencies: BillingReadDependencies = {}) {
  const routes = new Hono<AppEnv>();

  routes.get('/v1/admin/billing/:tenantId/periods', async (c) => {
    const limit = Number(c.req.query('limit') ?? '24');
    const history = await quotaObject(c.env, c.req.param('tenantId')).readPeriods(limit);
    return c.json(history, 200, NO_STORE);
  });

  /**
   * Mức dùng HÔM NAY của tenant chưa bật chế độ thương mại. Nguồn là bộ đếm xấp xỉ trong KV
   * (`quota:<key_hash>:<ngày VN>:<nhóm>`, TTL hai ngày) — thứ duy nhất tồn tại cho nhóm này, vì
   * sổ Durable Object chỉ ghi cho tenant `commercial`. Đọc route này KHÔNG tạo sổ quota.
   */
  routes.get('/v1/admin/billing/:tenantId/legacy-usage', async (c) => {
    const tenantId = c.req.param('tenantId');
    try {
      const tenant = dependencies.tenantInfo
        ? await dependencies.tenantInfo(tenantId, c.env)
        : await tenantInfoTuDb(tenantId, c.env, c.executionCtx);
      const keys = dependencies.tenantKeys
        ? await dependencies.tenantKeys(tenantId, c.env)
        : await tenantKeysTuDb(tenantId, c.env, c.executionCtx);

      const { day, keys: items, total } = await legacyUsageForKeys(c.env, keys);

      return c.json(
        {
          day,
          quotaEnabled: c.env.QUOTA_ENABLED === '1',
          plan: tenant?.plan ?? 'free',
          // Tenant internal cố ý không tốn lượt ghi KV (Workers Free giới hạn 1.000 ghi/ngày),
          // nên số 0 ở đây là thiết kế chứ không phải khách không dùng.
          counted: (tenant?.plan ?? 'free') !== 'internal',
          blockAtMultiple: 2,
          keys: items,
          total,
        },
        200,
        NO_STORE,
      );
    } catch (error) {
      console.error('billing legacy-usage', error);
      return c.json({ error: { code: 'upstream_unavailable' } }, 503);
    }
  });

  return routes;
}

/** Bản dùng ở production, không tiêm gì. */
export const billingRead = billingReadWith();
