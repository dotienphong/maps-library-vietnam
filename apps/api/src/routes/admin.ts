import { type Context, Hono, type Next } from 'hono';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { invalidateCachedJson, placeCacheUrl } from '../cache';
import { endSql, getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError } from '../errors';
import { adminAudit } from './admin-audit';
import { adminCatalog } from './admin-catalog';
import { parseEditListParams } from './admin-edit-params';
import { adminTenants } from './admin-tenants';

export const admin = new Hono<AppEnv>();

/**
 * Chống CSRF cho POST (audit 09/09/2026): Access chèn JWT từ cookie, nên một trang lạ có thể ép
 * trình duyệt của người duyệt gửi POST approve/reject nếu cookie đi cross-site. Chặn khi trình duyệt
 * khai `Sec-Fetch-Site: cross-site` hoặc `Origin` không khớp origin của API. Đứng TRƯỚC requireAccess.
 *
 * Xuất khẩu vì nhóm billing mount ở index.ts NGOÀI app này (nó phải nằm trước để giữ
 * requireBillingAccess), nên chỗ đó phải gắn lại cổng bằng chính hàm này — không chép lại logic.
 */
export function requireSameSitePost() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (c.req.method === 'POST') {
      const site = c.req.header('Sec-Fetch-Site');
      const origin = c.req.header('Origin');
      const self = new URL(c.req.url).origin;
      if (site === 'cross-site' || (origin && origin !== self)) {
        throw new ApiError(
          403,
          'cross_site_request',
          'POST admin phải xuất phát từ chính trang admin',
        );
      }
    }
    await next();
  };
}

admin.use('/v1/admin/*', requireSameSitePost());
admin.use('/v1/admin/*', requireAccess());

// Mount SAU hai middleware trên: nhóm tenant hưởng đúng cổng chống CSRF và Access đã khai một
// lần ở đây, thay vì mỗi file route tự nhớ gắn lại.
admin.route('/', adminTenants);
admin.route('/', adminAudit);
admin.route('/', adminCatalog);

/**
 * Danh sách quyền để giao diện biết vẽ những mục nào. Giai đoạn này hệ thống chưa phân quyền
 * (một người quản lý), nên ai qua được Access đều nhận đủ quyền. Hợp đồng đã có sẵn chỗ để thêm
 * vai trò sau mà không phải đổi giao diện — xem mục 9 của spec trang Admin.
 */
const ALL_PERMISSIONS = [
  'edits.read',
  'edits.write',
  'tenants.read',
  'tenants.write',
  'billing.read',
  'billing.write',
  'health.read',
  'audit.read',
] as const;

admin.get('/v1/admin/me', (c) =>
  c.json({ email: c.get('reviewer') ?? '', permissions: [...ALL_PERMISSIONS] }, 200, {
    'cache-control': 'private, no-store',
  }),
);

admin.get('/v1/admin/edits', async (c) => {
  const params = parseEditListParams(new URL(c.req.url).searchParams);
  const sql = getSql(c.env);
  try {
    // Lấy dư một bản ghi để biết còn trang sau hay không, thay vì đếm tổng — đếm tổng trên bảng
    // đóng góp là quét toàn phần, còn người duyệt chỉ cần biết "còn nữa không".
    const rows = await sql`
      SELECT e.id::int AS id, e.poi_id, e.kind, e.changes, e.photo_url, e.note, e.status,
             e.reviewer, e.reviewed_at, e.created_at, e.tenant_id,
             p.name AS poi_name, p.status AS poi_status,
             p.ward AS poi_ward, p.province AS poi_province,
             -- Chỉ kind=update mới có khái niệm dời vị trí. Với create, POI đã được dựng sẵn ở
             -- trạng thái pending ngay lúc gửi nên khoảng cách luôn bằng 0 và nhãn sẽ gây hiểu nhầm.
             CASE WHEN e.kind = 'update' AND e.changes ? 'lat' AND p.geom IS NOT NULL
                  THEN round(ST_DistanceSphere(
                         p.geom,
                         ST_SetSRID(ST_MakePoint((e.changes->>'lng')::float8,
                                                 (e.changes->>'lat')::float8), 4326))::numeric)::int
             END AS distance_m
      FROM poi_edit e LEFT JOIN poi p ON p.id = e.poi_id
      WHERE e.status = ${params.status}
        AND (${params.kind}::text IS NULL OR e.kind = ${params.kind})
        AND (${params.tenantId}::uuid IS NULL OR e.tenant_id = ${params.tenantId}::uuid)
        AND (${params.q}::text IS NULL OR p.name ILIKE '%' || ${params.q} || '%'
             OR e.changes->>'name' ILIKE '%' || ${params.q} || '%')
        AND (${params.cursor}::int IS NULL OR e.id < ${params.cursor}::int)
      ORDER BY e.id DESC
      LIMIT ${params.limit + 1}`;

    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    const last = items.at(-1);
    return c.json({ items, nextCursor: hasMore && last ? Number(last.id) : null }, 200, {
      'cache-control': 'private, no-store',
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/edits', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không truy vấn được DB');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

admin.get('/v1/admin/edits/count', async (c) => {
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM poi_edit WHERE status = 'pending'`;
    return c.json({ pending: row?.count ?? 0 }, 200, { 'cache-control': 'private, no-store' });
  } catch (error) {
    console.error('admin/edits/count', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đếm được đóng góp chờ duyệt');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

const editId = (raw: string | undefined): number => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw new ApiError(400, 'invalid_request', 'id edit không hợp lệ');
  return id;
};

const NEARBY_RADIUS_M = 200;
const NEARBY_LIMIT = 10;
const BULK_MAX = 50;

admin.get('/v1/admin/edits/:id', async (c) => {
  const id = editId(c.req.param('id'));
  const sql = getSql(c.env);
  try {
    const [row] = await sql`
      SELECT to_jsonb(e) - 'ip_hash' - 'end_user_hash' AS edit,
             CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
               'id', p.id, 'name', p.name, 'category', p.category, 'status', p.status,
               'housenumber', p.housenumber, 'street', p.street, 'ward', p.ward,
               'province', p.province, 'address_text', p.address_text,
               'contact', p.contact, 'hours', p.hours,
               'lat', ST_Y(p.geom), 'lng', ST_X(p.geom)) END AS poi_hien_tai,
             -- Chỉ kind=update mới có khái niệm dời vị trí. Với create, POI đã được dựng sẵn ở
             -- trạng thái pending ngay lúc gửi nên khoảng cách luôn bằng 0 và nhãn sẽ gây hiểu nhầm.
             CASE WHEN e.kind = 'update' AND e.changes ? 'lat' AND p.geom IS NOT NULL
                  THEN round(ST_DistanceSphere(
                         p.geom,
                         ST_SetSRID(ST_MakePoint((e.changes->>'lng')::float8,
                                                 (e.changes->>'lat')::float8), 4326))::numeric)::int
             END AS distance_m
      FROM poi_edit e LEFT JOIN poi p ON p.id = e.poi_id
      WHERE e.id = ${id}::bigint`;

    if (!row) throw new ApiError(404, 'not_found', 'Không có đóng góp này');

    // POI lân cận chỉ có nghĩa với `create`: câu hỏi của người duyệt lúc đó là "chỗ này đã có POI
    // nào chưa", tức là bắt trùng lặp. Các loại khác đã có POI đích rồi.
    const edit = row.edit as { kind: string; changes: Record<string, unknown> | null };
    let nearby: readonly unknown[] = [];
    if (edit.kind === 'create' && edit.changes && 'lat' in edit.changes) {
      const lat = Number(edit.changes.lat);
      const lng = Number(edit.changes.lng);
      nearby = await sql`
        SELECT p.id, p.name, p.category, ST_Y(p.geom) AS lat, ST_X(p.geom) AS lng,
               round(ST_DistanceSphere(p.geom,
                 ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326))::numeric)::int
                 AS distance_m
        FROM poi p
        WHERE p.status = 'active'
          AND ST_DWithin(p.geom::geography,
                ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography,
                ${NEARBY_RADIUS_M})
        ORDER BY distance_m
        LIMIT ${NEARBY_LIMIT}`;
    }

    return c.json(
      {
        edit: row.edit,
        poi_hien_tai: row.poi_hien_tai,
        distance_m: row.distance_m ?? null,
        nearby,
      },
      200,
      { 'cache-control': 'private, no-store' },
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/edits/:id', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được chi tiết đóng góp');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

admin.post('/v1/admin/edits/bulk', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { ids?: unknown; action?: unknown } | null;
  const action = body?.action;
  if (action !== 'approve' && action !== 'reject')
    throw new ApiError(400, 'invalid_request', 'action phải là approve hoặc reject');
  if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > BULK_MAX)
    throw new ApiError(400, 'invalid_request', `ids phải là mảng 1..${BULK_MAX} phần tử`);

  const ids = body.ids.map((value) => editId(String(value)));
  const reviewer = c.get('reviewer') ?? '';
  const sql = getSql(c.env);
  const ok: number[] = [];
  const failed: number[] = [];
  try {
    for (const id of ids) {
      try {
        if (action === 'approve') {
          const [row] = await sql<{ poi_id: string | null }[]>`
            SELECT apply_poi_edit(${id}::bigint, ${reviewer}, 'approved') AS poi_id`;
          if (!row || row.poi_id === null) failed.push(id);
          else {
            ok.push(id);
            await invalidateCachedJson(placeCacheUrl(row.poi_id));
          }
        } else {
          const [row] = await sql<{ ok: boolean }[]>`
            SELECT reject_poi_edit(${id}::bigint, ${reviewer}) AS ok`;
          if (row?.ok) ok.push(id);
          else failed.push(id);
        }
      } catch (error) {
        console.error('admin/bulk item', id, error);
        failed.push(id);
      }
    }
    audit(c, `edits.bulk_${action}`, undefined, { ok, failed });
    return c.json({ ok, failed }, 200, { 'cache-control': 'private, no-store' });
  } finally {
    endSql(c.executionCtx, sql);
  }
});

admin.post('/v1/admin/edits/:id/approve', async (c) => {
  const id = editId(c.req.param('id'));
  const reviewer = c.get('reviewer') ?? '';
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ poi_id: string | null }[]>`
      SELECT apply_poi_edit(${id}::bigint, ${reviewer}, 'approved') AS poi_id`;
    if (!row || row.poi_id === null)
      throw new ApiError(404, 'not_found', 'Edit không tồn tại hoặc không còn pending');
    await invalidateCachedJson(placeCacheUrl(row.poi_id));
    audit(c, 'edit.approve', String(id), { poi_id: row.poi_id });
    return c.json({ ok: true, poi_id: row.poi_id });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/approve', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không duyệt được edit');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

admin.post('/v1/admin/edits/:id/reject', async (c) => {
  const id = editId(c.req.param('id'));
  const reviewer = c.get('reviewer') ?? '';
  const sql = getSql(c.env);
  try {
    const [row] = await sql<{ ok: boolean }[]>`
      SELECT reject_poi_edit(${id}::bigint, ${reviewer}) AS ok`;
    if (!row?.ok) throw new ApiError(404, 'not_found', 'Edit không tồn tại hoặc không còn pending');
    audit(c, 'edit.reject', String(id));
    return c.json({ ok: true });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error('admin/reject', error);
    throw new ApiError(503, 'upstream_unavailable', 'Không từ chối được edit');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
