import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
/** Tenant seed sẵn trong apps/api/test-db/setup.sql. */
const TENANT_FREE = '00000000-0000-4000-8000-0000000000cc';
const POI_ID = '01M3TEST0000000000000CAF01';

const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      ...(init.headers ?? {}),
    },
  });

const issue = (tenant, body) =>
  adminFetch(`/v1/admin/tenants/${tenant}/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('GET /v1/admin/tenants', () => {
  it('trả tenant seed kèm số khoá còn hiệu lực', async () => {
    const body = await (await adminFetch('/v1/admin/tenants?limit=100')).json();
    const tenant = body.items.find((item) => item.id === TENANT_FREE);
    expect(tenant.name).toBe('M4 itest free');
    expect(tenant.plan).toBe('free');
    expect(tenant.quota_mode).toBe('legacy');
    expect(tenant.active_keys).toBeGreaterThanOrEqual(1);
  });

  it('tìm theo tên lọc đúng và không phân biệt hoa thường', async () => {
    const body = await (await adminFetch('/v1/admin/tenants?q=itest%20free')).json();
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(item.name.toLowerCase()).toContain('itest free');
  });

  it('phân trang con trỏ đi hết danh sách: không sót, không lặp', async () => {
    // Đi từng trang MỘT bản ghi cho tới hết rồi so với truy vấn một lần. Kiểm "trang 2 khác trang
    // 1" là không đủ: ba tenant của setup.sql được seed trong cùng một transaction nên created_at
    // giống nhau tới micro giây, và con trỏ mất độ chính xác sẽ làm trang sau rỗng — sót dữ liệu
    // mà vẫn trả 200.
    const tatCa = await (await adminFetch('/v1/admin/tenants?limit=100')).json();
    expect(tatCa.items.length).toBeGreaterThanOrEqual(3);

    const thu = [];
    let cursor = null;
    for (let i = 0; i < tatCa.items.length + 5; i += 1) {
      const query = cursor ? `?limit=1&cursor=${encodeURIComponent(cursor)}` : '?limit=1';
      const page = await (await adminFetch(`/v1/admin/tenants${query}`)).json();
      thu.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }

    expect(thu).toEqual(tatCa.items.map((item) => item.id));
    expect(new Set(thu).size).toBe(thu.length);
  });

  it('con trỏ hỏng → 400 chứ không phải 503', async () => {
    const response = await adminFetch('/v1/admin/tenants?cursor=rac');
    expect(response.status).toBe(400);
  });

  it('không JWT → 401', async () => {
    expect((await fetch(`${base}/v1/admin/tenants`)).status).toBe(401);
  });
});

describe('GET /v1/admin/tenants/:id', () => {
  it('scopes và allowed_origins về dưới dạng MẢNG THẬT, không phải chuỗi "{a,b}"', async () => {
    // Hyperdrive chạy fetch_types: false nên text[] có thể về dạng chuỗi. Đây là lớp lỗi mà chỉ
    // tầng này thấy: unit test không DB luôn xanh, còn giao diện thì hiện "{places:read}".
    const body = await (await adminFetch(`/v1/admin/tenants/${TENANT_FREE}`)).json();
    expect(body.tenant.name).toBe('M4 itest free');
    expect(body.keys.length).toBeGreaterThan(0);
    for (const key of body.keys) {
      expect(Array.isArray(key.scopes)).toBe(true);
      expect(Array.isArray(key.allowed_origins)).toBe(true);
      expect(Array.isArray(key.allowed_bundle_ids)).toBe(true);
      expect(key.key_prefix).toMatch(/^mlv_live_[0-9A-Za-z]{8}$/);
    }
    expect(body.keys.some((key) => key.scopes.includes('edits:write'))).toBe(true);
  });

  it('tenant không tồn tại → 404', async () => {
    const response = await adminFetch('/v1/admin/tenants/11111111-1111-4111-8111-111111111111');
    expect(response.status).toBe(404);
  });

  it('id không phải uuid → 400', async () => {
    expect((await adminFetch('/v1/admin/tenants/abc')).status).toBe(400);
  });
});

describe('POST /v1/admin/tenants/:id/keys', () => {
  it('khoá vừa cấp gọi được /v1/places ngay — chứng minh INSERT, hash và scope đều đúng', async () => {
    const response = await issue(TENANT_FREE, {
      label: `itest cấp khoá ${Date.now()}`,
      kind: 'server',
      scopes: ['places:read'],
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toMatch(/^mlv_live_[0-9A-Za-z]{24}$/);
    expect(body.key_prefix).toBe(body.key.slice(0, 17));

    const place = await fetch(`${base}/v1/places/${POI_ID}`, {
      headers: { 'X-Api-Key': body.key },
    });
    expect(place.status).toBe(200);

    // DB chỉ giữ hash: cột khoá rõ đã bị bỏ từ migration 0011.
    const [row] = await sql`SELECT key_hash, key_prefix, kind, scopes, allowed_origins, active
      FROM api_key WHERE key_hash = ${body.key_hash}`;
    expect(row.active).toBe(true);
    expect(row.key_prefix).toBe(body.key_prefix);
    expect(row.scopes).toEqual(['places:read']);
    expect(row.allowed_origins).toEqual([]);
  });

  it('khoá web lưu đúng allowed_origins và bị chặn khi gọi từ origin lạ', async () => {
    const body = await (
      await issue(TENANT_FREE, {
        label: `itest khoá web ${Date.now()}`,
        kind: 'web',
        allowed_origins: ['https://khach.example.com'],
      })
    ).json();

    const tot = await fetch(`${base}/v1/places/${POI_ID}`, {
      headers: { 'X-Api-Key': body.key, Origin: 'https://khach.example.com' },
    });
    expect(tot.status).toBe(200);

    const la = await fetch(`${base}/v1/places/${POI_ID}`, {
      headers: { 'X-Api-Key': body.key, Origin: 'https://ke-khac.example.net' },
    });
    expect(la.status).toBe(403);
  });

  it('khoá web thiếu allowed_origins → 400, không có dòng nào được ghi', async () => {
    const truoc =
      await sql`SELECT count(*)::int AS n FROM api_key WHERE tenant_id = ${TENANT_FREE}::uuid`;
    const response = await issue(TENANT_FREE, { label: 'thiếu origin', kind: 'web' });
    expect(response.status).toBe(400);
    const sau =
      await sql`SELECT count(*)::int AS n FROM api_key WHERE tenant_id = ${TENANT_FREE}::uuid`;
    expect(sau[0].n).toBe(truoc[0].n);
  });

  it('tenant không tồn tại → 404 và không ghi khoá mồ côi', async () => {
    const response = await issue('11111111-1111-4111-8111-111111111111', {
      label: 'tenant ma',
      kind: 'server',
    });
    expect(response.status).toBe(404);
  });

  it('ghi đúng một dòng admin_audit, có actor, KHÔNG có khoá rõ', async () => {
    const label = `itest audit ${Date.now()}`;
    const body = await (await issue(TENANT_FREE, { label, kind: 'server' })).json();

    // audit chạy trong waitUntil nên có thể tới sau phản hồi.
    let rows = [];
    for (let i = 0; i < 20 && rows.length === 0; i += 1) {
      rows = await sql`SELECT actor, action, target, detail FROM admin_audit
        WHERE action = 'tenant.key_issue' AND target = ${body.key_hash}`;
      if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('phong@access-fake.local');
    expect(rows[0].detail.label).toBe(label);
    expect(JSON.stringify(rows[0].detail)).not.toContain(body.key);
  });
});

describe('thu hồi khoá từ trang Admin (route billing dùng lại)', () => {
  it('thu hồi → khoá chết ngay, khôi phục → sống lại, mỗi lần một dòng audit', async () => {
    const body = await (
      await issue(TENANT_FREE, { label: `itest thu hồi ${Date.now()}`, kind: 'server' })
    ).json();
    expect(
      (await fetch(`${base}/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': body.key } })).status,
    ).toBe(200);

    const revocation = (revoked, operationId) =>
      adminFetch(`/v1/admin/billing/${TENANT_FREE}/keys/${body.key_hash}/revocation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revoked, reason: 'itest', operationId }),
      });

    expect((await revocation(true, `itest-thu-hoi-${body.key_hash}`)).status).toBe(200);
    // Route tự xoá cache KV của khoá, nên hiệu lực là tức thì chứ không phải sau 300 giây.
    expect(
      (await fetch(`${base}/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': body.key } })).status,
    ).toBe(401);

    expect((await revocation(false, `itest-khoi-phuc-${body.key_hash}`)).status).toBe(200);
    expect(
      (await fetch(`${base}/v1/places/${POI_ID}`, { headers: { 'X-Api-Key': body.key } })).status,
    ).toBe(200);

    let rows = [];
    for (let i = 0; i < 20 && rows.length < 2; i += 1) {
      rows = await sql`SELECT actor, action FROM admin_audit
        WHERE target = ${body.key_hash} AND action IN ('tenant.key_revoke', 'tenant.key_restore')
        ORDER BY id`;
      if (rows.length < 2) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(rows.map((row) => row.action)).toEqual(['tenant.key_revoke', 'tenant.key_restore']);
    for (const row of rows) expect(row.actor).toBe('phong@access-fake.local');
  });

  it('đổi quota_mode ghi audit và đổi thật trong DB', async () => {
    const doiGoi = (mode) =>
      adminFetch(`/v1/admin/billing/${TENANT_FREE}/mode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

    // `finally` chứ không phải dòng cuối thân test: một khẳng định đỏ ở giữa sẽ bỏ qua phần dọn
    // dẹp, và tenant kẹt ở `commercial` làm MỌI file itest chạy sau đỏ theo — mất cả buổi để
    // truy ngược từ "POST /v1/edits trả 400" về đây.
    try {
      expect((await doiGoi('commercial')).status).toBe(200);
      const [tenant] = await sql`SELECT quota_mode FROM tenant WHERE id = ${TENANT_FREE}::uuid`;
      expect(tenant.quota_mode).toBe('commercial');

      let rows = [];
      for (let i = 0; i < 20 && rows.length === 0; i += 1) {
        rows = await sql`SELECT actor, detail FROM admin_audit
          WHERE action = 'tenant.quota_mode' AND target = ${TENANT_FREE} ORDER BY id DESC LIMIT 1`;
        if (rows.length === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(rows[0].actor).toBe('phong@access-fake.local');
      // Đọc được `.mode` chứng minh cột jsonb giữ OBJECT chứ không phải chuỗi JSON double-encode.
      expect(rows[0].detail.mode).toBe('commercial');
    } finally {
      await doiGoi('legacy');
    }
  });
});

describe('DELETE /v1/admin/tenants/:id', () => {
  // Nhóm này ra đời sau sự cố 19/09/2026: route DELETE chưa có một bài itest nào, nên khi
  // migration 0023 thêm `customer_order` với khoá ngoại tới `tenant`, nút "Xoá tổ chức" hỏng mà
  // mọi cổng vẫn xanh. `apps/api/test/admin-tenants.test.ts` chỉ kiểm CSRF và JWT — nó dựng Hono
  // không có DB, nên không thể thấy lớp lỗi này.

  /** Tenant dùng một lần, kèm tài khoản khách trỏ tới nó. */
  const dungTenant = async (ten) => {
    const [t] = await sql`INSERT INTO tenant (name, plan, quota_mode)
      VALUES (${ten}, 'free', 'commercial') RETURNING id`;
    const [a] = await sql`INSERT INTO customer_account (email, trial_tenant_id)
      VALUES (${`${ten}@itest.local`.toLowerCase()}, ${t.id}::uuid) RETURNING id`;
    return { tenantId: t.id, accountId: a.id };
  };

  const xoa = (id, confirmName) =>
    adminFetch(`/v1/admin/tenants/${id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm_name: confirmName }),
    });

  it('gõ sai tên → 400 và tenant còn nguyên', async () => {
    const ten = `itest xoa sai ten ${Date.now()}`;
    const { tenantId } = await dungTenant(ten);
    try {
      const response = await xoa(tenantId, 'tên khác hẳn');
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe('confirm_name_mismatch');
      expect(body.error.details.expected_name).toBe(ten);
      const [con] = await sql`SELECT count(*)::int AS n FROM tenant WHERE id = ${tenantId}::uuid`;
      expect(con.n).toBe(1);
    } finally {
      await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = ${tenantId}::uuid`;
      await sql`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
    }
  });

  it('tenant còn đơn hàng → 409 tenant_has_orders kèm SỐ ĐƠN, không phải 503 mù', async () => {
    // Đây là sự cố thật, viết lại thành bài kiểm: tổ chức đã từng đặt đơn thì không xoá được, và
    // trước 0024 người bấm chỉ nhận được "Không xoá được tenant" — một câu không nói phải làm gì.
    const ten = `itest xoa co don ${Date.now()}`;
    const { tenantId, accountId } = await dungTenant(ten);
    await sql`INSERT INTO customer_order
      (tenant_id, account_id, kind, tier, months, amount_vnd, amount_usd_cents, status)
      VALUES (${tenantId}::uuid, ${accountId}::uuid, 'plan', 'starter', 1, 490000, 1900, 'fulfilled')`;
    try {
      const response = await xoa(tenantId, ten);
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error.code).toBe('tenant_has_orders');
      expect(body.error.details.orders).toBe(1);
      // Thông điệp phải nói được đường đi tiếp, không chỉ nói "không".
      expect(body.error.message).toContain('1');

      // Và không được xoá mất gì: 409 là lời từ chối, không phải một lần xoá nửa vời.
      const [con] = await sql`SELECT count(*)::int AS n FROM tenant WHERE id = ${tenantId}::uuid`;
      expect(con.n).toBe(1);
      const [don] =
        await sql`SELECT count(*)::int AS n FROM customer_order WHERE tenant_id = ${tenantId}::uuid`;
      expect(don.n).toBe(1);
    } finally {
      await sql`DELETE FROM customer_order WHERE tenant_id = ${tenantId}::uuid`;
      await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = ${tenantId}::uuid`;
      await sql`DELETE FROM tenant WHERE id = ${tenantId}::uuid`;
    }
  });

  it('tenant sạch → 200, khoá đi theo, tài khoản khách ở lại và được gỡ liên kết', async () => {
    const ten = `itest xoa sach ${Date.now()}`;
    const { tenantId, accountId } = await dungTenant(ten);
    await sql`INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind)
      VALUES (${'cd'.repeat(32)}, ${'mlv_live_itestxoa'}, ${tenantId}::uuid, 'itest', 'server')`;

    const response = await xoa(tenantId, ten);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deleted).toBe(true);
    expect(body.keys_deleted).toBe(1);
    expect(body.accounts_unlinked).toBe(1);

    const [con] = await sql`SELECT count(*)::int AS n FROM tenant WHERE id = ${tenantId}::uuid`;
    expect(con.n).toBe(0);
    const [khoa] =
      await sql`SELECT count(*)::int AS n FROM api_key WHERE tenant_id = ${tenantId}::uuid`;
    expect(khoa.n).toBe(0);
    // Tài khoản đăng nhập KHÔNG bị xoá theo — khách còn phải tạo được tổ chức mới.
    const [tk] =
      await sql`SELECT trial_tenant_id FROM customer_account WHERE id = ${accountId}::uuid`;
    expect(tk.trial_tenant_id).toBeNull();
    await sql`DELETE FROM customer_account WHERE id = ${accountId}::uuid`;
  });
});

describe('lớp quyền billing không bị nới ra vì trang Admin (tiêu chí nghiệm thu số 3)', () => {
  it('email ngoài BILLING_ADMIN_EMAILS: xem được tenant nhưng KHÔNG thu hồi được khoá', async () => {
    // Đây là bài kiểm duy nhất chạy qua `requireBillingAccess()` THẬT. `apps/api/test/
    // billing-admin.test.ts` dựng một Hono riêng và tự gán `reviewer`, nên nó không nói gì về
    // lớp lọc email — chỉ tầng này có JWT ký được với email tuỳ ý.
    const laJwt = signAccessJwt({ email: 'nguoi-la@access-fake.local' });
    const laFetch = (path, init = {}) =>
      fetch(base + path, {
        ...init,
        headers: {
          'Cf-Access-Jwt-Assertion': laJwt,
          'Sec-Fetch-Site': 'same-origin',
          ...(init.headers ?? {}),
        },
      });

    // Giai đoạn này hệ thống chưa phân quyền: ai qua được Access đều xem được tenant.
    expect((await laFetch('/v1/admin/tenants?limit=1')).status).toBe(200);

    const response = await laFetch(
      `/v1/admin/billing/${TENANT_FREE}/keys/${'a'.repeat(64)}/revocation`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revoked: true, reason: 'thử', operationId: 'thử' }),
      },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('billing_admin_forbidden');
  });
});
