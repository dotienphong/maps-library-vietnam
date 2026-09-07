import { describe, expect, it } from 'vitest';
import { filterNameAlt, searchKeys } from '../src/search-keys';

describe('searchKeys', () => {
  it('name_key = viKey(applyToponymAlias(name_norm)); name_alt_norm nối " | " sau normalizeVi', () => {
    // toponym: qui nhon → quy nhon; viKey: quy→qui, nhon giữ, coffee giữ (không có luật ee).
    expect(searchKeys('qui nhon coffee', ['Quy Nhon Cafe', 'Café Qui Nhơn'])).toEqual({
      nameKey: 'quinhoncoffee',
      nameAltNorm: 'quy nhon cafe | cafe qui nhon',
    });
  });

  it('không có tên thay thế → nameAltNorm null', () => {
    // 'nguyen' không đổi: y ở giữa từ không thuộc luật ([cons])y$.
    expect(searchKeys('nguyen hue', [])).toEqual({ nameKey: 'nguyenhue', nameAltNorm: null });
    expect(searchKeys('nguyen hue', null)).toEqual({ nameKey: 'nguyenhue', nameAltNorm: null });
  });

  it('tên thay thế rỗng/trùng/trùng tên chính bị bỏ, giữ thứ tự xuất hiện', () => {
    // cong → con (ng$→n); ly → li.
    expect(
      searchKeys('cong ly', ['', 'Nam Kỳ Khởi Nghĩa', 'nam ky khoi nghia', 'Công Lý']),
    ).toEqual({
      nameKey: 'conli',
      nameAltNorm: 'nam ky khoi nghia',
    });
  });

  it('dấu | trong tên thay thế không phá dấu phân cách', () => {
    expect(searchKeys('a', ['b|c']).nameAltNorm).toBe('b c');
  });
});

describe('filterNameAlt', () => {
  // Đây là bất biến mà `matched_alt` của API dựa vào: pipeline ghi mảng gốc đã lọc, còn
  // `name_alt_norm` sinh từ CÙNG mảng đó, nên chỉ số phần tử hai bên phải thẳng hàng.
  it('trả mảng GỐC (chưa chuẩn hoá) thẳng hàng với name_alt_norm', () => {
    const alt = ['', 'Nam Kỳ Khởi Nghĩa', 'nam ky khoi nghia', 'Công Lý', 'Duy Tân'];
    const kept = filterNameAlt('cong ly', alt);
    expect(kept).toEqual(['Nam Kỳ Khởi Nghĩa', 'Duy Tân']);
    const norm = searchKeys('cong ly', alt).nameAltNorm?.split(' | ');
    expect(norm).toHaveLength(kept.length);
    expect(norm?.[1]).toBe('duy tan');
  });

  it('null/undefined → mảng rỗng', () => {
    expect(filterNameAlt('a', null)).toEqual([]);
    expect(filterNameAlt('a', undefined)).toEqual([]);
  });

  it('idempotent: lọc lần hai không bỏ thêm gì', () => {
    const once = filterNameAlt('cong ly', ['Nam Kỳ Khởi Nghĩa', 'Duy Tân']);
    expect(filterNameAlt('cong ly', once)).toEqual(once);
  });
});
