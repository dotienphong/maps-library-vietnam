import { describe, expect, it } from 'vitest';
import { resolveAdminScope } from '../src/admin-scope';
import { fakeSql } from './helpers/fake-sql';

const edge = (overrides: Record<string, unknown> = {}) => ({
  alias_norm: 'phuong cu quan cu alpha',
  level: 8,
  source: 'overlay',
  admin_area_id: '101',
  current_name: 'Phường Mới',
  current_name_norm: 'moi',
  current_province_norm: 'alpha',
  old_id: '901',
  old_name: 'Phường Cũ',
  old_level: 8,
  xmin: 106,
  ymin: 10,
  xmax: 107,
  ymax: 11,
  lat: 10.5,
  lng: 106.5,
  ...overrides,
});

describe('resolveAdminScope', () => {
  it('không có phần hành chính thì không truy vấn DB', async () => {
    const { sql, calls } = fakeSql(() => {
      throw new Error('không được query');
    });
    await expect(
      resolveAdminScope(sql, { alleyChain: [], confidence: 0, street: 'Nguyễn Lâm' }),
    ).resolves.toEqual({ wardNorms: [], provinceNorm: null });
    expect(calls).toHaveLength(0);
  });

  it('không có alias thì giữ scope hiện hành từ parser', async () => {
    const { sql } = fakeSql([]);
    await expect(
      resolveAdminScope(sql, {
        alleyChain: [],
        confidence: 0.3,
        ward: 'Diên Hồng',
        province: 'Thành phố Hồ Chí Minh',
      }),
    ).resolves.toEqual({ wardNorms: ['dien hong'], provinceNorm: 'ho chi minh' });
  });

  it('phường tách lấy toàn bộ cạnh của nhóm alias thắng', async () => {
    const { sql } = fakeSql([
      edge(),
      edge({ admin_area_id: '102', current_name: 'Phường Mới Hai', current_name_norm: 'moi hai' }),
    ]);
    const scope = await resolveAdminScope(sql, {
      alleyChain: [],
      confidence: 0.45,
      ward: 'Cũ',
      district: 'Cũ',
      province: 'Tỉnh Alpha',
      adminOriginal: { ward: 'Phường Cũ', district: 'Quận Cũ', province: 'Tỉnh Alpha' },
    });
    expect(scope.wardNorms).toEqual(['moi', 'moi hai']);
    expect(scope.former).toEqual({ ward: 'Phường Cũ' });
    expect(scope.oldArea).toMatchObject({ id: '901', level: 8, bbox: [106, 10, 107, 11] });
  });

  it('lọc theo ancestry tỉnh cũ và không trộn phường trùng tên', async () => {
    const { sql, calls } = fakeSql([edge()]);
    await resolveAdminScope(sql, {
      alleyChain: [],
      confidence: 0.3,
      ward: 'Cũ',
      province: 'Tỉnh Alpha',
      adminOriginal: { ward: 'Phường Cũ', province: 'Tỉnh Alpha' },
    });
    const query = calls[0];
    expect(query?.text).toContain('old.province_norm');
    expect(query?.text).toContain('current_province_norm');
    expect(query?.params).toEqual(expect.arrayContaining(['alpha']));
  });

  it('tên tỉnh cũ giữ former, còn tỉnh hiện hành không sinh former giả', async () => {
    const old = fakeSql([
      edge({
        alias_norm: 'binh duong',
        level: 4,
        current_name: 'Thành phố Hồ Chí Minh',
        current_name_norm: 'ho chi minh',
        current_province_norm: 'ho chi minh',
        old_name: 'Tỉnh Bình Dương',
        old_level: 4,
      }),
    ]);
    await expect(
      resolveAdminScope(old.sql, {
        alleyChain: [],
        confidence: 0.15,
        province: 'Thành phố Hồ Chí Minh',
        adminOriginal: { province: 'Tỉnh Bình Dương' },
      }),
    ).resolves.toMatchObject({
      provinceNorm: 'ho chi minh',
      former: { province: 'Tỉnh Bình Dương' },
    });

    const current = fakeSql([]);
    const scope = await resolveAdminScope(current.sql, {
      alleyChain: [],
      confidence: 0.15,
      province: 'Thành phố Hồ Chí Minh',
      adminOriginal: { province: 'TP.HCM' },
    });
    expect(scope.former).toBeUndefined();
  });

  it('seed không có old_area_id vẫn phân giải đích current', async () => {
    const { sql } = fakeSql([
      edge({
        old_id: null,
        old_name: null,
        old_level: null,
        xmin: null,
        ymin: null,
        xmax: null,
        ymax: null,
      }),
    ]);
    const scope = await resolveAdminScope(sql, {
      alleyChain: [],
      confidence: 0.15,
      ward: 'Cũ',
      adminOriginal: { ward: 'Phường Cũ' },
    });
    expect(scope.wardNorms).toEqual(['moi']);
    expect(scope.oldArea).toBeUndefined();
  });

  it('Thủ Dầu Một ưu tiên old L6 trước tỉnh đã canonicalize', async () => {
    const { sql, calls } = fakeSql([
      edge({
        alias_norm: 'thanh pho thu dau mot binh duong',
        level: 6,
        old_name: 'Thành phố Thủ Dầu Một',
        old_level: 6,
      }),
    ]);
    const scope = await resolveAdminScope(sql, {
      alleyChain: [],
      confidence: 0.25,
      district: 'Thủ Dầu Một',
      province: 'Thành phố Hồ Chí Minh',
      adminOriginal: { district: 'Thành phố Thủ Dầu Một', province: 'Tỉnh Bình Dương' },
    });
    expect(calls[0]?.params).toContainEqual(
      expect.stringContaining('thanh pho thu dau mot binh duong'),
    );
    expect(calls[0]?.params).toContain(6);
    expect(scope.former).toEqual({ district: 'Thành phố Thủ Dầu Một' });
  });
});
