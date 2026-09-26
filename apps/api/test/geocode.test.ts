import { describe, expect, it } from 'vitest';
import type { getSql } from '../src/db';
import { geocode, INTEGER_HOUSE_NUMBER_PATTERN } from '../src/geocode';
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
    // Tên cũ của đường (spec 6.3): fallback cũng soi name_alt_norm, nhánh exact thì KHÔNG —
    // khớp đúng tên chính phải thắng trước, không để tên cũ chen vào.
    expect(streetQueries[1]?.text).toMatch(/\$\d+ <% name_alt_norm/);
    expect(streetQueries[0]?.text).not.toMatch(/name_alt_norm/);
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

// "Duong"/"pho" gõ không dấu: parser trả thêm tên bỏ tiền tố, geocoder chọn tên nào thật sự có
// trong bảng street. "38 Duong Nguyen Tat Thanh" từng rơi xuống bước đường mờ, lệch cả km.
describe('geocode — tiền tố "duong"/"pho" không dấu', () => {
  const anchor = { lat: 10.77, lng: 106.69, source: 'osm', ward_norm: null, province_norm: null };
  const streetExists = (names: string[]) => (query: { text: string; params: unknown[] }) =>
    query.text.includes('EXISTS') && query.text.includes('FROM street')
      ? [
          {
            primary_ok: names.includes(String(query.params[0])),
            alt_ok: names.includes(String(query.params[1])),
          },
        ]
      : null;

  it('tên gốc không có, tên bỏ tiền tố có → tra số nhà theo tên bỏ tiền tố', async () => {
    const exists = streetExists(['nguyen tat thanh']);
    const { sql } = fakeSql(
      (q) =>
        exists(q) ??
        (q.text.includes('FROM address_anchor') && q.params.includes('nguyen tat thanh')
          ? [anchor]
          : []),
    );
    await expect(geocode(sql, '38 Duong Nguyen Tat Thanh', null, 5)).resolves.toMatchObject([
      { precision: 'rooftop', matched: { housenumber: '38', street: 'Nguyen Tat Thanh' } },
    ]);
  });

  it('tên gốc có (Dương Bá Trạc gõ không dấu) → giữ tên gốc', async () => {
    const exists = streetExists(['duong ba trac']);
    const { sql } = fakeSql(
      (q) =>
        exists(q) ??
        (q.text.includes('FROM address_anchor') && q.params.includes('duong ba trac')
          ? [anchor]
          : []),
    );
    await expect(geocode(sql, '12 Duong Ba Trac', null, 5)).resolves.toMatchObject([
      { precision: 'rooftop', matched: { street: 'Duong Ba Trac' } },
    ]);
  });

  it('không có phương án phụ thì không tốn thêm truy vấn kiểm tên', async () => {
    const { sql, calls } = fakeSql([]);
    await geocode(sql, '38 Nguyễn Tất Thành', null, 5);
    expect(calls.some((c) => c.text.includes('EXISTS') && c.text.includes('FROM street'))).toBe(
      false,
    );
  });
});
