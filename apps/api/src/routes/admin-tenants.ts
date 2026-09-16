import { Hono } from 'hono';
import { apiKeyPrefix, generateApiKey } from '../api-key';
import { audit } from '../audit';
import { normalizeTextArray } from '../auth';
import { endSql, getSql } from '../db';
import { sha256Hex } from '../edits/hash';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { textArray } from '../geocode';
import {
  encodeTenantCursor,
  parseNewKeyBody,
  parseTenantListParams,
  tenantId,
} from './admin-tenant-params';

/**
 * Nhóm route tenant/khoá API. KHÔNG khai middleware ở đây: router này được mount vào app `admin`,
 * nên nó nằm sau đúng một chỗ khai quyền (`/v1/admin/*`: chống CSRF rồi `requireAccess()`). Thêm
 * route mới vào file này không thể quên gắn cổng.
 */
export const adminTenants = new Hono<AppEnv>();

interface TenantRow {
  id: string;
  name: string;
  plan: string;
  quota_mode: string;
  created_at: string;
  active_keys: number;
}

interface KeyRow {
  key_hash: string;
  key_prefix: string;
  label: string | null;
  kind: string;
  scopes: string[] | string;
  allowed_origins: string[] | string;
  allowed_bundle_ids: string[] | string;
  quota_places_per_day: number | null;
  quota_directions_per_day: number | null;
  active: boolean;
  created_at: string;
  revoked_at: string | null;
}

const NO_STORE = { 'cache-control': 'private, no-store' } as const;

adminTenants.get('/v1/admin/tenants', async (c) => {
  const params = parseTenantListParams(new URL(c.req.url).searchParams);
  const createdAt = params.cursor?.createdAt ?? null;
  const cursorId = params.cursor?.id ?? null;
  const sql = getSql(c.env);
  try {
    // Lấy dư một bản ghi để biết còn trang sau hay không, giống danh sách đóng góp — không đếm
    // tổng, vì con số đó không giúp gì cho người đang tìm một tenant.
    const rows = await sql<TenantRow[]>`
      SELECT t.id, t.name, t.plan, t.quota_mode, t.created_at,
             count(k.key_hash) FILTER (WHERE k.active AND k.revoked_at IS NULL)::int AS active_keys
      FROM tenant t
      LEFT JOIN api_key k ON k.tenant_id = t.id
      WHERE (${params.q}::text IS NULL OR t.name ILIKE '%' || ${params.q} || '%')
        AND (${createdAt}::timestamptz IS NULL
             OR (t.created_at, t.id) < (${createdAt}::timestamptz, ${cursorId}::uuid))
      GROUP BY t.id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${params.limit + 1}`;

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    const last = items.at(-1);
    return c.json(
      {
        items,
        nextCursor: hasMore && last ? encodeTenantCursor(last.created_at, last.id) : null,
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/tenants', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được danh sách tenant');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

adminTenants.get('/v1/admin/tenants/:id', async (c) => {
  const id = tenantId(c.req.param('id'));
  const sql = getSql(c.env);
  try {
    const [tenant] = await sql<TenantRow[]>`
      SELECT t.id, t.name, t.plan, t.quota_mode, t.created_at,
             count(k.key_hash) FILTER (WHERE k.active AND k.revoked_at IS NULL)::int AS active_keys
      FROM tenant t
      LEFT JOIN api_key k ON k.tenant_id = t.id
      WHERE t.id = ${id}::uuid
      GROUP BY t.id`;
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tenant này');

    // `quota_directions_per_day` đọc qua to_jsonb thay vì tham chiếu cột: Postgres phân giải cột
    // ngay lúc parse, nên tham chiếu trực tiếp làm hỏng CẢ câu nếu Worker deploy trước migration
    // thêm cột (sự cố 06–07/09/2026). Giữ đúng lối viết của selectApiKey trong auth.ts.
    const keys = await sql<KeyRow[]>`
      SELECT k.key_hash, k.key_prefix, k.label, k.kind, k.scopes, k.allowed_origins,
             k.allowed_bundle_ids, k.quota_places_per_day,
             (to_jsonb(k) ->> 'quota_directions_per_day')::int AS quota_directions_per_day,
             k.active, k.created_at, k.revoked_at
      FROM api_key k
      WHERE k.tenant_id = ${id}::uuid
      ORDER BY k.created_at DESC, k.key_hash`;

    return c.json(
      {
        tenant,
        // Hyperdrive chạy `fetch_types: false` nên text[] có thể về dưới dạng chuỗi `{a,b}`.
        // Chỉ lộ ra trên DB thật; test không DB không bao giờ thấy.
        keys: keys.map((key) => ({
          ...key,
          scopes: normalizeTextArray(key.scopes),
          allowed_origins: normalizeTextArray(key.allowed_origins),
          allowed_bundle_ids: normalizeTextArray(key.allowed_bundle_ids),
        })),
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/tenants/:id', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được chi tiết tenant');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

adminTenants.post('/v1/admin/tenants/:id/keys', async (c) => {
  const id = tenantId(c.req.param('id'));
  const input = parseNewKeyBody(await c.req.json().catch(() => null));

  // Sinh và băm TRƯỚC khi mở kết nối: khoá rõ không bao giờ rời hàm này ngoài phản hồi cuối cùng.
  const key = generateApiKey();
  const keyHash = await sha256Hex(key);
  const keyPrefix = apiKeyPrefix(key);

  const sql = getSql(c.env);
  try {
    const [tenant] = await sql<{ name: string }[]>`
      SELECT name FROM tenant WHERE id = ${id}::uuid`;
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tenant này');

    // Ba cột mảng đi qua `textArray`: bind mảng JS rồi cast ::text[] thì bản postgres/cf trong
    // Workers nối thành "a,b" và Postgres ném `malformed array literal` — chỉ vỡ trên production
    // và ở test:api-db, unit test không DB luôn xanh.
    await sql`
      INSERT INTO api_key
        (key_hash, key_prefix, tenant_id, label, kind,
         allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day)
      VALUES (${keyHash}, ${keyPrefix}, ${id}::uuid, ${input.label}, ${input.kind},
              ${textArray(sql, input.allowedOrigins)}, ${textArray(sql, input.allowedBundleIds)},
              ${textArray(sql, input.scopes)}, ${input.quotaDirectionsPerDay})`;

    // Cache âm của auth sống 60 giây. Ai đó vừa thử đúng chuỗi này (hoặc một lần thử trước đó
    // trong cùng phút) là khoá mới chết oan tới một phút; xoá luôn cho chắc.
    await c.env.META.delete(`apikey:${keyHash}`);

    // `detail` KHÔNG bao giờ chứa khoá rõ — spec mục 10. key_hash là định danh đủ để lần lại.
    audit(c, 'tenant.key_issue', keyHash, {
      tenant_id: id,
      key_prefix: keyPrefix,
      kind: input.kind,
      scopes: input.scopes,
      label: input.label,
    });

    return c.json({ key, key_prefix: keyPrefix, key_hash: keyHash, tenant_id: id }, 201, NO_STORE);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/tenants/:id/keys', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không cấp được khoá');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
