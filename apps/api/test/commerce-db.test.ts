import { describe, expect, it } from 'vitest';
import {
  daCoSuKien,
  danhDauHoanTien,
  danhSachDonAdmin,
  danhSachDonCuaTenant,
  datCapHong,
  datDaCap,
  datDaTra,
  datHetHan,
  datThieuTien,
  demDonPending,
  docDonCuaTenant,
  ghiSuKienThanhToan,
  huyDonAdmin,
  huyDonCuaTenant,
  luuLinkThanhToan,
  noiDungChuyenKhoan,
  taoDon,
  timDonPendingChuaCoLink,
  tongTienDaNhan,
} from '../src/commerce/db';
import { fakeSql, type RecordedQuery } from './helpers/fake-sql';

const TENANT = '00000000-0000-4000-8000-0000000000c1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';

describe('noiDungChuyenKhoan', () => {
  it('đúng 9 ký tự — trần của PayOS với tài khoản chưa liên kết', () => {
    expect(noiDungChuyenKhoan(100001)).toBe('MLV100001');
    expect(noiDungChuyenKhoan(999999)).toHaveLength(9);
  });
});

describe('mọi câu của khách có tenant_id NGAY TRONG SQL', () => {
  // Điều kiện này là thứ duy nhất ngăn tenant A đọc và huỷ đơn của tenant B. Kiểm ở JavaScript
  // thì một nhánh quên là lọt; kiểm trong câu thì không có nhánh nào để quên.
  const cacCau = [
    ['docDonCuaTenant', (sql: never) => docDonCuaTenant(sql, TENANT, ORDER)],
    ['danhSachDonCuaTenant', (sql: never) => danhSachDonCuaTenant(sql, TENANT)],
    ['demDonPending', (sql: never) => demDonPending(sql, TENANT)],
    ['huyDonCuaTenant', (sql: never) => huyDonCuaTenant(sql, TENANT, ORDER)],
    [
      'timDonPendingChuaCoLink',
      (sql: never) =>
        timDonPendingChuaCoLink(sql, TENANT, { kind: 'plan', tier: 'starter', months: 3 }),
    ],
  ] as const;

  for (const [ten, goi] of cacCau) {
    it(ten, async () => {
      const { sql, calls } = fakeSql([{ n: 0 }]);
      await goi(sql as never);
      expect(calls[0]?.text).toMatch(/tenant_id = \$\d+::uuid/);
      expect(calls[0]?.params).toContain(TENANT);
    });
  }
});

describe('taoDon', () => {
  it('ghi đúng cột theo kind, tiền là số máy chủ tính, trạng thái pending', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER, order_code: 100001 }]);
    await taoDon(sql, {
      tenantId: TENANT,
      accountId: ACCOUNT,
      don: { kind: 'plan', tier: 'starter', months: 3 },
      gia: { amountVnd: 1_950_000, amountUsdCents: 7_500 },
    });
    const q = calls[0];
    expect(q?.text).toContain('INSERT INTO customer_order');
    expect(q?.text).toContain("'pending'");
    expect(q?.params).toEqual(
      expect.arrayContaining([TENANT, ACCOUNT, 'plan', 'starter', 3, null, null, 1_950_000, 7_500]),
    );
    // bigint qua postgres.js với fetch_types:false về dưới dạng CHUỖI; ::int ép về số.
    expect(q?.text).toContain('order_code::int');
  });

  it('addon: tier/months null, quota_group/packs có giá trị', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    await taoDon(sql, {
      tenantId: TENANT,
      accountId: ACCOUNT,
      don: { kind: 'addon', group: 'places', packs: 5 },
      gia: { amountVnd: 130_000, amountUsdCents: 500 },
    });
    expect(calls[0]?.params).toEqual(
      expect.arrayContaining(['addon', null, null, 'places', 5, 130_000]),
    );
  });
});

describe('chuyển trạng thái — KHÔNG câu nào UPDATE vô điều kiện', () => {
  it('luuLinkThanhToan chỉ ghi khi còn pending', async () => {
    const { sql, calls } = fakeSql([]);
    await luuLinkThanhToan(sql, ORDER, {
      paymentLinkId: 'l',
      checkoutUrl: 'u',
      qrCode: null,
      linkExpiresAt: new Date(),
    });
    expect(calls[0]?.text).toMatch(/WHERE id = \$\d+::uuid AND status = 'pending'/);
    expect(calls[0]?.text).toContain('updated_at = now()');
  });

  it('datDaTra nhận cả đơn expired/cancelled — tiền đã ghi nhận thì không mất', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    expect(await datDaTra(sql, ORDER, 1_950_000, new Date())).toBe(true);
    expect(calls[0]?.text).toContain("status IN ('pending', 'underpaid', 'expired', 'cancelled')");
    expect(calls[0]?.text).toContain("status = 'paid'");
  });

  it('datDaTra trả false khi không dòng nào khớp điều kiện trạng thái', async () => {
    const { sql } = fakeSql([]);
    expect(await datDaTra(sql, ORDER, 1, new Date())).toBe(false);
  });

  it('datThieuTien chỉ từ pending/underpaid', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    await datThieuTien(sql, ORDER, 1_000_000);
    expect(calls[0]?.text).toContain("status IN ('pending', 'underpaid')");
    expect(calls[0]?.text).toContain("status = 'underpaid'");
  });

  it('datDaCap chỉ từ paid/paid_unfulfilled, biên lai qua sql.json, xoá fulfil_error', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    const bienLai = { operationId: 'order:x', revision: 2 };
    await datDaCap(sql, ORDER, bienLai);
    expect(calls[0]?.text).toContain("status IN ('paid', 'paid_unfulfilled')");
    expect(calls[0]?.text).toContain("status = 'fulfilled'");
    expect(calls[0]?.text).toContain('fulfil_error = NULL');
    expect(calls[0]?.params).toContainEqual(bienLai);
  });

  it('datCapHong tăng fulfil_attempts và giữ mã lỗi', async () => {
    const { sql, calls } = fakeSql([]);
    await datCapHong(sql, ORDER, 'revision_conflict');
    expect(calls[0]?.text).toContain('fulfil_attempts = fulfil_attempts + 1');
    expect(calls[0]?.text).toContain("status = 'paid_unfulfilled'");
    expect(calls[0]?.params).toContain('revision_conflict');
  });

  it('datHetHan và huỷ chỉ từ pending', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER }]);
    await datHetHan(sql, ORDER);
    await huyDonCuaTenant(sql, TENANT, ORDER);
    expect(calls[0]?.text).toContain("status = 'pending'");
    expect(calls[1]?.text).toContain("status = 'pending'");
  });
});

describe('payment_event — nhật ký tiền vào', () => {
  it('ON CONFLICT (provider, reference) DO NOTHING, trả true khi chèn mới', async () => {
    const { sql, calls } = fakeSql([{ id: 7 }]);
    const moi = await ghiSuKienThanhToan(sql, {
      orderId: ORDER,
      provider: 'payos',
      reference: 'FT1',
      orderCode: 100001,
      amountVnd: 1_950_000,
      signatureValid: true,
      payload: { orderCode: 100001 },
    });
    expect(moi).toBe(true);
    expect(calls[0]?.text).toContain('ON CONFLICT (provider, reference) DO NOTHING');
    expect(calls[0]?.text).toContain('RETURNING id');
    expect(calls[0]?.params).toContainEqual({ orderCode: 100001 });
  });

  it('trùng reference → false (PayOS gửi lại)', async () => {
    const { sql } = fakeSql([]);
    expect(
      await ghiSuKienThanhToan(sql, {
        orderId: null,
        provider: 'payos',
        reference: 'FT1',
        orderCode: null,
        amountVnd: null,
        signatureValid: false,
        payload: {},
      }),
    ).toBe(false);
  });

  it('tongTienDaNhan chỉ cộng sự kiện chữ ký hợp lệ của ĐÚNG đơn, lấy mã tham chiếu đầu tiên', async () => {
    const { sql, calls } = fakeSql([{ tong: 1_950_000, tham_chieu: 'FT1', luc: new Date() }]);
    const kq = await tongTienDaNhan(sql, ORDER);
    expect(kq.tong).toBe(1_950_000);
    expect(kq.thamChieu).toBe('FT1');
    expect(calls[0]?.text).toContain('signature_valid');
    expect(calls[0]?.text).toContain('amount_vnd IS NOT NULL');
    expect(calls[0]?.text).toMatch(/order_id = \$\d+::uuid/);
  });

  it('chưa có sự kiện nào → tổng 0, tham chiếu null', async () => {
    const { sql } = fakeSql([{ tong: 0, tham_chieu: null, luc: null }]);
    expect(await tongTienDaNhan(sql, ORDER)).toEqual({ tong: 0, thamChieu: null, luc: null });
  });

  it('daCoSuKien hỏi theo (provider, reference)', async () => {
    const { sql, calls } = fakeSql([{ co: true }]);
    expect(await daCoSuKien(sql, 'manual', 'manual:op-1')).toBe(true);
    expect(calls[0]?.params).toEqual(['manual', 'manual:op-1']);
  });
});

describe('danhSachDonAdmin — bộ lọc pha 4', () => {
  it('tenant, from, to đều là điều kiện "NULL hoặc khớp" NGAY TRONG SQL', async () => {
    const { sql, calls } = fakeSql([]);
    const from = new Date('2026-08-31T17:00:00.000Z');
    const to = new Date('2026-09-19T17:00:00.000Z');
    await danhSachDonAdmin(sql, {
      status: null,
      tenantId: TENANT,
      from,
      to,
      limit: 25,
      cursor: null,
    });
    const q = calls[0] as RecordedQuery;
    // `toContain` trên text + `arrayContaining` trên params không quan tâm THỨ TỰ — tráo
    // `>= $to` / `< $from` vẫn xanh. Neo theo đúng chỉ số `$n` mà mỗi điều kiện dùng để biết
    // chắc giá trị nào đi với điều kiện nào.
    const viTri = (re: RegExp) => Number(re.exec(q.text)?.[1]) - 1;
    expect(q.text).toContain('o.tenant_id = $');
    expect(q.text).toContain('o.created_at >= $');
    expect(q.text).toContain('o.created_at < $');
    expect(q.params[viTri(/o\.tenant_id = \$(\d+)/)]).toBe(TENANT);
    expect(q.params[viTri(/o\.created_at >= \$(\d+)/)]).toEqual(from);
    expect(q.params[viTri(/o\.created_at < \$(\d+)/)]).toEqual(to);
  });

  it('không lọc gì thì mọi tham số lọc là null và LIMIT vẫn dư một dòng', async () => {
    const { sql, calls } = fakeSql([]);
    await danhSachDonAdmin(sql, {
      status: null,
      tenantId: null,
      from: null,
      to: null,
      limit: 25,
      cursor: null,
    });
    const q = calls[0] as RecordedQuery;
    // status, tenantId, from, to, cursor createdAt (mỗi cái x2 vì xuất hiện ở cả nhánh IS NULL lẫn
    // nhánh so khớp) cộng cursorId (x1) — 11 tham số null; LIMIT là tham số thứ 12, giá trị 26.
    expect(q.params.filter((p) => p === null)).toHaveLength(11);
    // LIMIT luôn là tham số CUỐI của câu này.
    expect(q.params.at(-1)).toBe(26);
  });
});

describe('hai lệnh admin của pha 4 mang điều kiện trạng thái cũ NGAY TRONG SQL', () => {
  const LUC_GHI = new Date('2026-09-20T01:00:00Z');

  it('huyDonAdmin chỉ đụng đơn pending, ghi note, trả updated_at MỚI từ chính câu UPDATE', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER, updated_at: LUC_GHI }]);
    // Trả updated_at của DB (không phải đọc lại): route dựng phản hồi ngay từ giá trị này, nên đọc
    // lại bản ghi trước khi ghi rồi tự gán `updatedAt` là mốc CŨ — bài học đã trả giá ở pha 4.
    expect(await huyDonAdmin(sql, ORDER, 'Khách đổi ý')).toEqual(LUC_GHI);
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain("SET status = 'cancelled', note = $");
    expect(q.text).toContain("AND status = 'pending' RETURNING id, updated_at");
    expect(q.params).toEqual(['Khách đổi ý', ORDER]);
  });

  it('huyDonAdmin không đổi dòng nào (đơn đã đổi trạng thái) → null', async () => {
    const { sql } = fakeSql([]);
    expect(await huyDonAdmin(sql, ORDER, 'Khách đổi ý')).toBeNull();
  });

  it('danhDauHoanTien nhận fulfilled, paid_unfulfilled, underpaid — KHÔNG nhận pending hay paid; trả updated_at MỚI', async () => {
    const { sql, calls } = fakeSql([{ id: ORDER, updated_at: LUC_GHI }]);
    expect(await danhDauHoanTien(sql, ORDER, 'Hoàn theo yêu cầu')).toEqual(LUC_GHI);
    const q = calls[0] as RecordedQuery;
    expect(q.text).toContain("SET status = 'refunded', note = $");
    expect(q.text).toContain(
      "AND status IN ('fulfilled', 'paid_unfulfilled', 'underpaid') RETURNING id, updated_at",
    );
    // 'paid' đứng ngoài cố ý: đó là trạng thái đi ngang vài giây giữa webhook và sổ quota, đánh dấu
    // hoàn tiền vào đó chỉ đua vô ích với datDaCap.
    expect(q.text).not.toContain("'paid',");
  });

  it('danhDauHoanTien không đổi dòng nào → null', async () => {
    const { sql } = fakeSql([]);
    expect(await danhDauHoanTien(sql, ORDER, 'Hoàn theo yêu cầu')).toBeNull();
  });
});
