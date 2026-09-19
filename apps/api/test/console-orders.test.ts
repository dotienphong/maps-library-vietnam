import { env } from 'cloudflare:test';
import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { DonHang } from '../src/commerce/db';
import {
  type LinkThanhToan,
  PayosError,
  type PayosPort,
  type TaoLinkInput,
} from '../src/commerce/payos';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { consoleOrdersWith } from '../src/routes/console-orders';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const NOW = new Date('2026-09-19T03:00:00Z');

const moiTruong = (them: Record<string, unknown> = {}) =>
  ({
    ...env,
    ENVIRONMENT: 'test',
    SELF_SERVE: '1',
    SESSION_PEPPER: 'p',
    ...them,
  }) as unknown as Env;

const khach = {
  accountId: 'acc-1',
  email: 'khach@vidu.vn',
  name: null,
  tenantId: TENANT,
  tenantName: 'Công ty Thử',
  tokenHash: 'h',
};

const don = (them: Partial<DonHang> = {}): DonHang => ({
  id: ORDER,
  order_code: 100001,
  tenant_id: TENANT,
  account_id: 'acc-1',
  kind: 'plan',
  tier: 'starter',
  months: 3,
  quota_group: null,
  packs: null,
  amount_vnd: 1_950_000,
  amount_usd_cents: 7_500,
  status: 'pending',
  provider: 'payos',
  payment_link_id: null,
  checkout_url: null,
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
  ...them,
});

function kho(
  tuyChon: {
    quotaMode?: string;
    pending?: number;
    donCu?: DonHang | null;
    donTheoId?: DonHang | null;
  } = {},
) {
  return fakeSql((q: RecordedQuery) => {
    if (q.text.includes('FROM tenant WHERE id')) {
      return [
        {
          id: TENANT,
          name: 'Công ty Thử',
          plan: 'free',
          quota_mode: tuyChon.quotaMode ?? 'commercial',
          billing_name: null,
          billing_tax_code: null,
          billing_address: null,
          billing_email: null,
        },
      ];
    }
    if (q.text.includes('count(*)::int AS n FROM customer_order'))
      return [{ n: tuyChon.pending ?? 0 }];
    if (q.text.includes('payment_link_id IS NULL')) return tuyChon.donCu ? [tuyChon.donCu] : [];
    if (q.text.includes('INSERT INTO customer_order')) return [don()];
    if (q.text.includes('FROM customer_order') && q.text.includes('tenant_id')) {
      return tuyChon.donTheoId === undefined
        ? [don()]
        : tuyChon.donTheoId
          ? [tuyChon.donTheoId]
          : [];
    }
    if (q.text.includes("SET status = 'cancelled'")) return [{ id: ORDER }];
    return [];
  });
}

const link: LinkThanhToan = {
  paymentLinkId: 'link-1',
  checkoutUrl: 'https://pay.test/web/link-1',
  qrCode: '0002...',
};

function payosGia(tuyChon: { taoLoi?: PayosError; docLink?: unknown } = {}) {
  const port = {
    ten: 'payos' as const,
    checkoutUrlTuId: (id: string) => `https://pay.test/web/${id}`,
    // Khai tham số để test đọc được `mock.calls[0][0]` — vi.fn() không tham số cho ra tuple rỗng.
    taoLink: vi.fn(async (_input: TaoLinkInput) => {
      if (tuyChon.taoLoi) throw tuyChon.taoLoi;
      return link;
    }),
    docLink: vi.fn(async () => tuyChon.docLink ?? null),
    huyLink: vi.fn(async () => {}),
  };
  return port as unknown as PayosPort & typeof port;
}

const soGia = (tier: 'trial' | 'starter' = 'trial') => ({
  readUsage: async () => ({ status: 'active', tier, revision: 1, periodId: 'p' }),
  readPeriods: async () => ({ periods: [], credits: [] }),
  applyCommand: async () => {
    throw new Error('không dùng ở đây');
  },
});

function boiCanh() {
  const viecNen: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (p: Promise<unknown>) => viecNen.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    xong: () => Promise.all(viecNen),
  };
}

interface DongAudit {
  action: string;
  target: string;
  detail: Record<string, unknown>;
}
const nhatKy: DongAudit[] = [];

function app(
  k: ReturnType<typeof kho>,
  payos: PayosPort,
  tuyChon: { dangNhap?: boolean; tier?: 'trial' | 'starter' } = {},
) {
  nhatKy.length = 0;
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  const xacThuc: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('customer', khach);
    await next();
  };
  a.route(
    '/',
    consoleOrdersWith({
      sql: () => k.sql,
      payos: () => payos,
      so: () => soGia(tuyChon.tier ?? 'trial') as never,
      now: () => NOW,
      writeAuditEntry: (e) => nhatKy.push(e as DongAudit),
      ...(tuyChon.dangNhap === false ? {} : { xacThuc }),
    }),
  );
  return a;
}

const goi = (a: Hono<AppEnv>, duong: string, init: RequestInit = {}, moi = moiTruong()) =>
  a.request(`https://api${duong}`, init, moi, boiCanh().ctx);
const post = (a: Hono<AppEnv>, duong: string, body: unknown, moi = moiTruong()) =>
  goi(
    a,
    duong,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
    moi,
  );
const ma = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('cổng đăng nhập', () => {
  for (const [duong, method] of [
    ['/v1/console/orders', 'GET'],
    ['/v1/console/orders', 'POST'],
    ['/v1/console/orders/quote?kind=plan&tier=starter&months=1', 'GET'],
    [`/v1/console/orders/${ORDER}`, 'GET'],
    [`/v1/console/orders/${ORDER}/cancel`, 'POST'],
  ] as const) {
    it(`${method} ${duong} chưa đăng nhập → 401`, async () => {
      const res = await goi(app(kho(), payosGia(), { dangNhap: false }), duong, { method });
      expect(res.status).toBe(401);
    });
  }
});

describe('GET /v1/console/orders/quote', () => {
  it('gói: tiền máy chủ tính, hiệu lực từ now khi đang dùng thử, hết hạn +3 tháng', async () => {
    const res = await goi(
      app(kho(), payosGia()),
      '/v1/console/orders/quote?kind=plan&tier=starter&months=3',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      amountVnd: 1_950_000,
      amountUsdCents: 7_500,
      hieuLucTu: NOW.toISOString(),
      hetHanLuc: '2026-12-19T03:00:00.000Z',
    });
  });

  it('tier lạ → 400 invalid_tier; months lạ → 400 invalid_months', async () => {
    const a = app(kho(), payosGia());
    expect(await ma(await goi(a, '/v1/console/orders/quote?kind=plan&tier=vip&months=3'))).toBe(
      'invalid_tier',
    );
    expect(await ma(await goi(a, '/v1/console/orders/quote?kind=plan&tier=starter&months=5'))).toBe(
      'invalid_months',
    );
  });

  it('mua lượt khi đang dùng thử → 409 credits_require_paid_active', async () => {
    const res = await goi(
      app(kho(), payosGia()),
      '/v1/console/orders/quote?kind=addon&group=places&packs=5',
    );
    expect(res.status).toBe(409);
  });
});

describe('POST /v1/console/orders', () => {
  it('tạo đơn, gọi PayOS với tiền của MÁY CHỦ và returnUrl cùng origin, lưu link, 201', async () => {
    const k = kho();
    const payos = payosGia();
    // `amount: 1` trong thân là số client bịa ra — máy chủ phải bỏ qua hoàn toàn.
    const res = await post(app(k, payos), '/v1/console/orders', {
      kind: 'plan',
      tier: 'starter',
      months: 3,
      amount: 1,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { order: Record<string, unknown> };
    expect(body.order).toMatchObject({
      id: ORDER,
      orderCode: 100001,
      noiDungChuyenKhoan: 'MLV100001',
      amountVnd: 1_950_000,
      status: 'pending',
    });
    const goiPayos = payos.taoLink.mock.calls[0]?.[0] as TaoLinkInput;
    expect(goiPayos.amount).toBe(1_950_000);
    expect(goiPayos.description).toBe('MLV100001');
    expect(goiPayos.returnUrl).toBe(`https://api/console/don-hang/${ORDER}?ket-qua=thanh-cong`);
    expect(goiPayos.cancelUrl).toBe(`https://api/console/don-hang/${ORDER}?ket-qua=huy`);
    expect(goiPayos.expiredAt.getTime()).toBe(NOW.getTime() + 24 * 3_600_000);
    // Thông tin biên nhận của tổ chức đi kèm để PayOS dựng hoá đơn điện tử đúng tên.
    expect(goiPayos.buyerEmail).toBe('khach@vidu.vn');
    const luu = k.calls.find((c) => c.text.includes('payment_link_id = $'));
    expect(luu?.params).toEqual(expect.arrayContaining(['link-1', 'https://pay.test/web/link-1']));
  });

  it('tenant chưa ở chế độ thương mại → 409, không chạm PayOS', async () => {
    const payos = payosGia();
    const res = await post(app(kho({ quotaMode: 'legacy' }), payos), '/v1/console/orders', {
      kind: 'plan',
      tier: 'starter',
      months: 1,
    });
    expect(res.status).toBe(409);
    expect(await ma(res)).toBe('tenant_not_commercial');
    expect(payos.taoLink).not.toHaveBeenCalled();
  });

  it('đã 3 đơn pending → 409 too_many_pending_orders', async () => {
    const res = await post(app(kho({ pending: 3 }), payosGia()), '/v1/console/orders', {
      kind: 'plan',
      tier: 'starter',
      months: 1,
    });
    expect(res.status).toBe(409);
  });

  it('PayOS lỗi → 503 kèm orderId để khách quay lại đúng đơn; đơn vẫn pending không link', async () => {
    const k = kho();
    const res = await post(
      app(k, payosGia({ taoLoi: new PayosError('payos_unreachable', 'x') })),
      '/v1/console/orders',
      { kind: 'plan', tier: 'starter', months: 3 },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { code: string; details?: { orderId?: string } };
    };
    expect(body.error.code).toBe('payment_provider_unavailable');
    expect(body.error.details?.orderId).toBe(ORDER);
    expect(k.calls.some((c) => c.text.includes('payment_link_id = $'))).toBe(false);
  });

  it('bấm lại khi đã có đơn pending cùng nội dung chưa có link → dùng lại, KHÔNG tạo đơn mới', async () => {
    const k = kho({ donCu: don() });
    const res = await post(app(k, payosGia()), '/v1/console/orders', {
      kind: 'plan',
      tier: 'starter',
      months: 3,
    });
    expect(res.status).toBe(201);
    expect(k.calls.some((c) => c.text.includes('INSERT INTO customer_order'))).toBe(false);
  });

  it('PayOS báo orderCode đã tồn tại → đọc lại link, dựng checkoutUrl từ id, qr null', async () => {
    const k = kho();
    const payos = payosGia({
      taoLoi: new PayosError('payos_order_exists', 'x'),
      docLink: {
        paymentLinkId: 'cu-1',
        orderCode: 100001,
        amount: 1_950_000,
        amountPaid: 0,
        amountRemaining: 1_950_000,
        status: 'PENDING',
        transactions: [],
      },
    });
    const res = await post(app(k, payos), '/v1/console/orders', {
      kind: 'plan',
      tier: 'starter',
      months: 3,
    });
    expect(res.status).toBe(201);
    const luu = k.calls.find((c) => c.text.includes('payment_link_id = $'));
    expect(luu?.params).toEqual(
      expect.arrayContaining(['cu-1', 'https://pay.test/web/cu-1', null]),
    );
  });

  it('cổng tự phục vụ đóng → 503 self_serve_closed', async () => {
    const res = await post(
      app(kho(), payosGia()),
      '/v1/console/orders',
      { kind: 'plan', tier: 'starter', months: 1 },
      moiTruong({ SELF_SERVE: '0' }),
    );
    expect(res.status).toBe(503);
    expect(await ma(res)).toBe('self_serve_closed');
  });
});

describe('GET /v1/console/orders/:id và cancel', () => {
  it('đơn của tenant khác → 404, và câu SQL có tenant_id của phiên', async () => {
    const k = kho({ donTheoId: null });
    const res = await goi(app(k, payosGia()), `/v1/console/orders/${ORDER}`);
    expect(res.status).toBe(404);
    const doc = k.calls.find((c) => c.text.includes('FROM customer_order'));
    expect(doc?.params).toContain(TENANT);
  });

  it('id không phải uuid → 404, không chạm DB', async () => {
    const k = kho();
    expect((await goi(app(k, payosGia()), '/v1/console/orders/khong-phai-uuid')).status).toBe(404);
    expect(k.calls).toHaveLength(0);
  });

  it('qrCode chỉ trả khi còn pending — đơn xong rồi thì mã QR là mồi trả nhầm', async () => {
    const k = kho({ donTheoId: don({ status: 'fulfilled', qr_code: 'QR' }) });
    const res = await goi(app(k, payosGia()), `/v1/console/orders/${ORDER}`);
    expect(((await res.json()) as { order: { qrCode: unknown } }).order.qrCode).toBeNull();
  });

  it('huỷ đơn pending: gọi PayOS cancel rồi mới đánh dấu cancelled', async () => {
    const payos = payosGia();
    const res = await post(
      app(kho({ donTheoId: don({ payment_link_id: 'l' }) }), payos),
      `/v1/console/orders/${ORDER}/cancel`,
      {},
    );
    expect(res.status).toBe(200);
    expect(payos.huyLink).toHaveBeenCalledWith(100001, expect.any(String));
    expect(nhatKy.map((d) => d.action)).toEqual(['customer.order_cancel']);
  });

  it('PayOS từ chối huỷ → 503 và KHÔNG đánh dấu cancelled (link còn sống)', async () => {
    const payos = payosGia();
    payos.huyLink = vi.fn(async () => {
      throw new PayosError('payos_unreachable', 'x');
    });
    const k = kho({ donTheoId: don({ payment_link_id: 'l' }) });
    const res = await post(app(k, payos), `/v1/console/orders/${ORDER}/cancel`, {});
    expect(res.status).toBe(503);
    expect(k.calls.some((c) => c.text.includes("SET status = 'cancelled'"))).toBe(false);
  });

  it('huỷ đơn không còn pending → 409 order_not_cancellable', async () => {
    const res = await post(
      app(kho({ donTheoId: don({ status: 'fulfilled' }) }), payosGia()),
      `/v1/console/orders/${ORDER}/cancel`,
      {},
    );
    expect(res.status).toBe(409);
  });
});
