import { describe, expect, it } from 'vitest';
import { adminAliasKeys, parseAddress } from '../src';

describe('adminAliasKeys', () => {
  it('giữ tiền tố cấp và xếp khóa cụ thể trước', () => {
    const parsed = parseAddress('88/9 Nguyễn Lâm, Phường 6, Quận 10, TP.HCM');
    expect(parsed.adminOriginal).toEqual({
      ward: 'Phường 6',
      district: 'Quận 10',
      province: 'TP.HCM',
    });
    expect(adminAliasKeys(parsed).slice(0, 2)).toEqual([
      'phuong 6 quan 10 ho chi minh',
      'phuong 6 quan 10',
    ]);
    expect(adminAliasKeys(parsed)).not.toContain('6');
  });

  it('không làm mất tên tỉnh cũ khi parser canonicalize', () => {
    const parsed = parseAddress('Tỉnh Bình Dương');
    expect(parsed.province).toBe('Thành phố Hồ Chí Minh');
    expect(parsed.adminOriginal?.province).toBe('Tỉnh Bình Dương');
    expect(adminAliasKeys(parsed)).toContain('binh duong');
  });

  it('hỗ trợ xã, thị trấn và thành phố cấp huyện', () => {
    expect(
      adminAliasKeys({
        ward: 'Tân Thông Hội',
        district: 'Củ Chi',
        province: 'Thành phố Hồ Chí Minh',
        adminOriginal: { ward: 'Xã Tân Thông Hội', district: 'Huyện Củ Chi' },
      }),
    ).toContain('xa tan thong hoi huyen cu chi ho chi minh');
    expect(
      adminAliasKeys({
        district: 'Thủ Dầu Một',
        province: 'Thành phố Hồ Chí Minh',
        adminOriginal: { district: 'Thành phố Thủ Dầu Một', province: 'Tỉnh Bình Dương' },
      }),
    ).toContain('thanh pho thu dau mot binh duong');
  });

  it('loại khóa trần là số và loại khóa trùng', () => {
    const keys = adminAliasKeys({ ward: '6', district: '10' });
    expect(keys).not.toContain('6');
    expect(new Set(keys).size).toBe(keys.length);
  });
});
