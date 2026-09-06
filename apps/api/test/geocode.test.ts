import { describe, expect, it } from 'vitest';
import type { getSql } from '../src/db';
import { INTEGER_HOUSE_NUMBER_PATTERN, geocode } from '../src/geocode';
import { fakeSql } from './helpers/fake-sql';

describe('geocode helpers', () => {
  it('admin level 6 dùng precision cục bộ ward, không giả thành province', async () => {
    const sql = (async () => [
      {
        name: 'Quận Hoàn Kiếm',
        level: 6,
        lat: 21.03,
        lng: 105.85,
        xmin: 105.84,
        ymin: 21.02,
        xmax: 105.86,
        ymax: 21.04,
      },
    ]) as unknown as ReturnType<typeof getSql>;

    await expect(geocode(sql, 'Quận Hoàn Kiếm', null, 5)).resolves.toMatchObject([
      {
        precision: 'ward',
        matched: { ward: 'Quận Hoàn Kiếm' },
      },
    ]);
  });

  it('stepStreet: khớp đúng tên trước, thiếu thì fallback bằng q <% name_norm (không dùng %)', async () => {
    const { sql, calls } = fakeSql([]);
    await geocode(sql, 'Nguyen Lam', null, 5);
    const streetQueries = calls.filter((call) => call.text.includes('FROM street'));
    expect(streetQueries).toHaveLength(2);
    expect(streetQueries[0]?.text).toContain('name_norm = $1');
    // Fallback giữ cả hai toán tử: <% cho cụm/đảo từ, % cho lỗi gõ trên từ ngắn.
    expect(streetQueries[1]?.text).toMatch(/\$\d+ <% name_norm/);
    expect(streetQueries[1]?.text).toMatch(/name_norm % \$\d+/);
  });

  it('guard ép int nhận số nhà thực tế nhưng loại SĐT/ID quá dài từ nguồn', () => {
    const pattern = new RegExp(INTEGER_HOUSE_NUMBER_PATTERN);
    expect(pattern.test('123456789')).toBe(true);
    expect(pattern.test('1000000000000000000000000')).toBe(false);
  });

  it('alias cũ truyền tập ward và polygon old xuyên suốt các bước địa chỉ', async () => {
    const { sql, calls } = fakeSql((query) =>
      query.text.includes('FROM admin_alias')
        ? [
            {
              alias_norm: 'phuong cu alpha',
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
            },
          ]
        : [],
    );
    await geocode(sql, '86 Nguyễn Lâm, Phường Cũ, Tỉnh Alpha', null, 5);
    const scoped = calls.filter((call) =>
      /FROM address_anchor|FROM alley|FROM street/.test(call.text),
    );
    expect(scoped.some((call) => call.text.includes('= ANY(') && call.params.includes('901'))).toBe(
      true,
    );
  });
});
