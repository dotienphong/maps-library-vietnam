import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { signAccessJwt } from '../../../scripts/lib/access-fake.mjs';

const base = process.env.PLACES_API_BASE ?? 'http://127.0.0.1:8799';
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

/**
 * Mỗi bài dùng một tenant MỚI. Sổ quota là một Durable Object định danh theo uuid tenant, và sổ đó
 * sống trong .wrangler/state qua nhiều phiên; dùng lại tenant seed sẽ khiến bài kiểm chỉ đúng lần
 * chạy đầu (activateTrial nhận trial_already_used, mọi lệnh khác nhận revision_conflict).
 */
const taoTenant = async (name, plan = 'free') => {
  const id = crypto.randomUUID();
  await sql`INSERT INTO tenant (id, name, plan) VALUES (${id}::uuid, ${name}, ${plan})`;
  return id;
};

const capKhoa = async (tenantId, label) =>
  (
    await adminFetch(`/v1/admin/tenants/${tenantId}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, kind: 'server', scopes: ['places:read'] }),
    })
  ).json();

const guiLenh = (tenantId, body) =>
  adminFetch(`/v1/admin/billing/${tenantId}/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const doc = async (tenantId, duong) =>
  (await adminFetch(`/v1/admin/billing/${tenantId}/${duong}`)).json();
const ma = async (response) => (await response.json()).error?.code;

/** admin_audit ghi trong waitUntil nên có thể tới sau phản hồi. */
const doiAudit = async (action, target, soDong) => {
  let rows = [];
  for (let i = 0; i < 20 && rows.length < soDong; i += 1) {
    rows = await sql`SELECT actor, action, target, detail FROM admin_audit
      WHERE action = ${action} AND target = ${target} ORDER BY id`;
    if (rows.length < soDong) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return rows;
};

describe('GET /v1/admin/plan-catalog', () => {
  it('trả bảng giá khớp PLAN_CATALOG', async () => {
    const body = await (await adminFetch('/v1/admin/plan-catalog')).json();
    expect(body.tiers.map((item) => item.tier)).toEqual([
      'trial',
      'starter',
      'professional',
      'business',
    ]);
    expect(body.legacyDefaults.blockAtMultiple).toBe(2);
  });
});

describe('bản dùng thử', () => {
  it('kích hoạt trial rồi đọc lại usage: hạn mức đúng bậc trial, revision tăng 1', async () => {
    const tenantId = await taoTenant('itest trial');
    const truoc = await doc(tenantId, 'usage');
    expect(truoc.status).toBe('none');
    expect(truoc.revision).toBe(0);

    const response = await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest bật dùng thử',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ revision: 1, status: 'active', tier: 'trial' });

    const sau = await doc(tenantId, 'usage');
    expect(sau.status).toBe('active');
    expect(sau.tier).toBe('trial');
    expect(sau.places.limit).toBe(2_000);
    expect(sau.directions.limit).toBe(200);
    expect(sau.trialUsedOnce).toBe(true);
  });

  it('bật lần thứ hai → 409 trial_already_used, không phải 503', async () => {
    const tenantId = await taoTenant('itest trial hai lần');
    await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'lần một',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    const lai = await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'lần hai',
      expectedRevision: 1,
      startsAt: new Date().toISOString(),
    });
    expect(lai.status).toBe(409);
    expect(await ma(lai)).toBe('trial_already_used');
  });
});

describe('cấp kỳ trả phí, cộng credit và các cổng chặn', () => {
  it('luồng đầy đủ: cấp kỳ → cộng credit → usage và periods khớp nhau', async () => {
    const tenantId = await taoTenant('itest cấp kỳ');
    const periodId = crypto.randomUUID();
    const paymentReference = `CK-${Date.now()}`;

    const cap = await guiLenh(tenantId, {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      reason: 'itest cấp kỳ starter',
      expectedRevision: 0,
      periodId,
      tier: 'starter',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paymentReference,
      lineItemId: 'period-1',
    });
    expect(cap.status).toBe(200);
    expect(await cap.json()).toMatchObject({ revision: 1, status: 'active', tier: 'starter' });

    const themCredit = await guiLenh(tenantId, {
      kind: 'addCredits',
      operationId: crypto.randomUUID(),
      reason: 'itest mua thêm',
      expectedRevision: 1,
      periodId,
      group: 'places',
      packs: 2,
      paymentReference,
      lineItemId: 'credits-1',
    });
    expect(themCredit.status).toBe(200);

    const usage = await doc(tenantId, 'usage');
    expect(usage.tier).toBe('starter');
    expect(usage.places.limit).toBe(30_000);
    expect(usage.places.credits).toBe(2_000);
    expect(usage.places.available).toBe(32_000);
    expect(usage.periodId).toBe(periodId);

    const history = await doc(tenantId, 'periods');
    expect(history.periods).toHaveLength(1);
    expect(history.periods[0]).toMatchObject({ periodId, tier: 'starter', lineItemId: 'period-1' });
    expect(history.credits).toHaveLength(1);
    expect(history.credits[0]).toMatchObject({
      group: 'places',
      units: 2_000,
      lineItemId: 'credits-1',
    });
  });

  it('gửi lại y nguyên một lệnh (cùng operationId) KHÔNG cộng tiền lần hai', async () => {
    const tenantId = await taoTenant('itest idempotent');
    const lenh = {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      reason: 'itest gửi lại',
      expectedRevision: 0,
      periodId: crypto.randomUUID(),
      tier: 'starter',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paymentReference: `CK-${Date.now()}-idem`,
      lineItemId: 'period-1',
    };
    const lan1 = await (await guiLenh(tenantId, lenh)).json();
    const lan2 = await (await guiLenh(tenantId, lenh)).json();
    // Cùng biên lai, cùng revision: đây chính là cách duy nhất an toàn để thử lại sau một 503.
    expect(lan2).toEqual(lan1);
    expect((await doc(tenantId, 'periods')).periods).toHaveLength(1);
  });

  it('revision cũ → 409 revision_conflict', async () => {
    const tenantId = await taoTenant('itest revision');
    await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    const cu = await guiLenh(tenantId, {
      kind: 'suspend',
      operationId: crypto.randomUUID(),
      reason: 'itest revision cũ',
      expectedRevision: 0,
    });
    expect(cu.status).toBe(409);
    expect(await ma(cu)).toBe('revision_conflict');
  });

  it('cùng mã thanh toán + dòng hoá đơn nhưng khác nội dung → 409 business_identity_conflict', async () => {
    const tenantId = await taoTenant('itest business identity');
    const paymentReference = `CK-${Date.now()}-bi`;
    const chung = {
      reason: 'itest',
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      paymentReference,
      lineItemId: 'period-1',
    };
    await guiLenh(tenantId, {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      expectedRevision: 0,
      periodId: crypto.randomUUID(),
      tier: 'starter',
      ...chung,
    });
    const khac = await guiLenh(tenantId, {
      kind: 'grantPeriod',
      operationId: crypto.randomUUID(),
      expectedRevision: 1,
      periodId: crypto.randomUUID(),
      tier: 'professional',
      ...chung,
    });
    expect(khac.status).toBe(409);
    expect(await ma(khac)).toBe('business_identity_conflict');
  });

  it('cộng credit cho tenant chưa có thuê bao trả phí → 409 credits_require_paid_active', async () => {
    const tenantId = await taoTenant('itest credit sai chỗ');
    const response = await guiLenh(tenantId, {
      kind: 'addCredits',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
      periodId: crypto.randomUUID(),
      group: 'places',
      packs: 1,
      paymentReference: `CK-${Date.now()}-x`,
      lineItemId: 'credits-1',
    });
    expect(response.status).toBe(409);
    expect(await ma(response)).toBe('credits_require_paid_active');
  });

  it('tạm dừng khi chưa có quyền nào → 409 no_entitlement', async () => {
    const tenantId = await taoTenant('itest no entitlement');
    const response = await guiLenh(tenantId, {
      kind: 'suspend',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
    });
    expect(response.status).toBe(409);
    expect(await ma(response)).toBe('no_entitlement');
  });

  it('thân lệnh có trường lạ → 400 invalid_command (allowlist đóng cả hai chiều)', async () => {
    const tenantId = await taoTenant('itest trường lạ');
    const response = await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
      ghiChu: 'trường này không tồn tại trong hợp đồng',
    });
    expect(response.status).toBe(400);
    expect(await ma(response)).toBe('invalid_command');
  });
});

describe('nhật ký kiểm toán và cổng bảo vệ', () => {
  it('mỗi lệnh thành công để lại đúng một dòng admin_audit với đúng actor', async () => {
    const tenantId = await taoTenant('itest audit');
    await guiLenh(tenantId, {
      kind: 'activateTrial',
      operationId: crypto.randomUUID(),
      reason: 'itest audit',
      expectedRevision: 0,
      startsAt: new Date().toISOString(),
    });
    const rows = await doiAudit('billing.command', tenantId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe('phong@access-fake.local');
    expect(rows[0].detail.kind).toBe('activateTrial');
    expect(rows[0].detail.revision).toBe(1);
  });

  it('mở khoá ack ghi audit kèm lý do', async () => {
    const tenantId = await taoTenant('itest unlock');
    const response = await adminFetch(`/v1/admin/billing/${tenantId}/missing-acks/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: crypto.randomUUID(), reason: 'công cụ khách quên ACK' }),
    });
    expect(response.status).toBe(200);
    const rows = await doiAudit('billing.unlock_acks', tenantId, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].detail.reason).toBe('công cụ khách quên ACK');
  });

  it('POST từ trang lạ → 403 cross_site_request, không chạm tới sổ', async () => {
    const tenantId = await taoTenant('itest csrf');
    const response = await fetch(`${base}/v1/admin/billing/${tenantId}/commands`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': jwt,
        'Sec-Fetch-Site': 'cross-site',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        kind: 'activateTrial',
        operationId: crypto.randomUUID(),
        reason: 'kẻ lạ',
        expectedRevision: 0,
        startsAt: new Date().toISOString(),
      }),
    });
    expect(response.status).toBe(403);
    expect(await ma(response)).toBe('cross_site_request');
    expect((await doc(tenantId, 'usage')).status).toBe('none');
  });

  it('email ngoài BILLING_ADMIN_EMAILS → 403 billing_admin_forbidden', async () => {
    const tenantId = await taoTenant('itest quyền');
    const response = await fetch(`${base}/v1/admin/billing/${tenantId}/usage`, {
      headers: { 'Cf-Access-Jwt-Assertion': signAccessJwt({ email: 'nguoila@access-fake.local' }) },
    });
    expect(response.status).toBe(403);
    expect(await ma(response)).toBe('billing_admin_forbidden');
  });

  it('tenant không tồn tại → 404 ở cả hai route đọc mới', async () => {
    const ma404 = '11111111-1111-4111-8111-111111111111';
    expect((await adminFetch(`/v1/admin/billing/${ma404}/periods`)).status).toBe(404);
    expect((await adminFetch(`/v1/admin/billing/${ma404}/legacy-usage`)).status).toBe(404);
  });
});

describe('GET /v1/admin/billing/:id/legacy-usage', () => {
  it('đếm lượt gọi thật của từng khoá trong ngày', async () => {
    const tenantId = await taoTenant('itest legacy');
    const khoa = await capKhoa(tenantId, `itest legacy ${Date.now()}`);

    for (let i = 0; i < 3; i += 1) {
      const response = await fetch(`${base}/v1/places/${POI_ID}`, {
        headers: { 'X-Api-Key': khoa.key },
      });
      expect(response.status).toBe(200);
    }

    // Bộ đếm ghi trong waitUntil nên tới sau phản hồi.
    let body = null;
    for (let i = 0; i < 20; i += 1) {
      body = await doc(tenantId, 'legacy-usage');
      if (body.total.places.used >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(body.quotaEnabled).toBe(true);
    expect(body.counted).toBe(true);
    expect(body.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].keyPrefix).toBe(khoa.key_prefix);
    expect(body.keys[0].places.used).toBe(3);
    expect(body.keys[0].places.limit).toBe(20_000);
    expect(body.total.places.used).toBe(3);
  });

  it('KHÔNG tạo sổ quota: đọc legacy-usage xong, usage vẫn là sổ trắng', async () => {
    const tenantId = await taoTenant('itest không tạo sổ');
    await doc(tenantId, 'legacy-usage');
    const usage = await doc(tenantId, 'usage');
    expect(usage).toMatchObject({ status: 'none', revision: 0, tier: null });
  });
});
