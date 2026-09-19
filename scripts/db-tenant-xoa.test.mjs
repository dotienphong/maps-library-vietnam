import { describe, expect, it } from 'vitest';
import { BANG_DA_BIET, bangLa, CONFIRM_PHRASE, parseXoaArgs, quyetDinh } from './db-tenant-xoa.mjs';

describe('parseXoaArgs', () => {
  it('đọc được tên có dấu cách', () => {
    expect(parseXoaArgs(['--name', 'Phong Company Test']).name).toBe('Phong Company Test');
  });

  it('thiếu --name thì ném, không chạy với tên rỗng', () => {
    expect(() => parseXoaArgs([])).toThrow(/Thiếu --name/);
    expect(() => parseXoaArgs(['--name', '--apply'])).toThrow(/Thiếu --name/);
  });

  it('mặc định là DRY-RUN', () => {
    expect(parseXoaArgs(['--name', 'X']).apply).toBe(false);
  });

  it('--apply mà thiếu hoặc sai --confirm thì ném — một cổng không đủ', () => {
    expect(() => parseXoaArgs(['--name', 'X', '--apply'])).toThrow(/--confirm/);
    expect(() => parseXoaArgs(['--name', 'X', '--apply', '--confirm', 'XOA'])).toThrow(/--confirm/);
    expect(() =>
      parseXoaArgs(['--name', 'X', '--apply', '--confirm', 'XOA-TOAN-BO-TENANT']),
    ).toThrow(/--confirm/);
  });

  it('đủ hai cổng thì cho phép', () => {
    const r = parseXoaArgs(['--name', 'X', '--apply', '--confirm', CONFIRM_PHRASE]);
    expect(r.apply).toBe(true);
    expect(r.xoaDongGop).toBe(false);
    expect(r.xoaDonHang).toBe(false);
  });

  it('--xoa-don-hang là cờ RIÊNG, không đi kèm --xoa-dong-gop', () => {
    // Hai loại dữ liệu khác nhau: đóng góp POI là của người dùng bản đồ, đơn hàng là hồ sơ tài
    // chính. Một cờ chung sẽ khiến người vận hành xoá thứ mình không định xoá.
    const r = parseXoaArgs(['--name', 'X', '--xoa-don-hang']);
    expect(r.xoaDonHang).toBe(true);
    expect(r.xoaDongGop).toBe(false);
  });

  it('chuỗi xác nhận KHÁC chuỗi của db-tenant-reset — hai lệnh hậu quả khác nhau', () => {
    expect(CONFIRM_PHRASE).toBe('XOA-MOT-TENANT');
    expect(CONFIRM_PHRASE).not.toBe('XOA-TOAN-BO-TENANT');
  });
});

describe('bangLa', () => {
  it('bỏ qua các bảng đã biết cách dọn', () => {
    expect(bangLa(BANG_DA_BIET.map((table_name) => ({ table_name })))).toEqual([]);
  });

  it('bảng lạ thì báo ra — migration sau thêm quan hệ mới là phải dừng', () => {
    expect(bangLa([{ table_name: 'api_key' }, { table_name: 'bang_moi_toanh' }])).toEqual([
      'bang_moi_toanh',
    ]);
  });

  it('biết bốn bảng của schema hiện tại, gồm hai bảng mà 0020 thêm', () => {
    expect(BANG_DA_BIET).toContain('tenant_member');
    expect(BANG_DA_BIET).toContain('customer_account');
  });

  it('biết cả customer_order mà 0023 thêm — chính bảng làm nút "Xoá tổ chức" hỏng', () => {
    expect(BANG_DA_BIET).toContain('customer_order');
  });
});

describe('quyetDinh', () => {
  it('không thấy tenant thì không xoá', () => {
    expect(quyetDinh({ tenant: null, edits: 0, xoaDongGop: false })).toEqual({
      xoaDuoc: false,
      vi: 'khong-thay-tenant',
    });
  });

  it('còn đóng góp POI thì DỪNG — đó là dữ liệu bản đồ dùng chung', () => {
    expect(quyetDinh({ tenant: { id: 'x' }, edits: 3, xoaDongGop: false })).toEqual({
      xoaDuoc: false,
      vi: 'con-dong-gop',
    });
  });

  it('có --xoa-dong-gop thì người vận hành đã quyết, cho đi tiếp', () => {
    expect(quyetDinh({ tenant: { id: 'x' }, edits: 3, xoaDongGop: true }).xoaDuoc).toBe(true);
  });

  it('không đóng góp nào thì xoá thẳng', () => {
    expect(quyetDinh({ tenant: { id: 'x' }, edits: 0, xoaDongGop: false }).xoaDuoc).toBe(true);
  });

  it('còn đơn hàng thì DỪNG — đơn là hồ sơ tài chính, không xoá theo quán tính', () => {
    expect(quyetDinh({ tenant: { id: 'x' }, edits: 0, xoaDongGop: false, orders: 2 })).toEqual({
      xoaDuoc: false,
      vi: 'con-don-hang',
    });
  });

  it('có --xoa-don-hang thì người vận hành đã quyết, cho đi tiếp', () => {
    expect(
      quyetDinh({ tenant: { id: 'x' }, edits: 0, xoaDongGop: false, orders: 2, xoaDonHang: true })
        .xoaDuoc,
    ).toBe(true);
  });

  it('--xoa-dong-gop KHÔNG mở khoá cho đơn hàng — hai cờ, hai loại dữ liệu', () => {
    expect(quyetDinh({ tenant: { id: 'x' }, edits: 1, xoaDongGop: true, orders: 1 }).vi).toBe(
      'con-don-hang',
    );
  });
});
