import { COMPARISON, PLAN_CATALOG, savingsPercent } from '@mapslibvn/catalog';
import { describe, expect, it } from 'vitest';
import {
  bangGia,
  dinhDangSo,
  dinhDangUsd,
  dinhDangVnd,
  GOI_NOI_BAT,
  soSanh,
  tomTatGia,
} from './gia';

describe('định dạng', () => {
  it('VND dùng dấu chấm nhóm nghìn và hậu tố đ, không lẻ xu', () => {
    expect(dinhDangVnd(650_000)).toBe('650.000đ');
    expect(dinhDangVnd(10_400_000)).toBe('10.400.000đ');
    expect(dinhDangVnd(0)).toBe('0đ');
  });

  it('USD giữ hai chữ số khi lẻ, bỏ khi tròn', () => {
    expect(dinhDangUsd(2_500)).toBe('$25');
    expect(dinhDangUsd(3_962)).toBe('$39,62');
  });

  it('số lượt nhóm nghìn theo kiểu Việt', () => {
    expect(dinhDangSo(30_000)).toBe('30.000');
    expect(dinhDangSo(400_000)).toBe('400.000');
  });
});

describe('bangGia', () => {
  it('trả bốn gói theo thứ tự, mỗi gói đủ bốn kỳ giá', () => {
    const goi = bangGia();
    expect(goi.map((g) => g.tier)).toEqual(['trial', 'starter', 'professional', 'business']);
    for (const g of goi) {
      expect(
        Object.keys(g.theoKy)
          .map(Number)
          .sort((a, b) => a - b),
      ).toEqual([1, 3, 6, 12]);
    }
  });

  it('giá từng kỳ = giá tháng nhân số tháng, không chiết khấu', () => {
    const starter = bangGia().find((g) => g.tier === 'starter');
    expect(starter?.theoKy[1]?.vnd).toBe(650_000);
    expect(starter?.theoKy[3]?.vnd).toBe(1_950_000);
    expect(starter?.theoKy[12]?.vnd).toBe(7_800_000);
    expect(starter?.theoKy[12]?.vndHienThi).toBe('7.800.000đ');
  });

  it('gói dùng thử giá 0 ở mọi kỳ và ghi rõ thời hạn 30 ngày', () => {
    const trial = bangGia().find((g) => g.tier === 'trial');
    expect(trial?.theoKy[12]?.vnd).toBe(0);
    expect(trial?.ghiChuHan).toMatch(/30 ngày/);
  });

  it('hạn mức và hỗ trợ trực tuyến chép đúng catalog, không có số lạ', () => {
    for (const g of bangGia()) {
      const goc = PLAN_CATALOG[g.tier];
      expect(g.places).toBe(goc.places);
      expect(g.directions).toBe(goc.directions);
      expect(g.hoTroOnline).toBe(goc.onlineSupport);
    }
  });

  it('gói nổi bật là Professional — gói duy nhất vừa có hỗ trợ vừa chưa phải giá cao nhất', () => {
    expect(GOI_NOI_BAT).toBe('professional');
  });
});

describe('tomTatGia', () => {
  it('cho trang chủ: đủ bốn gói theo thứ tự, gói dùng thử đứng đầu', () => {
    const tom = tomTatGia();
    expect(tom.map((t) => t.tier)).toEqual(['trial', 'starter', 'professional', 'business']);
  });

  it('gói dùng thử: 0đ cho 30 ngày, nói rõ không cần thẻ và hạn mức tổng', () => {
    const trial = tomTatGia()[0];
    expect(trial?.giaHienThi).toBe('0đ');
    expect(trial?.donVi).toBe('/ 30 ngày');
    expect(trial?.dongPhu).toMatch(/không cần thẻ/);
    expect(trial?.hanMuc).toBe('2.000 lượt Places trong 30 ngày');
  });

  it('gói trả phí: giá một tháng, USD tham chiếu và hạn mức theo tháng', () => {
    const starter = tomTatGia()[1];
    expect(starter?.giaHienThi).toBe('650.000đ');
    expect(starter?.donVi).toBe('/ tháng');
    expect(starter?.dongPhu).toBe('tham chiếu $25');
    expect(starter?.hanMuc).toBe('30.000 lượt Places mỗi tháng');
  });
});

describe('soSanh', () => {
  it('ba dòng, mỗi dòng có phần trăm rẻ hơn tính từ COMPARISON chứ không gõ tay', () => {
    const rows = soSanh();
    expect(rows).toHaveLength(3);
    const starter = rows[0];
    expect(starter?.reHonGoogle).toBe(savingsPercent(25, COMPARISON.rows[0].googleUsd));
    expect(starter?.reHonVietmap).toBe(savingsPercent(25, COMPARISON.rows[0].vietmapUsd));
    expect(starter?.googleVndHienThi).toBe('1.030.120đ');
  });

  it('khoảng phần trăm rẻ hơn Google dùng cho câu mở đầu trang chủ', () => {
    const rows = soSanh();
    const thap = Math.min(...rows.map((r) => r.reHonGoogle));
    const cao = Math.max(...rows.map((r) => r.reHonGoogle));
    expect(Math.round(thap)).toBe(37);
    expect(Math.round(cao)).toBe(68);
  });

  it('mang theo ngày đối chiếu, giả định và nguồn — số trần không được phép lên trang', () => {
    const rows = soSanh();
    expect(rows[0]?.workload).toMatch(/30\.000/);
    expect(COMPARISON.checkedAt).toBe('2026-09-14');
    expect(COMPARISON.sources).toHaveLength(3);
  });
});
