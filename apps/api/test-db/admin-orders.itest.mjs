import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';
import { PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const payosFake = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });

const tenantDaTao = [];
const emailDaTao = [];
afterAll(async () => {
  for (const id of tenantDaTao) {
    await sql`DELETE FROM payment_event WHERE order_id IN (
      SELECT id FROM customer_order WHERE tenant_id = ${id}::uuid)`;
    await sql`DELETE FROM customer_order WHERE tenant_id = ${id}::uuid`;
    await sql`DELETE FROM api_key WHERE tenant_id = ${id}::uuid`;
    await sql`DELETE FROM tenant_member WHERE tenant_id = ${id}::uuid`;
    await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE trial_tenant_id = ${id}::uuid`;
    await sql`DELETE FROM tenant WHERE id = ${id}::uuid`;
  }
  // Mỗi dangKy() tạo một customer_account mới — dọn theo đúng thứ tự khoá ngoại, cùng khuôn với
  // admin-customers.itest.mjs, kẻo để lại tài khoản rác đẩy tenant seed ra khỏi quota-summary.
  for (const email of emailDaTao) {
    const [tk] = await sql`SELECT id FROM customer_account WHERE email = ${email}`;
    if (!tk) continue;
    await sql`DELETE FROM customer_session WHERE account_id = ${tk.id}::uuid`;
    await sql`DELETE FROM customer_login_code WHERE email = ${email}`;
    await sql`UPDATE customer_account SET trial_tenant_id = NULL WHERE id = ${tk.id}::uuid`;
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

/** @param {string} ten */
async function dangKy(ten) {
  const email = `don-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vidu.vn`;
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
      headers: { cookie, 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  const { tenant } = await (
    await khach('/v1/console/tenant', { method: 'POST', body: JSON.stringify({ name: ten }) })
  ).json();
  tenantDaTao.push(tenant.id);
  emailDaTao.push(email);
  return { email, khach, tenantId: tenant.id };
}

/** @param {{khach: (p: string, i?: RequestInit) => Promise<Response>}} k */
const taoDonStarter = async (k) =>
  (await (await k.khach('/v1/console/orders', {
    method: 'POST',
    body: JSON.stringify({ kind: 'plan', tier: 'starter', months: 1 }),
  })).json()).order;

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

/** Đếm dòng audit hiện có — dùng để khẳng định một lệnh gọi LẶP LẠI không ghi thêm dòng nào.
 * @param {string} action @param {string} target */
async function demAudit(action, target) {
  const rows = await sql`SELECT count(*)::int AS n FROM admin_audit
    WHERE action = ${action} AND target = ${target}`;
  return rows[0]?.n ?? 0;
}

/**
 * Ngày YYYY-MM-DD theo giờ Việt Nam, lệch `lech` ngày từ MỘT mốc `iso` cho trước (createdAt của
 * đơn), KHÔNG phải đồng hồ tường: `Date.now()` đọc lại ở bốn thời điểm sau khi đơn đã được tạo,
 * nên lượt chạy vắt qua nửa đêm giờ VN (17:00 UTC) có thể đẩy `homNay` sang ngày khác của đồng hồ
 * trong khi đơn vẫn mang `created_at` của ngày cũ — bài `homNay` ra 0 thay vì 2. Ghim theo mốc của
 * chính đơn thì phép so sánh không phụ thuộc lúc nào bài chạy.
 * @param {string} iso @param {number} lech */
const ngayCuaDon = (iso, lech) =>
  new Date(Date.parse(iso) + 7 * 3_600_000 + lech * 86_400_000).toISOString().slice(0, 10);

describe('admin đơn hàng — huỷ, hoàn tiền, bộ lọc', () => {
  it('huỷ đơn pending: PayOS giả thấy CANCELLED, đơn cancelled, audit giữ lý do, gọi lại moi:false', async () => {
    const k = await dangKy('Công ty Admin Huỷ');
    const don = await taoDonStarter(k);
    expect(don.status).toBe('pending');

    const than = { operationId: `op-huy-${don.orderCode}`, reason: 'Khách gọi điện xin huỷ' };
    const huy = await adminFetch(`/v1/admin/orders/${don.id}/cancel`, { method: 'POST', body: JSON.stringify(than) });
    expect(huy.status).toBe(200);
    expect(await huy.json()).toMatchObject({ moi: true, order: { status: 'cancelled', note: than.reason } });

    const tt = await (
      await fetch(`${payosFake}/v2/payment-requests/${don.orderCode}`, {
        headers: { 'x-client-id': 'fake-client-id', 'x-api-key': 'fake-api-key' },
      })
    ).json();
    expect(tt.data.status).toBe('CANCELLED');

    expect((await (await k.khach(`/v1/console/orders/${don.id}`)).json()).order.status).toBe('cancelled');
    const audit = await doiAudit('admin.order.cancel', don.id);
    expect(audit[0].detail).toMatchObject({ reason: than.reason, payos_link: true });
    const soDong = await demAudit('admin.order.cancel', don.id);

    // Gọi lại: moi:false, và KHÔNG ghi thêm dòng audit thứ hai.
    const lai = await adminFetch(`/v1/admin/orders/${don.id}/cancel`, { method: 'POST', body: JSON.stringify(than) });
    expect((await lai.json()).moi).toBe(false);
    expect(await demAudit('admin.order.cancel', don.id)).toBe(soDong);
  });

  it('hoàn tiền đơn fulfilled: refunded + note, sổ quota KHÔNG đổi, audit có số tiền; pending → 409', async () => {
    const k = await dangKy('Công ty Admin Hoàn');
    const don = await taoDonStarter(k);
    const tra = await (
      await fetch(`${payosFake}/__fake/pay/${don.orderCode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ webhookUrl: `${base}/v1/pay/payos/webhook`, reference: `FT-HOAN-${don.orderCode}` }),
      })
    ).json();
    expect(tra.webhookBody).toMatchObject({ status: 'fulfilled' });

    const truoc = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    const than = { operationId: `op-hoan-${don.orderCode}`, reason: 'Khách không dùng, đã chuyển trả' };
    const hoan = await adminFetch(`/v1/admin/orders/${don.id}/refund`, { method: 'POST', body: JSON.stringify(than) });
    expect(hoan.status).toBe(200);
    expect(await hoan.json()).toMatchObject({
      moi: true,
      order: { status: 'refunded', note: than.reason, paidAmountVnd: don.amountVnd },
    });

    const sau = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    expect(sau.periods).toEqual(truoc.periods);
    expect((await (await k.khach('/v1/console/usage')).json()).status).toBe('active');

    const audit = await doiAudit('admin.order.refund', don.id);
    expect(audit[0].detail).toMatchObject({ reason: than.reason, paid_amount_vnd: don.amountVnd });

    // Webhook bắn lại cho đơn refunded: 200, không đổi gì (apDungThanhToan trả khong_doi).
    const lai = await fetch(`${base}/v1/pay/payos/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tra.webhook),
    });
    expect(lai.status).toBe(200);
    expect((await (await adminFetch(`/v1/admin/orders/${don.id}`)).json()).order.status).toBe('refunded');

    const donMoi = await taoDonStarter(k);
    const tuChoi = await adminFetch(`/v1/admin/orders/${donMoi.id}/refund`, { method: 'POST', body: JSON.stringify(than) });
    expect(tuChoi.status).toBe(409);
    expect((await tuChoi.json()).error.code).toBe('order_not_refundable');
  });

  it('bộ lọc tenant + status + khoảng ngày (giờ VN)', async () => {
    const k = await dangKy('Công ty Admin Lọc');
    const d1 = await taoDonStarter(k);
    await adminFetch(`/v1/admin/orders/${d1.id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ operationId: `op-loc-${d1.orderCode}`, reason: 'lọc' }),
    });
    const d2 = await taoDonStarter(k);

    const tatCa = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}`)).json();
    expect(tatCa.items.map((d) => d.id).sort()).toEqual([d1.id, d2.id].sort());
    for (const d of tatCa.items) expect(d.tenantId).toBe(k.tenantId);

    // status=cancelled và tenant=rac → 400 đã có nguyên văn trong admin-orders.test.ts (unit); ở
    // đây chỉ giữ phần cần Postgres + wrangler thật: bộ lọc ngày đối chiếu created_at thật.
    // Ghim theo createdAt của chính hai đơn, không phải Date.now() đọc lại sau đó — hai đơn tạo
    // liên tiếp trong cùng bài phải rơi vào cùng một ngày giờ VN, nếu không phép lọc bên dưới vô nghĩa.
    expect(ngayCuaDon(d1.createdAt, 0)).toBe(ngayCuaDon(d2.createdAt, 0));

    const homNay = await (
      await adminFetch(
        `/v1/admin/orders?tenant=${k.tenantId}&from=${ngayCuaDon(d2.createdAt, 0)}&to=${ngayCuaDon(d2.createdAt, 0)}`,
      )
    ).json();
    expect(homNay.items).toHaveLength(2);
    const ngayMai = await (
      await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&from=${ngayCuaDon(d2.createdAt, 1)}`)
    ).json();
    expect(ngayMai.items).toHaveLength(0);
    const homQua = await (
      await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&to=${ngayCuaDon(d2.createdAt, -1)}`)
    ).json();
    expect(homQua.items).toHaveLength(0);
  });
});
