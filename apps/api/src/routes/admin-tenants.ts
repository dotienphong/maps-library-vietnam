import { Hono } from 'hono';
import { audit } from '../audit';
import { normalizeTextArray } from '../auth';
import { endSql, getSql } from '../db';
import type { AppEnv } from '../env';
import { ApiError, moTaLoi } from '../errors';
import { issueKeyForTenant } from '../tenant-keys';
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

/** Hàng danh sách kèm khoá sắp xếp dạng chuỗi — chỉ dùng để dựng con trỏ, không trả ra ngoài. */
interface TenantListRow extends TenantRow {
  cursor_at: string;
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
    const rows = await sql<TenantListRow[]>`
      SELECT t.id, t.name, t.plan, t.quota_mode, t.created_at,
             -- to_char giữ đủ micro giây; đọc created_at qua postgres.js chỉ còn mili giây,
             -- và con trỏ thiếu ba chữ số cuối sẽ loại luôn hàng mở đầu trang sau.
             to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
             count(k.key_hash) FILTER (WHERE k.active AND k.revoked_at IS NULL)::int AS active_keys
      FROM tenant t
      LEFT JOIN api_key k ON k.tenant_id = t.id
      WHERE (${params.q}::text IS NULL OR t.name ILIKE '%' || ${params.q} || '%')
        -- ::text::timestamptz chứ không phải ::timestamptz thẳng: bind cho kiểu thời gian đi qua
        -- Date của JavaScript và mất ba chữ số micro giây, nên con trỏ .809602 và .809601 đều
        -- thành .809000 và điều kiện loại sạch trang sau. Qua text thì chính Postgres parse chuỗi.
        AND (${createdAt}::text IS NULL
             OR (t.created_at, t.id) < (${createdAt}::text::timestamptz, ${cursorId}::uuid))
      GROUP BY t.id
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ${params.limit + 1}`;

    const hasMore = rows.length > params.limit;
    const page = hasMore ? rows.slice(0, params.limit) : rows;
    const last = page.at(-1);
    return c.json(
      {
        items: page.map(({ cursor_at: _cursorAt, ...tenant }) => tenant),
        nextCursor: hasMore && last ? encodeTenantCursor(last.cursor_at, last.id) : null,
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error(`admin/tenants: ${moTaLoi(error)}`, error);
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
    console.error(`admin/tenants/:id: ${moTaLoi(error)}`, error);
    throw new ApiError(503, 'upstream_unavailable', 'Không đọc được chi tiết tenant');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

adminTenants.post('/v1/admin/tenants/:id/keys', async (c) => {
  const id = tenantId(c.req.param('id'));
  const input = parseNewKeyBody(await c.req.json().catch(() => null));

  const sql = getSql(c.env);
  try {
    const [tenant] = await sql<{ name: string }[]>`
      SELECT name FROM tenant WHERE id = ${id}::uuid`;
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tenant này');

    // Việc cấp khoá nằm ở `tenant-keys.ts` để trang Admin và cổng khách hàng dùng chung một bản:
    // sinh khoá, băm, ghi bảng và xoá cache âm của auth đều là chỗ dễ lệch nhau nếu có hai bản.
    const { key, keyHash, keyPrefix } = await issueKeyForTenant(sql, c.env, {
      tenantId: id,
      label: input.label,
      kind: input.kind,
      allowedOrigins: input.allowedOrigins,
      allowedBundleIds: input.allowedBundleIds,
      scopes: input.scopes,
      quotaDirectionsPerDay: input.quotaDirectionsPerDay,
    });

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
    console.error(`admin/tenants/:id/keys: ${moTaLoi(error)}`, error);
    throw new ApiError(503, 'upstream_unavailable', 'Không cấp được khoá');
  } finally {
    endSql(c.executionCtx, sql);
  }
});

/**
 * Xoá VĨNH VIỄN một tenant.
 *
 * Hai chốt, vì thao tác này không lùi lại được:
 *
 * 1. Body phải có `confirm_name` **khớp đúng** tên tenant. Một cú bấm nhầm không gõ ra được tên,
 *    và khi tên đã gõ thì người bấm biết mình đang xoá cái gì. Đây là bản UI của cặp
 *    `--apply --confirm` trong `scripts/db-tenant-xoa.mjs`.
 * 2. Tenant còn đóng góp POI thì TỪ CHỐI. Đóng góp là dữ liệu bản đồ dùng chung, không phải tài
 *    sản riêng của tenant; xoá kèm theo quán tính là mất công sức của người thật. Muốn xoá thì
 *    phải xử lý đóng góp trước, bằng tay, có ý thức.
 * 3. Tenant còn đơn hàng thì TỪ CHỐI, vì lý do khác: đơn là hồ sơ tài chính. Migration 0023 cố ý
 *    không cấp DELETE trên `customer_order` cho role `api`, và nút này không được là cửa sau cho
 *    đúng thứ đó. Tổ chức THỬ có đơn thì xoá bằng `pnpm server:tenant-xoa --xoa-don-hang` trên
 *    máy chủ — một người, một lệnh, không phải một cú bấm.
 *
 * `customer_account` được GIỮ LẠI và chỉ gỡ `trial_tenant_id`: khách vẫn đăng nhập được và tạo
 * tổ chức mới. Xoá tài khoản là việc khác, không nằm trong nút này.
 *
 * Sổ quota nằm trong Durable Object chứ không trong Postgres, nên nó thành sổ mồ côi. Không ai
 * đọc, không tốn gì đáng kể, và đi xoá nó cần một đường riêng.
 */
adminTenants.delete('/v1/admin/tenants/:id', async (c) => {
  const id = tenantId(c.req.param('id'));
  const body = (await c.req.json().catch(() => null)) as { confirm_name?: unknown } | null;
  const xacNhan = typeof body?.confirm_name === 'string' ? body.confirm_name.trim() : '';

  const sql = getSql(c.env);
  try {
    const [tenant] = await sql<
      { name: string; edits: number; orders: number; keys: number; accounts: number }[]
    >`
      SELECT t.name,
        (SELECT count(*) FROM poi_edit e WHERE e.tenant_id = t.id)::int          AS edits,
        (SELECT count(*) FROM customer_order o WHERE o.tenant_id = t.id)::int    AS orders,
        (SELECT count(*) FROM api_key k WHERE k.tenant_id = t.id)::int           AS keys,
        (SELECT count(*) FROM customer_account a WHERE a.trial_tenant_id = t.id)::int AS accounts
      FROM tenant t WHERE t.id = ${id}::uuid`;
    if (!tenant) throw new ApiError(404, 'not_found', 'Không có tenant này');

    if (xacNhan !== tenant.name) {
      throw new ApiError(
        400,
        'confirm_name_mismatch',
        'Gõ đúng tên tổ chức để xác nhận xoá',
        undefined,
        { expected_name: tenant.name },
      );
    }

    if (tenant.edits > 0) {
      throw new ApiError(
        409,
        'tenant_has_edits',
        `Tổ chức còn ${tenant.edits} đóng góp POI — xử lý chúng trước rồi mới xoá được`,
        undefined,
        { edits: tenant.edits },
      );
    }

    // Đếm ở ĐÂY chứ không chỉ dựa vào hàm ném: một vi phạm khoá ngoại chỉ ra được 503 bắt-tất,
    // còn con số này ra được một câu nói đúng việc phải làm tiếp. Sự cố 19/09/2026 là nguyên văn
    // trường hợp này — `customer_order` của 0023 ra đời sau hàm xoá của 0022.
    if (tenant.orders > 0) {
      throw new ApiError(
        409,
        'tenant_has_orders',
        `Tổ chức còn ${tenant.orders} đơn hàng — đó là hồ sơ tài chính, không xoá kèm. ` +
          'Nếu đây là tổ chức thử thì xoá trên máy chủ bằng ' +
          '`pnpm server:tenant-xoa --name "…" --apply --confirm XOA-MOT-TENANT --xoa-don-hang`.',
        undefined,
        { orders: tenant.orders },
      );
    }

    // Đi qua hàm `SECURITY DEFINER` của migration 0022 (0024 dạy nó biết `customer_order`),
    // KHÔNG chạy DELETE trực tiếp: role `api`
    // cố ý không có quyền xoá trên bảng nào, và cấp quyền đó chỉ để phục vụ một nút bấm là đổi
    // một lỗi vận hành lấy một rủi ro thường trực. Hàm tự chạy cả bốn bước trong một giao dịch.
    await sql`SELECT * FROM xoa_tenant_hoan_toan(${id}::uuid)`;

    audit(c, 'tenant.delete', id, {
      name: tenant.name,
      keys_deleted: tenant.keys,
      accounts_unlinked: tenant.accounts,
    });

    return c.json(
      {
        deleted: true,
        name: tenant.name,
        keys_deleted: tenant.keys,
        accounts_unlinked: tenant.accounts,
      },
      200,
      NO_STORE,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    console.error(`admin/tenants/:id DELETE: ${moTaLoi(error)}`, error);
    throw new ApiError(503, 'upstream_unavailable', 'Không xoá được tenant');
  } finally {
    endSql(c.executionCtx, sql);
  }
});
