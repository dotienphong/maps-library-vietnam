import { describe, expect, it, vi } from 'vitest';
import type {
  CommandReceipt,
  EntitlementCommand,
  PeriodHistory,
  UsageSnapshot,
} from '../src/billing/types';
import { CRON_HANG_NGAY, CRON_MOI_5_PHUT, chayCron, phanLoaiNhac } from '../src/commerce/cron';
import type { DonHang } from '../src/commerce/db';
import type { PayosPort, ThongTinLink } from '../src/commerce/payos';
import type { Env } from '../src/env';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const NOW = new Date('2026-09-19T02:00:00Z');
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const env = {
  ENVIRONMENT: 'test',
  CONSOLE_ORIGIN: 'https://api.test',
  SUPPORT_EMAIL: 'ho-tro@vidu.vn',
} as Env;
const ctx = { waitUntil: (p: Promise<unknown>) => void p.catch(() => {}) };

const don = (them: Partial<DonHang> = {}): DonHang => ({
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
  link_expires_at: new Date(NOW.getTime() + 3_600_000),
  paid_at: null,
  paid_amount_vnd: null,
  fulfilled_at: null,
  fulfil_attempts: 0,
  fulfil_error: null,
  entitlement_receipt: null,
  note: null,
  created_at: new Date(NOW.getTime() - 20 * 60_000),
  updated_at: NOW,
  ...them,
});

const usage = (them: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenantId: TENANT,
  status: 'active',
  tier: 'starter',
  revision: 1,
  periodId: 'p1',
  startsAt: '2026-09-01T00:00:00Z',
  endsAt: '2026-09-26T02:00:00Z',
  trialUsedOnce: true,
  maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  ...them,
});

function kho(
  tuyChon: {
    capLai?: DonHang[];
    doiSoat?: DonHang[];
    quaHan?: DonHang[];
    daNhac?: boolean;
    daGui?: number;
    suKienCu?: string[];
  } = {},
) {
  const suKien: string[] = [...(tuyChon.suKienCu ?? [])];
  const trangThai = new Map<string, string>();
  const audit: string[] = [];
  const tatCaDon = [
    ...(tuyChon.capLai ?? []),
    ...(tuyChon.doiSoat ?? []),
    ...(tuyChon.quaHan ?? []),
  ];
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('fulfil_attempts < $')) return tuyChon.capLai ?? [];
    if (q.text.includes("interval '10 minutes'")) return tuyChon.doiSoat ?? [];
    if (q.text.includes("interval '1 hour' <")) return tuyChon.quaHan ?? [];
    if (q.text.includes('FROM customer_order WHERE id')) {
      const d = tatCaDon.find((x) => x.id === q.params[0]);
      return d ? [{ ...d, status: trangThai.get(d.id) ?? d.status }] : [];
    }
    if (q.text.includes('INSERT INTO payment_event')) {
      suKien.push(q.params[2] as string);
      return [{ id: suKien.length }];
    }
    if (q.text.includes('coalesce(sum(amount_vnd)')) {
      return [{ tong: suKien.length ? 650_000 : 0, tham_chieu: suKien[0] ?? null, luc: NOW }];
    }
    if (q.text.includes('EXISTS(SELECT 1 FROM payment_event')) return [{ co: suKien.length > 0 }];
    if (q.text.includes("SET status = 'paid',")) {
      trangThai.set(q.params[2] as string, 'paid');
      return [{ id: q.params[2] }];
    }
    if (q.text.includes("SET status = 'fulfilled'")) {
      trangThai.set(q.params[1] as string, 'fulfilled');
      return [{ id: q.params[1] }];
    }
    if (q.text.includes("SET status = 'expired'")) {
      trangThai.set(q.params[0] as string, 'expired');
      return [{ id: q.params[0] }];
    }
    if (q.text.includes('DELETE FROM customer_login_code')) return [{ id: 1 }, { id: 2 }];
    if (q.text.includes('DELETE FROM customer_session')) return [{ token_hash: 'x' }];
    if (q.text.includes("quota_mode = 'commercial'")) {
      return [{ id: TENANT, name: 'Công ty Thử', email: 'khach@vidu.vn' }];
    }
    if (q.text.includes("action = 'email.reminder'")) return [{ co: tuyChon.daNhac ?? false }];
    if (q.text.includes("action = 'email.sent'")) return [{ n: tuyChon.daGui ?? 0 }];
    if (q.text.includes('FROM tenant t')) {
      return [{ email: 'khach@vidu.vn', billing_email: null, name: 'Công ty Thử' }];
    }
    if (q.text.includes('INSERT INTO admin_audit')) {
      audit.push(q.params[1] as string);
      return [];
    }
    return [];
  });
  return { sql, calls, suKien, trangThai, audit };
}

function soGia(u: UsageSnapshot = usage(), history: PeriodHistory = { periods: [], credits: [] }) {
  const lenh: EntitlementCommand[] = [];
  return {
    lenh,
    so: {
      readUsage: vi.fn(async () => u),
      readPeriods: vi.fn(async () => history),
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
}

const payosGia = (tt: Partial<ThongTinLink> | null): PayosPort =>
  ({
    ten: 'payos',
    checkoutUrlTuId: (id: string) => id,
    taoLink: vi.fn(),
    huyLink: vi.fn(),
    docLink: vi.fn(async () =>
      tt
        ? {
            paymentLinkId: 'l',
            orderCode: 100001,
            amount: 650_000,
            amountPaid: 0,
            amountRemaining: 650_000,
            status: 'PENDING',
            transactions: [],
            ...tt,
          }
        : null,
    ),
  }) as unknown as PayosPort;

const guiThu = vi.fn().mockResolvedValue({ id: 'r' });
const deps = (k: ReturnType<typeof kho>, so: ReturnType<typeof soGia>['so'], payos: PayosPort) => ({
  sql: () => k.sql,
  so: () => so,
  payos: () => payos,
  now: () => NOW,
  emailPort: () => ({ ten: 'debug' as const, send: guiThu }),
});

describe('cron mỗi 5 phút', () => {
  it('bốn việc chạy ĐỘC LẬP: một việc ném thì ba việc kia vẫn xong', async () => {
    const k = kho();
    // Ép việc dọn dẹp ném, mô phỏng DB ngủ giữa chừng.
    const sqlGoc = k.sql as unknown as (...a: unknown[]) => Promise<unknown> & { text: string };
    const sqlLoi = new Proxy(sqlGoc, {
      apply: (t, thisArg, args) => {
        const q = Reflect.apply(t, thisArg, args) as Promise<unknown> & { text: string };
        return q.text.includes('DELETE FROM customer_login_code')
          ? Promise.reject(new Error('DB ngủ'))
          : q;
      },
    });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, {
      ...deps(k, soGia().so, payosGia(null)),
      sql: () => sqlLoi as never,
    });
    expect(bc.map((v) => [v.ten, v.ok])).toEqual([
      ['capLaiDonTreo', true],
      ['doiSoatPending', true],
      ['hetHanDon', true],
      ['donDep', false],
    ]);
    expect(bc[3]?.loi).toContain('DB ngủ');
  });

  it('capLaiDonTreo: đơn paid_unfulfilled được cấp, biên nhận gửi đi', async () => {
    const k = kho({
      capLai: [don({ status: 'paid_unfulfilled', fulfil_attempts: 2, paid_amount_vnd: 650_000 })],
      suKienCu: ['FT-cu'],
    });
    const { so, lenh } = soGia();
    guiThu.mockClear();
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, so, payosGia(null)));
    expect(bc[0]).toMatchObject({ ten: 'capLaiDonTreo', ok: true, soLuong: 1 });
    expect(lenh).toHaveLength(1);
    expect(k.trangThai.get(ORDER)).toBe('fulfilled');
    await new Promise((r) => setTimeout(r, 10));
    expect(guiThu).toHaveBeenCalledTimes(1);
  });

  it('doiSoatPending: PayOS nói PAID mà chưa có sự kiện → dựng sự kiện từ transactions rồi cấp', async () => {
    const k = kho({ doiSoat: [don()] });
    const { so, lenh } = soGia();
    const payos = payosGia({
      status: 'PAID',
      amountPaid: 650_000,
      amountRemaining: 0,
      transactions: [
        { reference: 'FT-GET', amount: 650_000, transactionDateTime: '2026-09-19 08:50:00' },
      ],
    });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, so, payos));
    expect(bc[1]).toMatchObject({ ten: 'doiSoatPending', ok: true, soLuong: 1 });
    expect(k.suKien).toEqual(['FT-GET']);
    expect(lenh).toHaveLength(1);
    expect(k.trangThai.get(ORDER)).toBe('fulfilled');
  });

  it('doiSoatPending: PAID không kèm transactions → reference payos-get:<linkId>, vẫn cấp', async () => {
    const k = kho({ doiSoat: [don()] });
    const payos = payosGia({ status: 'PAID', amountPaid: 650_000, transactions: [] });
    await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payos));
    expect(k.suKien).toEqual(['payos-get:l']);
  });

  it('doiSoatPending: CANCELLED/EXPIRED → expired, audit order.expired', async () => {
    const k = kho({ doiSoat: [don()] });
    await chayCron(
      env,
      ctx,
      CRON_MOI_5_PHUT,
      deps(k, soGia().so, payosGia({ status: 'CANCELLED' })),
    );
    expect(k.trangThai.get(ORDER)).toBe('expired');
    expect(k.audit).toContain('order.expired');
  });

  it('doiSoatPending: vẫn PENDING → không làm gì', async () => {
    const k = kho({ doiSoat: [don()] });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payosGia({})));
    expect(bc[1]?.soLuong).toBe(0);
    expect(k.suKien).toHaveLength(0);
  });

  it('hetHanDon: pending quá hạn → expired', async () => {
    const k = kho({ quaHan: [don({ id: 'qua-han' })] });
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payosGia(null)));
    expect(bc[2]).toMatchObject({ ten: 'hetHanDon', soLuong: 1 });
    expect(k.trangThai.get('qua-han')).toBe('expired');
  });

  it('donDep: đếm mã đăng nhập và phiên đã xoá', async () => {
    const k = kho();
    const bc = await chayCron(env, ctx, CRON_MOI_5_PHUT, deps(k, soGia().so, payosGia(null)));
    expect(bc[3]).toMatchObject({ ten: 'donDep', ok: true, soLuong: 3 });
  });
});

describe('phanLoaiNhac', () => {
  const lichSu = { periods: [] };

  it('còn đúng 7 ngày → 7d; 1 ngày → 1d; vừa hết hạn → het; khác → null', () => {
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-26T02:00:00Z' }), lichSu, NOW)?.loai).toBe('7d');
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-20T02:00:00Z' }), lichSu, NOW)?.loai).toBe('1d');
    expect(
      phanLoaiNhac(usage({ status: 'expired', endsAt: '2026-09-18T10:00:00Z' }), lichSu, NOW)?.loai,
    ).toBe('het');
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-23T02:00:00Z' }), lichSu, NOW)).toBeNull();
  });

  it('bản dùng thử không nhắc — nó không phải thứ để gia hạn', () => {
    expect(
      phanLoaiNhac(usage({ tier: 'trial', endsAt: '2026-09-26T02:00:00Z' }), lichSu, NOW),
    ).toBeNull();
  });

  it('đã có kỳ kế tiếp thì không nhắc: khách gia hạn rồi', () => {
    const coKyMoi = {
      periods: [
        {
          periodId: 'p2',
          tier: 'starter' as const,
          startsAt: '2026-09-26T02:00:00Z',
          endsAt: '2026-10-26T02:00:00Z',
          paymentReference: 'FT',
          lineItemId: 'x',
          places: { limit: 0, used: 0, reserved: 0 },
          directions: { limit: 0, used: 0, reserved: 0 },
        },
      ],
    };
    expect(phanLoaiNhac(usage({ endsAt: '2026-09-26T02:00:00Z' }), coKyMoi, NOW)).toBeNull();
  });
});

describe('cron hằng ngày — nhắc hạn', () => {
  it('gửi một thư, ghi email.reminder với target tenant:kỳ:loại', async () => {
    const k = kho();
    guiThu.mockClear();
    const bc = await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, soGia().so, payosGia(null)));
    expect(bc[0]).toMatchObject({ ten: 'nhacHan', ok: true, soLuong: 1 });
    expect(guiThu).toHaveBeenCalledTimes(1);
    const ghi = k.calls.find((c) => c.params.includes('email.reminder'));
    expect(ghi?.params).toContain(`${TENANT}:p1:7d`);
  });

  it('đã nhắc cặp đó rồi → không gửi lại', async () => {
    const k = kho({ daNhac: true });
    guiThu.mockClear();
    await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, soGia().so, payosGia(null)));
    expect(guiThu).not.toHaveBeenCalled();
  });

  it('ngân sách thư còn dưới 20 suất → dừng, và KHÔNG ghi dấu để mai còn nhắc', async () => {
    const k = kho({ daGui: 85 });
    guiThu.mockClear();
    const bc = await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, soGia().so, payosGia(null)));
    expect(guiThu).not.toHaveBeenCalled();
    expect(bc[0]?.soLuong).toBe(0);
    expect(k.calls.some((c) => c.params.includes('email.reminder'))).toBe(false);
  });

  it('sổ quota của một tenant không trả lời → bỏ qua tenant đó, không làm hỏng cả lượt', async () => {
    const k = kho();
    const { so } = soGia();
    so.readUsage.mockRejectedValue(new Error('DO chết'));
    const bc = await chayCron(env, ctx, CRON_HANG_NGAY, deps(k, so, payosGia(null)));
    expect(bc[0]).toMatchObject({ ten: 'nhacHan', ok: true, soLuong: 0 });
  });
});
