import { describe, expect, it, vi } from 'vitest';
import type {
  CommandReceipt,
  EntitlementCommand,
  PeriodHistory,
  UsageSnapshot,
} from '../src/billing/types';
import type { DonHang } from '../src/commerce/db';
import { apDungThanhToan, fulfilOrder } from '../src/commerce/fulfil';
import type { Env } from '../src/env';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const NOW = new Date('2026-09-19T03:00:00Z');
const ORDER = '00000000-0000-4000-8000-0000000000d1';
const TENANT = '00000000-0000-4000-8000-0000000000c1';
const env = {} as Env;

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
  status: 'paid',
  provider: 'payos',
  payment_link_id: 'l',
  checkout_url: 'u',
  qr_code: null,
  link_expires_at: null,
  paid_at: NOW,
  paid_amount_vnd: 1_950_000,
  fulfilled_at: null,
  fulfil_attempts: 0,
  fulfil_error: null,
  entitlement_receipt: null,
  note: null,
  created_at: NOW,
  updated_at: NOW,
  ...them,
});

/** DB giả: trạng thái đơn sống trong `hienTai`, mỗi UPDATE có điều kiện đúng như DB thật. */
function khoDon(banDau: DonHang, tien: { tong: number; thamChieu: string | null }) {
  let hienTai = { ...banDau };
  const { sql, calls } = fakeSql((q: RecordedQuery) => {
    if (q.text.includes('FROM customer_order WHERE id')) return [hienTai];
    if (q.text.includes('coalesce(sum(amount_vnd)')) {
      return [{ tong: tien.tong, tham_chieu: tien.thamChieu, luc: NOW }];
    }
    if (q.text.includes("SET status = 'paid',")) {
      if (!['pending', 'underpaid', 'expired', 'cancelled'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'paid', paid_amount_vnd: q.params[0] as number };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'underpaid'")) {
      if (!['pending', 'underpaid'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'underpaid', paid_amount_vnd: q.params[0] as number };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'fulfilled'")) {
      if (!['paid', 'paid_unfulfilled'].includes(hienTai.status)) return [];
      hienTai = { ...hienTai, status: 'fulfilled', entitlement_receipt: q.params[0] };
      return [{ id: ORDER }];
    }
    if (q.text.includes("SET status = 'paid_unfulfilled'")) {
      hienTai = {
        ...hienTai,
        status: 'paid_unfulfilled',
        fulfil_attempts: hienTai.fulfil_attempts + 1,
      };
      return [];
    }
    return [];
  });
  const hanhDongAudit = () =>
    calls.filter((c) => c.text.includes('INSERT INTO admin_audit')).map((c) => c.params[1]);
  return { sql, calls, hanhDongAudit, doc: () => hienTai };
}

const usage = (them: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  tenantId: TENANT,
  status: 'active',
  tier: 'trial',
  revision: 3,
  periodId: 'trial:x',
  startsAt: '2026-09-01T00:00:00Z',
  endsAt: '2026-10-01T00:00:00Z',
  trialUsedOnce: true,
  maintenance: false,
  missingAcks: { count: 0, limit: 3, locked: false, opensAt: null },
  places: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  directions: { limit: 0, used: 0, reserved: 0, credits: 0, available: 0 },
  ...them,
});

function soGia(kichBan: { usage?: UsageSnapshot; history?: PeriodHistory; loi?: string[] } = {}) {
  const lenh: EntitlementCommand[] = [];
  const loi = [...(kichBan.loi ?? [])];
  const so = {
    readUsage: vi.fn(async () => kichBan.usage ?? usage()),
    readPeriods: vi.fn(async () => kichBan.history ?? { periods: [], credits: [] }),
    applyCommand: vi.fn(async (c: EntitlementCommand): Promise<CommandReceipt> => {
      lenh.push(c);
      const ma = loi.shift();
      if (ma) throw new Error(ma);
      return {
        operationId: c.operationId,
        revision: c.expectedRevision + 1,
        status: 'active',
        tier: 'starter',
        appliedAt: NOW.toISOString(),
      };
    }),
  };
  return { so, lenh };
}

const deps = (so: ReturnType<typeof soGia>['so']) => ({ so: () => so, now: () => NOW });

describe('fulfilOrder — gói thuê bao', () => {
  it('trial → startsAt = now, endsAt = +3 tháng, operationId order:<id>, lineItemId = id', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia();
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));

    expect(kq.status).toBe('fulfilled');
    expect(lenh).toHaveLength(1);
    expect(lenh[0]).toMatchObject({
      kind: 'grantPeriod',
      operationId: `order:${ORDER}`,
      tenantId: TENANT,
      actor: 'system:payos',
      expectedRevision: 3,
      periodId: ORDER,
      tier: 'starter',
      startsAt: NOW.toISOString(),
      paymentReference: 'FT1',
      lineItemId: ORDER,
    });
    // addMonths tính theo lịch Việt Nam: 19/09 10:00 VN + 3 tháng = 19/12 10:00 VN = 19/12 03:00Z.
    expect((lenh[0] as { endsAt: string }).endsAt).toBe('2026-12-19T03:00:00.000Z');
    expect(kho.doc().status).toBe('fulfilled');
    expect(kho.hanhDongAudit()).toContain('order.fulfilled');
  });

  it('biên lai lưu DB mang cả startsAt/endsAt để thư biên nhận in được hiệu lực', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    await fulfilOrder(kho.sql, env, ORDER, deps(soGia().so));
    expect(kho.doc().entitlement_receipt).toMatchObject({
      startsAt: NOW.toISOString(),
      endsAt: '2026-12-19T03:00:00.000Z',
      revision: 4,
    });
  });

  it('đang có kỳ trả phí tới 30/11 → kỳ mới bắt đầu 30/11', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia({
      usage: usage({ tier: 'starter', periodId: 'p1' }),
      history: {
        periods: [
          {
            periodId: 'p1',
            tier: 'starter',
            startsAt: '2026-09-01T00:00:00Z',
            endsAt: '2026-11-30T17:00:00Z',
            paymentReference: 'FT0',
            lineItemId: 'don-cu',
            places: { limit: 0, used: 0, reserved: 0 },
            directions: { limit: 0, used: 0, reserved: 0 },
          },
        ],
        credits: [],
      },
    });
    await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect((lenh[0] as { startsAt: string }).startsAt).toBe('2026-11-30T17:00:00.000Z');
  });

  it('revision_conflict → đọc lại rồi thử lại, tối đa 3 lần', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia({ loi: ['revision_conflict', 'revision_conflict'] });
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq.status).toBe('fulfilled');
    expect(lenh).toHaveLength(3);
    expect(so.readUsage).toHaveBeenCalledTimes(3);
  });

  it('operation_conflict mà sổ đã có lineItemId của đơn → fulfilled, KHÔNG cấp lần hai', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so, lenh } = soGia({ loi: ['operation_conflict'] });
    let lanDoc = 0;
    so.readPeriods.mockImplementation(async () => {
      lanDoc += 1;
      // Lần đọc đầu chưa thấy (cuộc đua với cron), lần hai thấy kỳ đã cấp.
      if (lanDoc === 1) return { periods: [], credits: [] };
      return {
        periods: [
          {
            periodId: ORDER,
            tier: 'starter' as const,
            startsAt: NOW.toISOString(),
            endsAt: '2026-12-19T03:00:00.000Z',
            paymentReference: 'FT1',
            lineItemId: ORDER,
            places: { limit: 0, used: 0, reserved: 0 },
            directions: { limit: 0, used: 0, reserved: 0 },
          },
        ],
        credits: [],
      };
    });
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq).toMatchObject({ status: 'fulfilled', daCoTuTruoc: true });
    expect(lenh).toHaveLength(1);
    expect(kho.doc().status).toBe('fulfilled');
  });

  it('sổ không trả lời → paid_unfulfilled, tăng số lần thử, audit order.fulfil_failed, KHÔNG ném', async () => {
    const kho = khoDon(don(), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so } = soGia();
    so.readUsage.mockRejectedValue(new Error('Durable Object reset'));
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq).toMatchObject({ status: 'paid_unfulfilled', error: 'Durable Object reset' });
    expect(kho.doc().status).toBe('paid_unfulfilled');
    expect(kho.doc().fulfil_attempts).toBe(1);
    expect(kho.hanhDongAudit()).toContain('order.fulfil_failed');
  });

  it('đơn đã fulfilled → trả lại ngay, không gọi sổ', async () => {
    const kho = khoDon(don({ status: 'fulfilled', entitlement_receipt: { revision: 9 } }), {
      tong: 1_950_000,
      thamChieu: 'FT1',
    });
    const { so } = soGia();
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq).toMatchObject({ status: 'fulfilled', daCoTuTruoc: true });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('đơn pending → khong_ap_dung (chưa có tiền thì không cấp)', async () => {
    const kho = khoDon(don({ status: 'pending' }), { tong: 0, thamChieu: null });
    const { so } = soGia();
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq).toMatchObject({ status: 'khong_ap_dung', lyDo: 'order_pending' });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('không có mã tham chiếu nào → khong_ap_dung, không cấp bằng một khoá bịa ra', async () => {
    const kho = khoDon(don(), { tong: 0, thamChieu: null });
    const { so } = soGia();
    expect(await fulfilOrder(kho.sql, env, ORDER, deps(so))).toMatchObject({
      status: 'khong_ap_dung',
      lyDo: 'no_payment_reference',
    });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });
});

describe('fulfilOrder — mua thêm lượt', () => {
  const donAddon = () =>
    don({
      kind: 'addon',
      tier: null,
      months: null,
      quota_group: 'places',
      packs: 5,
      amount_vnd: 130_000,
    });

  it('cần thuê bao trả phí đang hoạt động; periodId lấy LÚC CẤP', async () => {
    const kho = khoDon(donAddon(), { tong: 130_000, thamChieu: 'FT2' });
    const { so, lenh } = soGia({ usage: usage({ tier: 'starter', periodId: 'p-hien-tai' }) });
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq.status).toBe('fulfilled');
    expect(lenh[0]).toMatchObject({
      kind: 'addCredits',
      periodId: 'p-hien-tai',
      group: 'places',
      packs: 5,
      lineItemId: ORDER,
      paymentReference: 'FT2',
    });
  });

  it('đang dùng thử → paid_unfulfilled mã credits_require_paid_active, cron sẽ thử lại', async () => {
    const kho = khoDon(donAddon(), { tong: 130_000, thamChieu: 'FT2' });
    const { so } = soGia();
    const kq = await fulfilOrder(kho.sql, env, ORDER, deps(so));
    expect(kq).toMatchObject({ status: 'paid_unfulfilled', error: 'credits_require_paid_active' });
    expect(so.applyCommand).not.toHaveBeenCalled();
  });
});

describe('apDungThanhToan — từ sự kiện tới trạng thái', () => {
  it('đủ tiền: pending → paid → fulfilled, audit order.paid rồi order.fulfilled', async () => {
    const kho = khoDon(don({ status: 'pending', paid_amount_vnd: null }), {
      tong: 1_950_000,
      thamChieu: 'FT1',
    });
    const kq = await apDungThanhToan(kho.sql, env, ORDER, deps(soGia().so));
    expect(kq.trangThai).toBe('fulfilled');
    expect(kho.hanhDongAudit()).toEqual(['order.paid', 'order.fulfilled']);
  });

  it('hai lần chuyển cộng lại đủ → paid (tính theo TỔNG, không theo một webhook)', async () => {
    const kho = khoDon(don({ status: 'underpaid', paid_amount_vnd: 1_000_000 }), {
      tong: 1_950_000,
      thamChieu: 'FT1',
    });
    expect((await apDungThanhToan(kho.sql, env, ORDER, deps(soGia().so))).trangThai).toBe(
      'fulfilled',
    );
  });

  it('thiếu tiền → underpaid kèm số còn thiếu, không chạm sổ', async () => {
    const kho = khoDon(don({ status: 'pending' }), { tong: 1_900_000, thamChieu: 'FT1' });
    const { so } = soGia();
    const kq = await apDungThanhToan(kho.sql, env, ORDER, deps(so));
    expect(kq).toMatchObject({ trangThai: 'underpaid', thieu: 50_000 });
    expect(so.applyCommand).not.toHaveBeenCalled();
    expect(kho.doc().status).toBe('underpaid');
    expect(kho.hanhDongAudit()).toContain('order.underpaid');
  });

  it('đơn expired mà tiền vào đủ → vẫn paid rồi cấp: tiền đã rời tài khoản khách', async () => {
    const kho = khoDon(don({ status: 'expired' }), { tong: 1_950_000, thamChieu: 'FT1' });
    expect((await apDungThanhToan(kho.sql, env, ORDER, deps(soGia().so))).trangThai).toBe(
      'fulfilled',
    );
  });

  it('chưa có sự kiện nào → khong_doi', async () => {
    const kho = khoDon(don({ status: 'pending' }), { tong: 0, thamChieu: null });
    expect((await apDungThanhToan(kho.sql, env, ORDER, deps(soGia().so))).trangThai).toBe(
      'khong_doi',
    );
  });

  it('đơn đã fulfilled → khong_doi, không chạm sổ (webhook gửi lại)', async () => {
    const kho = khoDon(don({ status: 'fulfilled' }), { tong: 1_950_000, thamChieu: 'FT1' });
    const { so } = soGia();
    expect((await apDungThanhToan(kho.sql, env, ORDER, deps(so))).trangThai).toBe('khong_doi');
    expect(so.applyCommand).not.toHaveBeenCalled();
  });

  it('gọi lại khi đơn đã underpaid và tiền không đổi → không ghi audit order.underpaid lần hai', async () => {
    const kho = khoDon(don({ status: 'underpaid', paid_amount_vnd: 1_900_000 }), {
      tong: 1_900_000,
      thamChieu: 'FT1',
    });
    await apDungThanhToan(kho.sql, env, ORDER, deps(soGia().so));
    expect(kho.hanhDongAudit()).toEqual([]);
  });
});
