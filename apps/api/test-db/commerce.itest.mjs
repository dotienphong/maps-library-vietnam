import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';
import { dungWebhook, FAKE_CHECKSUM, PAYOS_FAKE_PORT } from '../../../scripts/lib/payos-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
const payosFake = `http://127.0.0.1:${PAYOS_FAKE_PORT}`;
const sql = postgres(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 5 }));

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

/** Đăng ký một khách mới qua đúng đường của cổng khách hàng. @param {string} ten */
async function dangKy(ten) {
  const email = `don-${Date.now()}-${Math.floor(Math.random() * 1e6)}@vidu.vn`;
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
  const tao = await khach('/v1/console/tenant', {
    method: 'POST',
    body: JSON.stringify({ name: ten }),
  });
  const { tenant } = await tao.json();
  return { email, khach, tenantId: tenant.id };
}

/** @param {{khach: (p: string, i?: RequestInit) => Promise<Response>}} k @param {object} noiDung */
const taoDon = async (k, noiDung) => {
  const res = await k.khach('/v1/console/orders', {
    method: 'POST',
    body: JSON.stringify(noiDung),
  });
  const body = await res.json();
  return { status: res.status, order: body.order, body };
};

/** @param {object} than */
const webhook = (than) =>
  fetch(`${base}/v1/pay/payos/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(than),
  });

/** @param {string} bieuThuc */
const cron = (bieuThuc) => fetch(`${base}/__scheduled?cron=${encodeURIComponent(bieuThuc)}`);

/** admin_audit ghi trong waitUntil nên có thể tới sau phản hồi. @param {string} action @param {string} target */
async function doiAudit(action, target) {
  for (let i = 0; i < 24; i += 1) {
    const rows = await sql`SELECT detail FROM admin_audit
      WHERE action = ${action} AND target = ${target}`;
    if (rows.length > 0) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

/** Chờ đơn tới trạng thái mong đợi (cron chạy trong waitUntil). @param {any} k @param {string} id @param {string} tt */
async function doiTrangThai(k, id, tt) {
  for (let i = 0; i < 24; i += 1) {
    const { order } = await (await k.khach(`/v1/console/orders/${id}`)).json();
    if (order.status === tt) return order;
    await new Promise((r) => setTimeout(r, 250));
  }
  return (await (await k.khach(`/v1/console/orders/${id}`)).json()).order;
}

describe('đơn hàng — trọn chặng', () => {
  it('mua Starter 3 tháng: webhook → fulfilled trong một request, sổ có kỳ đúng 3 tháng, bắn lại không cấp hai lần', async () => {
    const k = await dangKy('Công ty Mua Gói');

    const baoGia = await (
      await k.khach('/v1/console/orders/quote?kind=plan&tier=starter&months=3')
    ).json();
    expect(baoGia.amountVnd).toBe(1_950_000);

    const { status, order } = await taoDon(k, {
      kind: 'plan',
      tier: 'starter',
      months: 3,
      amount: 1,
    });
    expect(status).toBe(201);
    expect(order).toMatchObject({
      status: 'pending',
      amountVnd: 1_950_000,
      noiDungChuyenKhoan: `MLV${order.orderCode}`,
    });
    expect(order.checkoutUrl).toContain(`/web/fake-${order.orderCode}`);
    expect(order.qrCode).toContain('FAKEQR');

    // Khách "chuyển khoản": PayOS giả đánh dấu đã trả rồi bắn webhook vào API — đúng đường thật.
    const tra = await (
      await fetch(`${payosFake}/__fake/pay/${order.orderCode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: `${base}/v1/pay/payos/webhook`,
          reference: `FT-${order.orderCode}`,
        }),
      })
    ).json();
    expect(tra.webhookStatus).toBe(200);
    expect(tra.webhookBody).toMatchObject({ matched: true, duplicate: false, status: 'fulfilled' });

    const sau = await (await k.khach(`/v1/console/orders/${order.id}`)).json();
    expect(sau.order.status).toBe('fulfilled');
    expect(sau.order.paidAmountVnd).toBe(1_950_000);
    // Đơn xong rồi thì không trả mã QR nữa.
    expect(sau.order.qrCode).toBeNull();

    const usage = await (await k.khach('/v1/console/usage')).json();
    expect(usage).toMatchObject({ status: 'active', tier: 'starter' });

    const lichSu = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    const kyMua = lichSu.periods.filter((p) => p.lineItemId === order.id);
    expect(kyMua).toHaveLength(1);
    const dai = (Date.parse(kyMua[0].endsAt) - Date.parse(kyMua[0].startsAt)) / 86_400_000;
    expect(dai).toBeGreaterThanOrEqual(89);
    expect(dai).toBeLessThanOrEqual(92);
    expect(kyMua[0].paymentReference).toBe(`FT-${order.orderCode}`);

    // Tiêu chí 20.6: bắn lại đúng webhook → 200, không có kỳ thứ hai, payment_event không thêm dòng.
    const lai = await webhook(tra.webhook);
    expect(lai.status).toBe(200);
    expect(await lai.json()).toMatchObject({ duplicate: true });
    const lichSu2 = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    expect(lichSu2.periods.filter((p) => p.lineItemId === order.id)).toHaveLength(1);
    expect(
      await sql`SELECT count(*)::int AS n FROM payment_event WHERE order_id = ${order.id}::uuid`,
    ).toEqual([{ n: 1 }]);

    expect(await doiAudit('order.fulfilled', order.id)).toHaveLength(1);
    expect(await doiAudit('order.paid', order.id)).toHaveLength(1);
  });

  it('sai chữ ký → 400, đơn đứng im, admin thấy ở mục giao dịch không khớp', async () => {
    const k = await dangKy('Công ty Chữ Ký');
    const { order } = await taoDon(k, { kind: 'plan', tier: 'starter', months: 1 });
    const gia = dungWebhook(
      { orderCode: order.orderCode, amount: 650_000, reference: 'FT-GIA' },
      'khoa-sai',
    );
    expect((await webhook(gia)).status).toBe(400);
    expect((await (await k.khach(`/v1/console/orders/${order.id}`)).json()).order.status).toBe(
      'pending',
    );
    const um = await (await adminFetch('/v1/admin/payment-events/unmatched')).json();
    expect(
      um.items.some((s) => s.signatureValid === false && s.reference.startsWith('invalid:')),
    ).toBe(true);
  });

  it('chuyển thiếu → underpaid; admin xác nhận tay phần còn thiếu → fulfilled; gọi lại không thêm sự kiện', async () => {
    const k = await dangKy('Công ty Thiếu Tiền');
    const { order } = await taoDon(k, { kind: 'plan', tier: 'starter', months: 1 });
    const thieu = await webhook(
      dungWebhook(
        { orderCode: order.orderCode, amount: 600_000, reference: `FT-THIEU-${order.orderCode}` },
        FAKE_CHECKSUM,
      ),
    );
    expect(await thieu.json()).toMatchObject({ status: 'underpaid' });
    expect((await (await k.khach(`/v1/console/orders/${order.id}`)).json()).order).toMatchObject({
      status: 'underpaid',
      paidAmountVnd: 600_000,
    });

    const than = {
      operationId: `op-${order.orderCode}`,
      reason: 'Thấy 50.000 trong sao kê',
      bankReference: 'FT-TAY',
    };
    const xacNhan = await adminFetch(`/v1/admin/orders/${order.id}/confirm-manual`, {
      method: 'POST',
      body: JSON.stringify(than),
    });
    expect(xacNhan.status).toBe(200);
    expect(await xacNhan.json()).toMatchObject({ ketQua: 'fulfilled', moi: true });

    const lai = await adminFetch(`/v1/admin/orders/${order.id}/confirm-manual`, {
      method: 'POST',
      body: JSON.stringify(than),
    });
    expect(await lai.json()).toMatchObject({ moi: false });
    expect(
      await sql`SELECT provider, amount_vnd::int AS a FROM payment_event
        WHERE order_id = ${order.id}::uuid ORDER BY id`,
    ).toEqual([
      { provider: 'payos', a: 600_000 },
      { provider: 'manual', a: 50_000 },
    ]);
    const audit = await doiAudit('admin.order.confirm_manual', order.id);
    expect(audit[0].detail.bank_reference).toBe('FT-TAY');
  });

  it('webhook rơi: cron đối soát hỏi PayOS, thấy PAID, tự dựng sự kiện và cấp (tiêu chí 20.7)', async () => {
    const k = await dangKy('Công ty Webhook Rơi');
    const { order } = await taoDon(k, { kind: 'plan', tier: 'starter', months: 1 });
    // Trả ở PayOS giả nhưng KHÔNG bắn webhook.
    await fetch(`${payosFake}/__fake/pay/${order.orderCode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference: `FT-ROI-${order.orderCode}` }),
    });
    // Đơn phải "tạo quá 10 phút" mới được đối soát; lùi created_at bằng role chủ sở hữu.
    await sql`UPDATE customer_order SET created_at = now() - interval '11 minutes'
      WHERE id = ${order.id}::uuid`;
    expect((await cron('*/5 * * * *')).ok).toBe(true);
    expect((await doiTrangThai(k, order.id, 'fulfilled')).status).toBe('fulfilled');
    expect(
      await sql`SELECT reference FROM payment_event WHERE order_id = ${order.id}::uuid`,
    ).toEqual([{ reference: `FT-ROI-${order.orderCode}` }]);
  });

  it('đơn quá hạn link → cron đóng thành expired; tiền vào SAU đó vẫn được cấp', async () => {
    const k = await dangKy('Công ty Quá Hạn');
    const { order } = await taoDon(k, { kind: 'plan', tier: 'starter', months: 1 });
    await sql`UPDATE customer_order SET link_expires_at = now() - interval '2 hours'
      WHERE id = ${order.id}::uuid`;
    await cron('*/5 * * * *');
    expect((await doiTrangThai(k, order.id, 'expired')).status).toBe('expired');

    const tra = await webhook(
      dungWebhook(
        { orderCode: order.orderCode, amount: 650_000, reference: `FT-MUON-${order.orderCode}` },
        FAKE_CHECKSUM,
      ),
    );
    expect(await tra.json()).toMatchObject({ status: 'fulfilled' });
  });

  it('tài khoản A không đọc, không huỷ được đơn của B; B huỷ được đơn của mình', async () => {
    const a = await dangKy('Công ty A');
    const b = await dangKy('Công ty B');
    const { order } = await taoDon(b, { kind: 'plan', tier: 'starter', months: 1 });
    expect((await a.khach(`/v1/console/orders/${order.id}`)).status).toBe(404);
    expect(
      (await a.khach(`/v1/console/orders/${order.id}/cancel`, { method: 'POST', body: '{}' }))
        .status,
    ).toBe(404);

    const huy = await b.khach(`/v1/console/orders/${order.id}/cancel`, {
      method: 'POST',
      body: '{}',
    });
    expect(huy.status).toBe(200);
    expect((await huy.json()).order.status).toBe('cancelled');
    // PayOS cũng phải thấy link đã huỷ, không chỉ DB của ta.
    const tt = await (
      await fetch(`${payosFake}/v2/payment-requests/${order.orderCode}`, {
        headers: { 'x-client-id': 'fake-client-id', 'x-api-key': 'fake-api-key' },
      })
    ).json();
    expect(tt.data.status).toBe('CANCELLED');
  });

  it('mua thêm lượt: chặn khi đang dùng thử, cộng đúng kỳ hiện tại khi đã trả phí', async () => {
    const k = await dangKy('Công ty Mua Lượt');
    expect((await k.khach('/v1/console/orders/quote?kind=addon&group=places&packs=2')).status).toBe(
      409,
    );

    const { order: goi } = await taoDon(k, { kind: 'plan', tier: 'starter', months: 1 });
    await webhook(
      dungWebhook(
        { orderCode: goi.orderCode, amount: 650_000, reference: `FT-G-${goi.orderCode}` },
        FAKE_CHECKSUM,
      ),
    );

    const { order: luot } = await taoDon(k, { kind: 'addon', group: 'places', packs: 2 });
    expect(luot.amountVnd).toBe(52_000);
    const kq = await webhook(
      dungWebhook(
        { orderCode: luot.orderCode, amount: 52_000, reference: `FT-L-${luot.orderCode}` },
        FAKE_CHECKSUM,
      ),
    );
    expect(await kq.json()).toMatchObject({ status: 'fulfilled' });

    const lichSu = await (await adminFetch(`/v1/admin/billing/${k.tenantId}/periods`)).json();
    expect(lichSu.credits.some((c) => c.lineItemId === luot.id && c.units === 2_000)).toBe(true);
    const usage = await (await k.khach('/v1/console/usage')).json();
    expect(usage.places.credits).toBe(2_000);
  });

  it('admin: danh sách lọc được, summary có doanh thu, chi tiết có sự kiện và chủ tổ chức', async () => {
    const ds = await (await adminFetch('/v1/admin/orders?status=fulfilled&limit=5')).json();
    expect(ds.items.length).toBeGreaterThan(0);
    expect(ds.items[0]).toHaveProperty('tenantName');
    const tomTat = await (await adminFetch('/v1/admin/orders/summary')).json();
    expect(tomTat.doanhThu30Ngay).toBeGreaterThan(0);
    const chiTiet = await (await adminFetch(`/v1/admin/orders/${ds.items[0].id}`)).json();
    expect(chiTiet.events.length).toBeGreaterThan(0);
    expect(chiTiet.owner.email).toContain('@vidu.vn');
  });

  it('route đơn hàng admin đứng sau cổng billing: email ngoài danh sách nhận 403', async () => {
    const la = signAccessJwt({ email: 'nguoi-la@access-fake.local' });
    const res = await fetch(`${base}/v1/admin/orders`, {
      headers: { 'Cf-Access-Jwt-Assertion': la },
    });
    expect(res.status).toBe(403);
  });
});
