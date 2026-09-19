import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand } from '../src/billing/types';
import type { DonHang } from '../src/commerce/db';
import type { PayosPort } from '../src/commerce/payos';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { adminOrdersWith } from '../src/routes/admin-orders';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-19T03:00:00Z');
/** Mốc DB ghi khi UPDATE — khác NOW để bài kiểm phân biệt được với `updated_at` cũ đọc trước ghi. */
const NOW_MOI = new Date('2026-09-19T03:05:00Z');
const moi = { ...env, ENVIRONMENT: 'test', SUPPORT_EMAIL: 'ho-tro@vidu.vn' } as unknown as Env;

type DonAdmin = DonHang & { tenant_name?: string; cursor_at?: string };

const don = (them: Partial<DonAdmin> = {}): DonAdmin => ({
  id: ORDER,
  order_code: 100001,
  tenant_id: TENANT,
  account_id: 'a',
  kind: 'plan',
  tier: 'starter',
  months: 1,
  quota_group: null,
  packs: null,
  amount_vnd: 650_000,
  amount_usd_cents: 2_500,
  status: 'pending',
  provider: 'payos',
  payment_link_id: 'l',
  checkout_url: 'u',
  qr_code: null,
  link_expires_at: null,
  paid_at: null,
  paid_amount_vnd: null,
  fulfilled_at: null,
  fulfil_attempts: 0,
  fulfil_error: null,
  entitlement_receipt: null,
  note: null,
  created_at: NOW,
  updated_at: NOW,
  tenant_name: 'Công ty Thử',
  cursor_at: '2026-09-19T03:00:00.000000Z',
  ...them,
});

interface DongAudit {
  action: string;
  target: string;
  detail: Record<string, unknown>;
}

function kho(tuyChon: { danhSach?: DonAdmin[]; don?: DonAdmin | null; trungRef?: boolean } = {}) {
  let hienTai = tuyChon.don === undefined ? don() : tuyChon.don;
  const suKien: { ref: string; amount: number | null; provider: string }[] = [];
  const audit: DongAudit[] = [];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('JOIN tenant t ON t.id = o.tenant_id')) return tuyChon.danhSach ?? [];
    if (q.text.includes('FROM customer_order WHERE id')) return hienTai ? [hienTai] : [];
    if (q.text.includes('AS cho_xu_ly')) {
      return [{ cho_xu_ly: 2, doanh_thu: 3_250_000, pending_qua: 1, khong_khop: 4 }];
    }
    if (q.text.includes('WHERE order_id IS NULL ORDER BY received_at')) {
      return [
        {
          id: 9,
          order_id: null,
          provider: 'payos',
          reference: 'invalid:abc',
          order_code: null,
          amount_vnd: null,
          signature_valid: false,
          tom_tat: {},
          received_at: NOW,
        },
      ];
    }
    if (q.text.includes('WHERE provider = $')) return [{ co: tuyChon.trungRef === true }];
    // `coalesce(sum` phải đứng TRƯỚC câu liệt kê sự kiện: tongTienDaNhan cũng đọc payment_event.
    if (q.text.includes('coalesce(sum(amount_vnd)')) {
      return [
        {
          tong: suKien.reduce((t, s) => t + (s.amount ?? 0), 0),
          tham_chieu: suKien[0]?.ref ?? null,
          luc: NOW,
        },
      ];
    }
    if (q.text.includes('FROM payment_event') && q.text.includes('ORDER BY id')) return [];
    if (q.text.includes('INSERT INTO payment_event')) {
      if (tuyChon.trungRef) return [];
      suKien.push({
        ref: q.params[2] as string,
        amount: q.params[4] as number | null,
        provider: q.params[1] as string,
      });
      return [{ id: 1 }];
    }
    if (q.text.includes("SET status = 'paid',") && hienTai) {
      hienTai = { ...hienTai, status: 'paid' };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'fulfilled'") && hienTai) {
      hienTai = { ...hienTai, status: 'fulfilled' };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'cancelled'") && hienTai) {
      if (hienTai.status !== 'pending') return [];
      hienTai = {
        ...hienTai,
        status: 'cancelled',
        note: q.params[0] as string,
        updated_at: NOW_MOI,
      };
      return [{ id: ORDER, updated_at: NOW_MOI }];
    }
    if (q.text.includes("SET status = 'refunded'") && hienTai) {
      if (!['fulfilled', 'paid_unfulfilled', 'underpaid'].includes(hienTai.status)) return [];
      hienTai = {
        ...hienTai,
        status: 'refunded',
        note: q.params[0] as string,
        updated_at: NOW_MOI,
      };
      return [{ id: ORDER, updated_at: NOW_MOI }];
    }
    if (q.text.includes('tenant_member')) {
      return [{ email: 'khach@vidu.vn', billing_email: null, name: 'Công ty Thử' }];
    }
    if (q.text.includes("action = 'email.sent'")) return [{ n: 0 }];
    return [];
  });
  return { sql, calls, suKien, audit, doc: () => hienTai };
}

const soGia = () => {
  const lenh: EntitlementCommand[] = [];
  return {
    lenh,
    so: {
      readUsage: vi.fn(async () => ({
        tenantId: TENANT,
        status: 'active' as const,
        tier: 'trial' as const,
        revision: 1,
        periodId: 't',
        startsAt: null,
        endsAt: null,
        trialUsedOnce: true,
        maintenance: false,
        missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
        places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
        directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
      })),
      readPeriods: vi.fn(async () => ({ periods: [], credits: [] })),
      applyCommand: vi.fn(async (c: EntitlementCommand): Promise<CommandReceipt> => {
        lenh.push(c);
        return {
          operationId: c.operationId,
          revision: 2,
          status: 'active',
          tier: 'starter',
          appliedAt: NOW.toISOString(),
        };
      }),
    },
  };
};

const boiCanh = () =>
  ({
    waitUntil: (p: Promise<unknown>) => void p.catch(() => {}),
    passThroughOnException: () => {},
  }) as unknown as ExecutionContext;

const payosGia = (huyLink: PayosPort['huyLink'] = vi.fn(async () => {})) =>
  ({
    ten: 'payos',
    taoLink: vi.fn(),
    docLink: vi.fn(),
    huyLink,
    checkoutUrlTuId: (id: string) => `https://pay/web/${id}`,
  }) as unknown as PayosPort;

function app(
  k: ReturnType<typeof kho>,
  so: ReturnType<typeof soGia>['so'] = soGia().so,
  email: string | null = 'billing@test.local',
  payos: PayosPort = payosGia(),
) {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.use('*', async (c, next) => {
    if (!email) return c.json({ error: { code: 'missing_access_jwt' } }, 401);
    c.set('reviewer', email);
    await next();
  });
  a.route(
    '/',
    adminOrdersWith({
      sql: () => k.sql,
      so: () => so,
      now: () => NOW,
      payos: () => payos,
      emailPort: () => ({ ten: 'debug', send: vi.fn().mockResolvedValue({ id: 'r' }) }),
      writeAuditEntry: (e) => k.audit.push(e as DongAudit),
    }),
  );
  return a;
}

const get = (a: Hono<AppEnv>, d: string) => a.request(`https://api${d}`, {}, moi, boiCanh());
const post = (a: Hono<AppEnv>, d: string, body: unknown) =>
  a.request(
    `https://api${d}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    moi,
    boiCanh(),
  );

describe('admin orders — cổng', () => {
  it('không có reviewer → 401', async () => {
    expect((await get(app(kho(), soGia().so, null), '/v1/admin/orders')).status).toBe(401);
  });
});

describe('GET /v1/admin/orders', () => {
  it('danh sách có tenantName, nextCursor khi dư một dòng, lọc theo status', async () => {
    const ds = Array.from({ length: 26 }, (_, i) =>
      don({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}` }),
    );
    const k = kho({ danhSach: ds });
    const res = await get(app(k), '/v1/admin/orders?status=pending&limit=25');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(25);
    expect(body.items[0]?.tenantName).toBe('Công ty Thử');
    // cursor_at là chi tiết phân trang của máy chủ, không phải dữ liệu của đơn.
    expect(body.items[0]).not.toHaveProperty('cursorAt');
    expect(body.nextCursor).toMatch(/\|/);
    expect(k.calls[0]?.params).toContain('pending');
  });

  it('status lạ → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?status=vip')).status).toBe(400);
  });

  it('cursor sai định dạng → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?cursor=rac')).status).toBe(400);
  });

  it('summary trả bốn ô', async () => {
    const res = await get(app(kho()), '/v1/admin/orders/summary');
    expect(await res.json()).toEqual({
      choXuLy: 2,
      doanhThu30Ngay: 3_250_000,
      pendingQua1Gio: 1,
      khongKhop: 4,
    });
  });

  it('unmatched trả sự kiện order_id NULL', async () => {
    const res = await get(app(kho()), '/v1/admin/payment-events/unmatched');
    const body = (await res.json()) as { items: { reference: string; signatureValid: boolean }[] };
    expect(body.items[0]).toMatchObject({ reference: 'invalid:abc', signatureValid: false });
  });

  it('lọc tenant + khoảng ngày: ngày-chỉ-có-ngày thành ranh giới ngày giờ Việt Nam', async () => {
    const k = kho({ danhSach: [] });
    const res = await get(
      app(k),
      `/v1/admin/orders?tenant=${TENANT}&from=2026-09-01&to=2026-09-19`,
    );
    expect(res.status).toBe(200);
    const params = k.calls[0]?.params ?? [];
    expect(params).toContain(TENANT);
    // 00:00 ngày 01/09 giờ VN = 17:00 ngày 31/08 UTC; "đến 19/09" = trước 00:00 ngày 20/09 giờ VN.
    expect(
      params.some((p) => p instanceof Date && p.toISOString() === '2026-08-31T17:00:00.000Z'),
    ).toBe(true);
    expect(
      params.some((p) => p instanceof Date && p.toISOString() === '2026-09-19T17:00:00.000Z'),
    ).toBe(true);
  });

  it('mốc ISO đầy đủ giữ nguyên, không cộng ngày', async () => {
    const k = kho({ danhSach: [] });
    await get(app(k), '/v1/admin/orders?to=2026-09-19T03:00:00Z');
    const params = k.calls[0]?.params ?? [];
    expect(
      params.some((p) => p instanceof Date && p.toISOString() === '2026-09-19T03:00:00.000Z'),
    ).toBe(true);
  });

  it('tenant không phải uuid → 400; from rác → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?tenant=rac')).status).toBe(400);
    expect((await get(app(kho()), '/v1/admin/orders?from=hom-qua')).status).toBe(400);
  });

  it('ngày không tồn tại → 400 (không được cuộn sang tháng sau)', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?from=2026-02-31')).status).toBe(400);
    expect((await get(app(kho()), '/v1/admin/orders?to=2026-09-31')).status).toBe(400);
  });

  it('mốc ISO thiếu offset → 400 (không được đọc theo giờ máy chủ)', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?to=2026-09-19T03:00:00')).status).toBe(400);
    expect(
      (await get(app(kho()), `/v1/admin/orders?to=${encodeURIComponent('2026-09-19 03:00:00')}`))
        .status,
    ).toBe(400);
  });

  it('from lớn hơn to → 400', async () => {
    expect((await get(app(kho()), '/v1/admin/orders?from=2026-09-20&to=2026-09-01')).status).toBe(
      400,
    );
  });
});

describe('GET /v1/admin/orders/:id', () => {
  it('đơn + sự kiện + chủ tổ chức; 404 khi không có', async () => {
    const res = await get(app(kho()), `/v1/admin/orders/${ORDER}`);
    const body = (await res.json()) as {
      order: { id: string; tenantId: string; checkoutUrl: string | null };
      events: unknown[];
      owner: { email: string };
    };
    expect(body.order).toMatchObject({ id: ORDER, tenantId: TENANT });
    // Admin thấy checkoutUrl ở mọi trạng thái để đối chiếu với PayOS; khách thì không.
    expect(body.order.checkoutUrl).toBe('u');
    expect(body.owner.email).toBe('khach@vidu.vn');
    expect((await get(app(kho({ don: null })), `/v1/admin/orders/${ORDER}`)).status).toBe(404);
  });
});

describe('POST /v1/admin/orders/:id/fulfil', () => {
  it('đơn paid_unfulfilled → cấp, audit admin.order.fulfil', async () => {
    const k = kho({ don: don({ status: 'paid_unfulfilled', paid_amount_vnd: 650_000 }) });
    k.suKien.push({ ref: 'FT1', amount: 650_000, provider: 'payos' });
    const { so, lenh } = soGia();
    const res = await post(app(k, so), `/v1/admin/orders/${ORDER}/fulfil`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ order: { status: 'fulfilled' } });
    expect(lenh).toHaveLength(1);
    expect(k.audit.map((d) => d.action)).toContain('admin.order.fulfil');
  });

  it('đơn pending → 409 order_not_fulfillable', async () => {
    const res = await post(app(kho()), `/v1/admin/orders/${ORDER}/fulfil`, {});
    expect(res.status).toBe(409);
  });
});

describe('POST /v1/admin/orders/:id/confirm-manual', () => {
  const than = {
    operationId: 'op-12345678',
    reason: 'Thấy tiền trong sao kê',
    bankReference: 'FT9999',
  };

  it('thiếu lý do, mã ngân hàng hoặc operationId hợp lệ → 400', async () => {
    const a = app(kho());
    for (const xau of [
      { ...than, reason: '' },
      { ...than, bankReference: '' },
      { ...than, operationId: 'x' },
    ]) {
      expect((await post(a, `/v1/admin/orders/${ORDER}/confirm-manual`, xau)).status).toBe(400);
    }
  });

  it('pending → sự kiện manual:<operationId> đúng số còn thiếu → paid → fulfilled; audit giữ lý do', async () => {
    const k = kho();
    const { so, lenh } = soGia();
    const res = await post(app(k, so), `/v1/admin/orders/${ORDER}/confirm-manual`, than);
    expect(res.status).toBe(200);
    expect(k.suKien[0]).toEqual({
      ref: 'manual:op-12345678',
      amount: 650_000,
      provider: 'manual',
    });
    expect(lenh).toHaveLength(1);
    expect(k.doc()?.status).toBe('fulfilled');
    const audit = k.audit.find((d) => d.action === 'admin.order.confirm_manual');
    expect(audit?.detail).toMatchObject({
      reason: 'Thấy tiền trong sao kê',
      bank_reference: 'FT9999',
      operation_id: 'op-12345678',
      ket_qua: 'fulfilled',
    });
  });

  it('cùng operationId gọi lần hai sau khi đã xong → 200 moi:false, không thêm sự kiện', async () => {
    const k = kho({ trungRef: true, don: don({ status: 'fulfilled' }) });
    const res = await post(app(k), `/v1/admin/orders/${ORDER}/confirm-manual`, than);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ moi: false });
    expect(k.suKien).toHaveLength(0);
  });

  it('operationId LẠ trên đơn đã xong → 409 order_not_confirmable', async () => {
    const k = kho({ don: don({ status: 'fulfilled' }) });
    expect((await post(app(k), `/v1/admin/orders/${ORDER}/confirm-manual`, than)).status).toBe(409);
  });

  it('nhập số tiền cụ thể thì dùng đúng số đó', async () => {
    const k = kho();
    await post(app(k), `/v1/admin/orders/${ORDER}/confirm-manual`, { ...than, amountVnd: 50_000 });
    expect(k.suKien[0]?.amount).toBe(50_000);
  });

  it('số tiền âm → 400', async () => {
    const res = await post(app(kho()), `/v1/admin/orders/${ORDER}/confirm-manual`, {
      ...than,
      amountVnd: -1,
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/admin/orders/:id/cancel', () => {
  const than = { operationId: 'op-huy-0001', reason: 'Khách đổi ý, chưa chuyển tiền' };

  it('pending có link → gọi PayOS huỷ đúng orderCode, rồi cancelled; audit giữ lý do', async () => {
    const k = kho();
    const huyLink = vi.fn(async () => {});
    const res = await post(
      app(k, undefined, undefined, payosGia(huyLink)),
      `/v1/admin/orders/${ORDER}/cancel`,
      than,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order: { status: string; note: string; updatedAt: string };
    };
    expect(body).toMatchObject({
      order: { status: 'cancelled', note: than.reason },
      moi: true,
    });
    // updatedAt phải là mốc CHÍNH CÂU UPDATE ghi (NOW_MOI), không phải updated_at cũ đọc TRƯỚC khi
    // ghi (NOW, mốc mặc định của don()) — bài học pha 4: đọc rồi tự gán lại mốc cũ.
    expect(body.order.updatedAt).toBe(NOW_MOI.toISOString());
    expect(huyLink).toHaveBeenCalledWith(100001, expect.stringContaining('Khách đổi ý'));
    expect(k.doc()?.status).toBe('cancelled');
    expect(k.audit.find((d) => d.action === 'admin.order.cancel')?.detail).toMatchObject({
      reason: than.reason,
      operation_id: 'op-huy-0001',
      order_code: 100001,
    });
  });

  it('pending chưa có link → không gọi PayOS, vẫn cancelled', async () => {
    const k = kho({ don: don({ payment_link_id: null, checkout_url: null }) });
    const huyLink = vi.fn(async () => {});
    const res = await post(
      app(k, undefined, undefined, payosGia(huyLink)),
      `/v1/admin/orders/${ORDER}/cancel`,
      than,
    );
    expect(res.status).toBe(200);
    expect(huyLink).not.toHaveBeenCalled();
  });

  it('PayOS lỗi → 503 payment_provider_unavailable và đơn ĐỨNG IM ở pending', async () => {
    const k = kho();
    const huyLink = vi.fn(async () => {
      throw new Error('payos_unreachable');
    });
    const res = await post(
      app(k, undefined, undefined, payosGia(huyLink)),
      `/v1/admin/orders/${ORDER}/cancel`,
      than,
    );
    expect(res.status).toBe(503);
    expect(k.doc()?.status).toBe('pending');
    expect(k.audit.some((d) => d.action === 'admin.order.cancel')).toBe(false);
  });

  it('đã cancelled → 200 moi:false, không gọi PayOS; fulfilled → 409 order_not_cancellable', async () => {
    const huyLink = vi.fn(async () => {});
    const daHuy = await post(
      app(kho({ don: don({ status: 'cancelled' }) }), undefined, undefined, payosGia(huyLink)),
      `/v1/admin/orders/${ORDER}/cancel`,
      than,
    );
    expect(daHuy.status).toBe(200);
    expect(await daHuy.json()).toMatchObject({ moi: false });
    expect(huyLink).not.toHaveBeenCalled();

    const res = await post(
      app(kho({ don: don({ status: 'fulfilled' }) })),
      `/v1/admin/orders/${ORDER}/cancel`,
      than,
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'order_not_cancellable',
    );
  });

  it('thiếu reason hoặc operationId hợp lệ → 400', async () => {
    const a = app(kho());
    expect(
      (await post(a, `/v1/admin/orders/${ORDER}/cancel`, { ...than, reason: '  ' })).status,
    ).toBe(400);
    expect(
      (await post(a, `/v1/admin/orders/${ORDER}/cancel`, { ...than, operationId: 'x' })).status,
    ).toBe(400);
  });
});

describe('POST /v1/admin/orders/:id/refund', () => {
  const than = { operationId: 'op-hoan-0001', reason: 'Khách yêu cầu, đã chuyển trả 650.000' };

  it('fulfilled → refunded, không lệnh nào tới sổ quota; audit giữ lý do và số tiền đã nhận', async () => {
    const k = kho({ don: don({ status: 'fulfilled', paid_amount_vnd: 650_000 }) });
    const { so, lenh } = soGia();
    const res = await post(app(k, so), `/v1/admin/orders/${ORDER}/refund`, than);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order: { status: string; note: string; updatedAt: string };
    };
    expect(body).toMatchObject({
      order: { status: 'refunded', note: than.reason },
      moi: true,
    });
    // Cùng bài học với cancel: updatedAt phải là mốc chính câu UPDATE ghi, không phải bản đọc trước.
    expect(body.order.updatedAt).toBe(NOW_MOI.toISOString());
    expect(lenh).toHaveLength(0);
    expect(k.audit.find((d) => d.action === 'admin.order.refund')?.detail).toMatchObject({
      reason: than.reason,
      operation_id: 'op-hoan-0001',
      paid_amount_vnd: 650_000,
    });
  });

  it('paid_unfulfilled và underpaid cũng đánh dấu được — đó là ca hoàn tiền hay gặp nhất', async () => {
    for (const status of ['paid_unfulfilled', 'underpaid'] as const) {
      const k = kho({ don: don({ status, paid_amount_vnd: 650_000 }) });
      const res = await post(app(k), `/v1/admin/orders/${ORDER}/refund`, than);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ order: { status: 'refunded' }, moi: true });
    }
  });

  it('đã refunded → 200 moi:false; pending và paid → 409 order_not_refundable', async () => {
    const lai = await post(
      app(kho({ don: don({ status: 'refunded' }) })),
      `/v1/admin/orders/${ORDER}/refund`,
      than,
    );
    expect(lai.status).toBe(200);
    expect(await lai.json()).toMatchObject({ moi: false });

    for (const status of ['pending', 'paid'] as const) {
      const res = await post(
        app(kho({ don: don({ status }) })),
        `/v1/admin/orders/${ORDER}/refund`,
        than,
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'order_not_refundable',
      );
    }
  });

  it('thiếu reason → 400 invalid_reason', async () => {
    const res = await post(
      app(kho({ don: don({ status: 'fulfilled' }) })),
      `/v1/admin/orders/${ORDER}/refund`,
      { operationId: 'op-hoan-0001' },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_reason');
  });
});
