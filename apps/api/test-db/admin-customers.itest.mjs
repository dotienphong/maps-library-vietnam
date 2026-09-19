import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });

/** Dọn như commerce.itest: quota-summary chỉ lấy 25 tenant mới nhất, để lại là đỏ bài khác. */
const emailDaTao = [];
afterAll(async () => {
  for (const email of emailDaTao) {
    const [tk] = await sql`SELECT id, trial_tenant_id FROM customer_account WHERE email = ${email}`;
    if (!tk) continue;
    await sql`DELETE FROM customer_session WHERE account_id = ${tk.id}::uuid`;
    await sql`DELETE FROM customer_login_code WHERE email = ${email}`;
    const tenants = await sql`SELECT tenant_id FROM tenant_member WHERE account_id = ${tk.id}::uuid`;
    await sql`DELETE FROM tenant_member WHERE account_id = ${tk.id}::uuid`;
    await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE id = ${tk.id}::uuid`;
    for (const { tenant_id } of tenants) {
      await sql`DELETE FROM api_key WHERE tenant_id = ${tenant_id}::uuid`;
      await sql`DELETE FROM tenant WHERE id = ${tenant_id}::uuid`;
    }
    await sql`DELETE FROM customer_account WHERE id = ${tk.id}::uuid`;
  }
  await sql.end({ timeout: 5 });
});

const jwt = signAccessJwt({ email: 'phong@access-fake.local' });
/** @param {string} path @param {RequestInit} [init] */
const adminFetch = (path, init = {}) =>
  fetch(base + path, {
    ...init,
    headers: {
      'Cf-Access-Jwt-Assertion': jwt,
      'Sec-Fetch-Site': 'same-origin',
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

/** Đăng nhập bằng mã một lần qua đúng đường của cổng khách; trả cookie + hàm gọi. @param {string} email */
async function dangNhap(email) {
  const xin = await fetch(`${base}/v1/console/auth/otp/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email, turnstileToken: '' }),
  });
  const ma = xin.headers.get('x-debug-otp');
  const xac = await fetch(`${base}/v1/console/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email, code: ma }),
  });
  const cookie = (xac.headers.get('set-cookie') ?? '').split(';')[0];
  /** @param {string} path @param {RequestInit} [init] */
  const khach = (path, init = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        cookie,
        'Sec-Fetch-Site': 'same-origin',
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  return { status: xac.status, body: await xac.json().catch(() => ({})), khach };
}

/** @param {string} action @param {string} target */
async function doiAudit(action, target) {
  for (let i = 0; i < 24; i += 1) {
    const rows = await sql`SELECT detail FROM admin_audit
      WHERE action = ${action} AND target = ${target} ORDER BY created_at DESC`;
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

describe('admin tài khoản khách — trọn chặng', () => {
  it('đăng ký → admin tìm thấy → tạo tổ chức → chi tiết có phiên → vô hiệu hoá có hiệu lực trong MỘT request → đăng nhập lại bị 403 → kích hoạt lại', async () => {
    const email = `khach-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vidu.vn`;
    emailDaTao.push(email);
    const k1 = await dangNhap(email);
    expect(k1.status).toBe(200);

    // Danh sách: tìm theo email, chưa có tổ chức.
    let ds = await (await adminFetch(`/v1/admin/customers?q=${encodeURIComponent(email)}`)).json();
    expect(ds.items).toHaveLength(1);
    expect(ds.items[0]).toMatchObject({ email, googleLinked: false, disabledAt: null, tenant: null });
    const id = ds.items[0].id;

    // Tạo tổ chức → danh sách hiện tên tenant; chi tiết tenant hiện owner.
    const tao = await k1.khach('/v1/console/tenant', {
      method: 'POST',
      body: JSON.stringify({ name: 'Công ty Khách Admin' }),
    });
    const { tenant } = await tao.json();
    ds = await (await adminFetch(`/v1/admin/customers?q=${encodeURIComponent(email)}`)).json();
    expect(ds.items[0].tenant).toMatchObject({ id: tenant.id, name: 'Công ty Khách Admin' });
    const ct = await (await adminFetch(`/v1/admin/tenants/${tenant.id}`)).json();
    expect(ct.owner).toMatchObject({ email, accountId: id });

    // Chi tiết: một phiên, không lộ băm.
    const chiTiet = await (await adminFetch(`/v1/admin/customers/${id}`)).json();
    expect(chiTiet.account.email).toBe(email);
    expect(chiTiet.sessions.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(chiTiet)).not.toMatch(/token_hash|ip_hash|tokenHash|ipHash|google_sub/);

    // Khách đang vào được.
    expect((await k1.khach('/v1/console/me')).status).toBe(200);

    // Vô hiệu hoá → request kế tiếp của khách nhận 401 (phiên đã xoá): tiêu chí 20.11.
    const than = { operationId: `op-${Date.now()}`, reason: 'Kiểm thử vô hiệu hoá' };
    const khoa = await adminFetch(`/v1/admin/customers/${id}/disable`, {
      method: 'POST',
      body: JSON.stringify(than),
    });
    expect(khoa.status).toBe(200);
    const khoaBody = await khoa.json();
    expect(khoaBody.moi).toBe(true);
    expect(khoaBody.sessionsDeleted).toBeGreaterThanOrEqual(1);
    expect(khoaBody.account.disabledAt).not.toBeNull();
    expect((await k1.khach('/v1/console/me')).status).toBe(401);

    // Đăng nhập lại bị chặn ở bước xác nhận mã: 403 account_disabled.
    const k2 = await dangNhap(email);
    expect(k2.status).toBe(403);
    expect(k2.body.error.code).toBe('account_disabled');

    const audit = await doiAudit('admin.customer.disable', id);
    expect(audit).toHaveLength(1);
    expect(audit[0].detail.reason).toBe('Kiểm thử vô hiệu hoá');

    // Gọi lại: thành công, không đổi gì, và KHÔNG ghi thêm dòng audit thứ hai.
    const lai = await adminFetch(`/v1/admin/customers/${id}/disable`, {
      method: 'POST',
      body: JSON.stringify(than),
    });
    expect((await lai.json()).moi).toBe(false);
    expect(await doiAudit('admin.customer.disable', id)).toHaveLength(1);

    // Kích hoạt lại → đăng nhập được, /me 200.
    const mo = await adminFetch(`/v1/admin/customers/${id}/enable`, {
      method: 'POST',
      body: JSON.stringify({ operationId: `op-mo-${Date.now()}`, reason: 'Đã xác minh' }),
    });
    expect((await mo.json())).toMatchObject({ moi: true, account: { disabledAt: null } });
    const k3 = await dangNhap(email);
    expect(k3.status).toBe(200);
    expect((await k3.khach('/v1/console/me')).status).toBe(200);
    expect(await doiAudit('admin.customer.enable', id)).toHaveLength(1);
  });

  it('cổng: thiếu JWT → 401; POST cross-site → 403 trước cả JWT', async () => {
    expect((await fetch(`${base}/v1/admin/customers`)).status).toBe(401);
    const res = await fetch(`${base}/v1/admin/customers/00000000-0000-4000-8000-000000000001/disable`, {
      method: 'POST',
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('cross_site_request');
  });
});
