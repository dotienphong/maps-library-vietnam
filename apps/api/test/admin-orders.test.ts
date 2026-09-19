import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand } from '../src/billing/types';
import type { DonHang } from '../src/commerce/db';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { adminOrdersWith } from '../src/routes/admin-orders';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-19T03:00:00Z');
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

function app(
  k: ReturnType<typeof kho>,
  so: ReturnType<typeof soGia>['so'] = soGia().so,
  email: string | null = 'billing@test.local',
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
