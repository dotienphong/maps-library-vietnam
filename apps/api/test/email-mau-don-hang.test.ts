import { describe, expect, it } from 'vitest';
import {
  mauBaoAdminThieuTien,
  mauBienNhan,
  mauNhacHan,
  mauThieuTien,
  moTaDon,
  ngayVn,
} from '../src/email/mau-don-hang';

describe('moTaDon', () => {
  it('gói: tên bậc + số tháng; lượt: số lượt + tên nhóm', () => {
    expect(
      moTaDon({ kind: 'plan', tier: 'starter', months: 3, quota_group: null, packs: null }),
    ).toBe('Starter 3 tháng');
    expect(
      moTaDon({ kind: 'addon', tier: null, months: null, quota_group: 'places', packs: 5 }),
    ).toBe('5.000 lượt Places');
    expect(
      moTaDon({ kind: 'addon', tier: null, months: null, quota_group: 'directions', packs: 1 }),
    ).toBe('1.000 lượt tính tuyến');
  });
});

describe('ngayVn', () => {
  it('in theo ngày Việt Nam, không phải ngày UTC', () => {
    // 19/12 03:00Z = 19/12 10:00 giờ VN; còn 18/12 18:00Z = 19/12 01:00 VN — cùng ngày 19.
    expect(ngayVn('2026-12-19T03:00:00Z')).toBe('19/12/2026');
    expect(ngayVn('2026-12-18T18:00:00Z')).toBe('19/12/2026');
  });
});

describe('mauBienNhan', () => {
  const thu = mauBienNhan({
    orderCode: 100001,
    moTa: 'Starter 3 tháng',
    amountVnd: 1_950_000,
    tenTenant: 'Công ty Thử',
    hieuLucTu: '2026-09-19T03:00:00.000Z',
    hetHan: '2026-12-19T03:00:00.000Z',
    consoleUrl: 'https://api.test/console/don-hang/x',
  });

  it('có cả bản chữ lẫn HTML; mã đơn, số tiền và hiệu lực xuất hiện ở cả hai', () => {
    for (const ban of [thu.text, thu.html]) {
      expect(ban).toContain('100001');
      expect(ban).toContain('1.950.000đ');
      expect(ban).toContain('Starter 3 tháng');
      expect(ban).toContain('19/09/2026');
      expect(ban).toContain('19/12/2026');
    }
    expect(thu.subject).toBe('Biên nhận đơn 100001 — MapsLibVN');
  });

  it('nói rõ không phải chứng từ thuế — hoá đơn VAT nằm ngoài phạm vi', () => {
    expect(thu.text).toContain('không phải chứng từ thuế');
  });

  it('thiếu mốc hiệu lực (đơn mua lượt) vẫn gửi được, không in "null"', () => {
    const luot = mauBienNhan({
      orderCode: 100002,
      moTa: '5.000 lượt Places',
      amountVnd: 130_000,
      tenTenant: 'Công ty Thử',
      hieuLucTu: null,
      hetHan: null,
      consoleUrl: null,
    });
    expect(luot.text).not.toContain('null');
    expect(luot.html).not.toContain('null');
    expect(luot.text).toContain('130.000đ');
  });
});

describe('mauThieuTien và mauBaoAdminThieuTien', () => {
  it('khách: số đã nhận, số còn thiếu, nội dung chuyển khoản, email hỗ trợ', () => {
    const thu = mauThieuTien({
      orderCode: 100001,
      amountVnd: 1_950_000,
      daNhan: 1_900_000,
      noiDungChuyenKhoan: 'MLV100001',
      supportEmail: 'ho-tro@vidu.vn',
    });
    expect(thu.text).toContain('1.900.000đ');
    expect(thu.text).toContain('50.000đ');
    expect(thu.text).toContain('MLV100001');
    expect(thu.text).toContain('ho-tro@vidu.vn');
    expect(thu.subject).toContain('100001');
  });

  it('admin: tên tổ chức và link mở màn đơn', () => {
    const thu = mauBaoAdminThieuTien({
      orderCode: 100001,
      tenTenant: 'Công ty Thử',
      amountVnd: 1_950_000,
      daNhan: 1_900_000,
      adminUrl: 'https://api.test/admin/orders?id=x',
    });
    expect(thu.text).toContain('Công ty Thử');
    expect(thu.text).toContain('https://api.test/admin/orders?id=x');
    expect(thu.subject).toContain('[Admin]');
  });
});

describe('mauNhacHan', () => {
  const goc = { tenTenant: 'Công ty Thử', tenGoi: 'Starter', hetHan: '2026-12-19T03:00:00.000Z' };

  it('ba loại, ba tiêu đề khác nhau; có nút console khi có URL', () => {
    const bay = mauNhacHan({ ...goc, loai: '7d', consoleUrl: 'https://api.test/console/mua' });
    const mot = mauNhacHan({ ...goc, loai: '1d', consoleUrl: null });
    const het = mauNhacHan({ ...goc, loai: 'het', consoleUrl: null });
    expect(bay.subject).toContain('7 ngày');
    expect(mot.subject).toContain('ngày mai');
    expect(het.subject).toContain('đã hết hạn');
    expect(bay.html).toContain('https://api.test/console/mua');
    // Thiếu CONSOLE_ORIGIN thì bỏ hẳn nút, chứ không dựng một href="null".
    expect(mot.html).not.toContain('null');
    for (const t of [bay, mot, het]) expect(t.text).toContain('19/12/2026');
  });
});
