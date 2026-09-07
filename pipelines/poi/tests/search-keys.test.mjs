import { describe, expect, it } from 'vitest';
import { pgArray } from '../src/lib/copy-format.mjs';
import { planFill } from '../src/lib/search-keys.mjs';

describe('planFill — chuẩn bị dữ liệu điền name_key/name_alt_norm', () => {
  it('khoá theo id: mỗi dòng → [id, name_key, name_alt_norm, name_alt đã lọc]', () => {
    const rows = planFill(
      [{ id: 7, name_norm: 'qui nhon', name_alt: ['Quy Nhon City', 'Qui Nhon'] }],
      { joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
    );
    // 'Qui Nhon' trùng name_norm sau normalizeVi → bị lọc; mảng gốc còn 1 phần tử, thẳng hàng với norm.
    expect(rows).toEqual([[7, 'quinhon', 'quy nhon city', pgArray(['Quy Nhon City'])]]);
  });

  it('khoá theo alias_norm (admin_alias): trùng alias_norm chỉ tính một lần, không có alt', () => {
    const rows = planFill(
      [{ alias_norm: 'quan 10' }, { alias_norm: 'quan 10' }, { alias_norm: 'phuong 6' }],
      { joinColumns: ['alias_norm'], nameNormColumn: 'alias_norm', altColumn: null },
    );
    expect(rows.map((r) => r[0])).toEqual(['quan 10', 'phuong 6']);
    expect(rows[0]?.slice(2)).toEqual([null, null]);
  });

  // Bất biến của matched_alt: hai cột phải cùng số phần tử và cùng thứ tự.
  it('name_alt đã lọc và name_alt_norm luôn cùng số phần tử, cùng thứ tự', () => {
    const [row] = planFill(
      [
        {
          id: 1,
          name_norm: 'cong ly',
          name_alt: ['', 'Nam Kỳ Khởi Nghĩa', 'nam ky khoi nghia', 'Công Lý', 'Duy Tân'],
        },
      ],
      { joinColumns: ['id'], nameNormColumn: 'name_norm', altColumn: 'name_alt' },
    );
    expect(row?.[2]).toBe('nam ky khoi nghia | duy tan');
    expect(row?.[3]).toBe(pgArray(['Nam Kỳ Khởi Nghĩa', 'Duy Tân']));
  });

  it('name_alt là null trong DB → cột alt trả null, không nổ', () => {
    const [row] = planFill([{ id: 2, name_norm: 'le loi', name_alt: null }], {
      joinColumns: ['id'],
      nameNormColumn: 'name_norm',
      altColumn: 'name_alt',
    });
    expect(row).toEqual([2, 'leloi', null, null]);
  });
});
