import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { CommandReceipt, EntitlementCommand } from '../src/billing/types';
import { kyDuLieu } from '../src/commerce/chu-ky';
import type { DonHang } from '../src/commerce/db';
import type { AppEnv, Env } from '../src/env';
import { errorResponse } from '../src/errors';
import { payWebhookWith } from '../src/routes/pay-webhook';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const KHOA = 'kiem-thu-checksum-key';
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-09-19T03:00:00Z');

const moiTruong = (them: Record<string, unknown> = {}) =>
  ({
    ...env,
    ENVIRONMENT: 'test',
    PAYOS_CHECKSUM_KEY: KHOA,
    SUPPORT_EMAIL: 'ho-tro@vidu.vn',
    ...them,
  }) as unknown as Env;

const don = (them: Partial<DonHang> = {}): DonHang => ({
  id: ORDER,
  order_code: 100001,
  tenant_id: TENANT,
  account_id: 'a',
  kind: 'plan',
  tier: 'starter',
  months: 3,
  quota_group: null,
  packs: null,
  amount_vnd: 1_950_000,
  amount_usd_cents: 7_500,
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
  ...them,
});

interface SuKienGia {
  amount: number | null;
  reference: string;
  valid: boolean;
}

/** DB giả cho webhook: đơn tra theo order_code, sự kiện cộng dồn, UPDATE đổi trạng thái thật. */
function kho(
  banDau: DonHang | null,
  tuyChon: { trungReference?: boolean; suKienCu?: SuKienGia[] } = {},
) {
  let hienTai = banDau ? { ...banDau } : null;
  const suKien: SuKienGia[] = [...(tuyChon.suKienCu ?? [])];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('FROM customer_order WHERE order_code')) return hienTai ? [hienTai] : [];
    if (q.text.includes('FROM customer_order WHERE id')) return hienTai ? [hienTai] : [];
    if (q.text.includes('INSERT INTO payment_event')) {
      if (tuyChon.trungReference) return [];
      suKien.push({
        amount: q.params[4] as number | null,
        reference: q.params[2] as string,
        valid: q.params[5] as boolean,
      });
      return [{ id: suKien.length }];
    }
    if (q.text.includes('coalesce(sum(amount_vnd)')) {
      const hopLe = suKien.filter((s) => s.valid && s.amount !== null);
      return [
        {
          tong: hopLe.reduce((t, s) => t + (s.amount ?? 0), 0),
          tham_chieu: hopLe[0]?.reference ?? null,
          luc: NOW,
        },
      ];
    }
    if (q.text.includes("SET status = 'paid',") && hienTai) {
      hienTai = { ...hienTai, status: 'paid', paid_amount_vnd: q.params[0] as number };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'underpaid'") && hienTai) {
      hienTai = { ...hienTai, status: 'underpaid', paid_amount_vnd: q.params[0] as number };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'fulfilled'") && hienTai) {
      hienTai = { ...hienTai, status: 'fulfilled' };
      return [{ id: ORDER }];
    }
    if (q.text.includes('FROM tenant t')) {
      return [{ email: 'khach@vidu.vn', billing_email: null, name: 'Công ty Thử' }];
    }
    if (q.text.includes("action = 'email.sent'")) return [{ n: 0 }];
    return [];
  });
  return { sql, calls, suKien, doc: () => hienTai };
}

function soGia() {
  const lenh: EntitlementCommand[] = [];
  const so = {
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
  };
  return { so, lenh };
}

const guiThu = vi.fn().mockResolvedValue({ id: 'r' });

/**
 * Worker thật LUÔN có ExecutionContext, nên test phải truyền một bản giả — thiếu nó thì
 * `endSql(c.executionCtx, …)` ném và mọi nhánh đều thành 503. Bản giả này còn gom việc nền lại
 * để bài kiểm chờ đúng lúc thư gửi xong, thay vì ngủ một khoảng đoán chừng.
 */
function boiCanh() {
  const viecNen: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => viecNen.push(p),
    passThroughOnException: () => {},
  };
  return { ctx, xongViecNen: () => Promise.all(viecNen) };
}

function app(k: ReturnType<typeof kho>, so: ReturnType<typeof soGia>['so']) {
  const a = new Hono<AppEnv>();
  a.onError((err, c) => errorResponse(c, err));
  a.route(
    '/',
    payWebhookWith({
      sql: () => k.sql,
      so: () => so,
      now: () => NOW,
      emailPort: () => ({ ten: 'debug', send: guiThu }),
    }),
  );
  return a;
}

const duLieu = (them: Record<string, unknown> = {}) => ({
  orderCode: 100001,
  amount: 1_950_000,
  description: 'MLV100001',
  accountNumber: '0123456789',
  reference: 'FT26262ABC123',
  transactionDateTime: '2026-09-19 10:15:00',
  currency: 'VND',
  paymentLinkId: 'l',
  code: '00',
  desc: 'Thành công',
  counterAccountBankId: '',
  counterAccountName: null,
  virtualAccountNumber: '',
  ...them,
});

async function ban(
  a: Hono<AppEnv>,
  moi: Env,
  data: Record<string, unknown>,
  chuKy?: string,
): Promise<Response> {
  const body = JSON.stringify({
    code: '00',
    desc: 'success',
    success: true,
    data,
    signature: chuKy ?? (await kyDuLieu(data, KHOA)),
  });
  const { ctx, xongViecNen } = boiCanh();
  const res = await a.request(
    'https://api/v1/pay/payos/webhook',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    moi,
    ctx as unknown as ExecutionContext,
  );
  await xongViecNen();
  return res;
}

const ma = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('webhook — cổng chữ ký', () => {
  it('thiếu PAYOS_CHECKSUM_KEY → 503, không bao giờ "tạm tin"', async () => {
    const k = kho(don());
    const res = await ban(
      app(k, soGia().so),
      moiTruong({ PAYOS_CHECKSUM_KEY: undefined }),
      duLieu(),
    );
    expect(res.status).toBe(503);
    expect(k.suKien).toHaveLength(0);
  });

  it('thân quá 16 KiB → 413', async () => {
    const k = kho(don());
    const res = await app(k, soGia().so).request(
      'https://api/v1/pay/payos/webhook',
      { method: 'POST', body: 'x'.repeat(16 * 1024 + 1) },
      moiTruong(),
      boiCanh().ctx as unknown as ExecutionContext,
    );
    expect(res.status).toBe(413);
  });

  it('không phải JSON hoặc thiếu data → 400 invalid_webhook', async () => {
    const a = app(kho(don()), soGia().so);
    const ctx = () => boiCanh().ctx as unknown as ExecutionContext;
    expect(
      (
        await a.request(
          'https://api/v1/pay/payos/webhook',
          { method: 'POST', body: '{' },
          moiTruong(),
          ctx(),
        )
      ).status,
    ).toBe(400);
    const res = await a.request(
      'https://api/v1/pay/payos/webhook',
      { method: 'POST', body: JSON.stringify({ signature: 'x' }) },
      moiTruong(),
      ctx(),
    );
    expect(await ma(res)).toBe('invalid_webhook');
  });

  it('sai chữ ký → 400, ghi sự kiện invalid:<sha256>, đơn KHÔNG đổi, sổ không bị chạm', async () => {
    const k = kho(don());
    const { so } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu(), 'f'.repeat(64));
    expect(res.status).toBe(400);
    expect(await ma(res)).toBe('invalid_signature');
    expect(k.suKien).toHaveLength(1);
    expect(k.suKien[0]?.valid).toBe(false);
    expect(k.suKien[0]?.reference).toMatch(/^invalid:[a-f0-9]{64}$/);
    expect(k.doc()?.status).toBe('pending');
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('sai chữ ký mà bị giới hạn tần suất → vẫn 400 nhưng KHÔNG ghi DB', async () => {
    const k = kho(don());
    const limiter = { limit: vi.fn(async () => ({ success: false })) };
    const res = await ban(
      app(k, soGia().so),
      moiTruong({ PAYOS_WEBHOOK_RATE_LIMITER: limiter }),
      duLieu(),
      'f'.repeat(64),
    );
    expect(res.status).toBe(400);
    expect(k.suKien).toHaveLength(0);
    expect(limiter.limit).toHaveBeenCalledTimes(1);
  });
});

describe('webhook — nghiệp vụ', () => {
  it('đủ tiền: 200, đơn fulfilled, sổ nhận đúng một lệnh, biên nhận gửi cho khách', async () => {
    const k = kho(don());
    const { so, lenh } = soGia();
    guiThu.mockClear();
    const res = await ban(app(k, so), moiTruong(), duLieu());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      received: true,
      matched: true,
      duplicate: false,
      status: 'fulfilled',
    });
    expect(k.suKien[0]).toMatchObject({
      amount: 1_950_000,
      reference: 'FT26262ABC123',
      valid: true,
    });
    expect(lenh).toHaveLength(1);
    expect(k.doc()?.status).toBe('fulfilled');
    expect(guiThu).toHaveBeenCalledTimes(1);
    expect(guiThu.mock.calls[0]?.[0]).toMatchObject({ to: 'khach@vidu.vn' });
  });

  it('không khớp đơn nào (webhook thử của PayOS) → 200 matched:false, sự kiện order_id NULL', async () => {
    const k = kho(null);
    const res = await ban(app(k, soGia().so), moiTruong(), duLieu({ orderCode: 123 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, matched: false });
    const insert = k.calls.find((c) => c.text.includes('INSERT INTO payment_event'));
    expect(insert?.params[0]).toBeNull();
  });

  it('code khác 00 → 200, chỉ lưu, amount NULL, không cấp', async () => {
    const k = kho(don());
    const { so } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu({ code: '01', desc: 'Thất bại' }));
    expect(res.status).toBe(200);
    expect(k.suKien[0]?.amount).toBeNull();
    expect(k.doc()?.status).toBe('pending');
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('thiếu tiền → 200 status underpaid, thư cho khách VÀ cho admin', async () => {
    const k = kho(don());
    guiThu.mockClear();
    const res = await ban(app(k, soGia().so), moiTruong(), duLieu({ amount: 1_900_000 }));
    expect(await res.json()).toMatchObject({ status: 'underpaid' });
    const nguoiNhan = guiThu.mock.calls.map((c) => (c[0] as { to: string }).to).sort();
    expect(nguoiNhan).toEqual(['ho-tro@vidu.vn', 'khach@vidu.vn']);
  });

  it('trùng reference mà đơn chưa xong → 200 duplicate:true, vẫn thử áp dụng lại', async () => {
    // Lần nhận trước có thể đã ghi được sự kiện rồi đổ ở bước cấp gói; PayOS gửi lại là cơ hội tự lành.
    const k = kho(don({ status: 'paid_unfulfilled', fulfil_attempts: 1 }), {
      trungReference: true,
      suKienCu: [{ amount: 1_950_000, reference: 'FT26262ABC123', valid: true }],
    });
    const { so, lenh } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu());
    expect(await res.json()).toMatchObject({ duplicate: true, status: 'fulfilled' });
    expect(lenh).toHaveLength(1);
  });

  it('trùng reference và đơn đã fulfilled → 200, sổ KHÔNG bị gọi', async () => {
    const k = kho(don({ status: 'fulfilled' }), { trungReference: true });
    const { so } = soGia();
    const res = await ban(app(k, so), moiTruong(), duLieu());
    expect(res.status).toBe(200);
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('thiếu reference → 400: không có khoá chống trùng thì không nhận', async () => {
    const k = kho(don());
    const res = await ban(app(k, soGia().so), moiTruong(), duLieu({ reference: '' }));
    expect(res.status).toBe(400);
    expect(k.suKien).toHaveLength(0);
  });
});
