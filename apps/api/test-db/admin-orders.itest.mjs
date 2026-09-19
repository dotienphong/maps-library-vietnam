import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';
import { PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const payosFake = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });

const tenantDaTao = [];
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
    const rows = await sql`SELECT detail FROM admin_audit WHERE action = ${action} AND target = ${target}`;
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

/** Ngày YYYY-MM-DD theo giờ Việt Nam, lệch `lech` ngày. @param {number} lech */
const ngayVN = (lech) =>
  new Date(Date.now() + 7 * 3_600_000 + lech * 86_400_000).toISOString().slice(0, 10);

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

    const lai = await adminFetch(`/v1/admin/orders/${don.id}/cancel`, { method: 'POST', body: JSON.stringify(than) });
    expect((await lai.json()).moi).toBe(false);
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
    expect(await hoan.json()).toMatchObject({ moi: true, order: { status: 'refunded', note: than.reason, paidAmountVnd: 650_000 } });

    const sau = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    expect(sau.periods).toEqual(truoc.periods);
    expect((await (await k.khach('/v1/console/usage')).json()).status).toBe('active');

    const audit = await doiAudit('admin.order.refund', don.id);
    expect(audit[0].detail).toMatchObject({ reason: than.reason, paid_amount_vnd: 650_000 });

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

    const daHuy = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&status=cancelled`)).json();
    expect(daHuy.items.map((d) => d.id)).toEqual([d1.id]);

    const homNay = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&from=${ngayVN(0)}&to=${ngayVN(0)}`)).json();
    expect(homNay.items).toHaveLength(2);
    const ngayMai = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&from=${ngayVN(1)}`)).json();
    expect(ngayMai.items).toHaveLength(0);
    const homQua = await (await adminFetch(`/v1/admin/orders?tenant=${k.tenantId}&to=${ngayVN(-1)}`)).json();
    expect(homQua.items).toHaveLength(0);

    expect((await adminFetch('/v1/admin/orders?tenant=rac')).status).toBe(400);
  });
});
