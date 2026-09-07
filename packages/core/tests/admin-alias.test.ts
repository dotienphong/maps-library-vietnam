import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adminAliasKeys, normalizeVi, parseAddress } from '../src';

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

  // 07/09/2026: `expectedKeys` viết tay trong fixture đã lệch khỏi dạng canonical
  // (`phuong da kao quan 1 thanh pho ho chi minh` so với `phuong da kao quan 1 ho chi minh`) và
  // còn mang huyện sai ở 10 ca; `scripts/admin-alias-fixtures.test.mjs` chỉ assert
  // `expectedKeys.length > 0` nên không bắt được. Chốt ở đây vì đây là nơi duy nhất import được
  // core, và fixture cũng nằm trong `packages/core/tests/fixtures/`.
  it('expectedKeys của 60 ca fixture khớp đúng adminAliasKeys()', () => {
    const stripUnit = (value: string) =>
      value.replace(/^(Phường|Xã|Thị trấn|Đặc khu|Quận|Huyện|Thành phố|Thị xã|Tỉnh)\s+/i, '');
    const lines = readFileSync(resolve(__dirname, 'fixtures/admin-alias-2025.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines).toHaveLength(60);
    for (const line of lines) {
      const item = JSON.parse(line) as { caseId: string; old: string; expectedKeys: string[] };
      const [ward = '', district = '', province = ''] = item.old.split(',').map((p) => p.trim());
      const expected = adminAliasKeys({
        ward: normalizeVi(stripUnit(ward)),
        district: normalizeVi(stripUnit(district)),
        province: normalizeVi(province).replace(/^thanh pho /, ''),
        adminOriginal: { ward, district, province },
      });
      expect(item.expectedKeys, `ca ${item.caseId}`).toEqual(expected);
    }
  });
});
