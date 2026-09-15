import { describe, expect, it } from 'vitest';
import { normalizeVi } from '../src/normalize';
import { applyToponymAlias, TOPONYM_ALIAS } from '../src/toponym';
import { viKey } from '../src/vi-key';

const entries = Object.entries(TOPONYM_ALIAS);

describe('toponym_alias.json — hình dạng và nguồn', () => {
  // Ngưỡng thấp là CỐ Ý: spec yêu cầu mỗi dòng phải có nguồn kiểm được, và Overpass chỉ trả về
  // đúng số địa danh này có `alt_name`/`old_name` trên OSM. Thêm dòng không nguồn là vi phạm spec,
  // nên số lượng do dữ liệu quyết định, không do mong muốn.
  it('có ít nhất 6 địa danh', () => {
    expect(entries.length).toBeGreaterThanOrEqual(6);
  });

  for (const [canonical, { variants, source }] of entries) {
    it(`${canonical}: chuẩn và biến thể đều là dạng normalizeVi, có nguồn kiểm được`, () => {
      expect(normalizeVi(canonical)).toBe(canonical);
      expect(source).toMatch(/^(osm:(node|way|relation)\/\d+ \S+|wikipedia:vi:.+)$/);
      for (const v of variants) expect(normalizeVi(v), v).toBe(v);
    });

    // Spec 6.1: cặp chỉ khác DẤU đã trùng nhau sau normalizeVi nên KHÔNG được đưa vào từ điển.
    // Test này đỏ để người biên soạn xoá dòng, thay vì để nó nằm đó vô nghĩa.
    it(`${canonical}: mọi biến thể phải KHÁC dạng chuẩn`, () => {
      for (const v of variants) expect(v).not.toBe(canonical);
    });
  }

  it('không biến thể nào thuộc hai địa danh khác nhau', () => {
    const seen = new Map<string, string>();
    for (const [canonical, { variants }] of entries) {
      for (const v of variants) {
        expect(
          seen.get(v),
          `biến thể "${v}" thuộc cả ${seen.get(v)} và ${canonical}`,
        ).toBeUndefined();
        seen.set(v, canonical);
      }
    }
  });

  it('không biến thể nào trùng dạng chuẩn của địa danh khác (tránh thay dây chuyền)', () => {
    const canonicals = new Set(entries.map(([c]) => c));
    for (const [canonical, { variants }] of entries) {
      for (const v of variants) {
        expect(canonicals.has(v), `"${v}" của ${canonical} lại là dạng chuẩn của mục khác`).toBe(
          false,
        );
      }
    }
  });
});

describe('applyToponymAlias', () => {
  it('thay ở đầu, giữa và cuối chuỗi theo biên từ', () => {
    expect(applyToponymAlias('qui nhon')).toBe('quy nhon');
    expect(applyToponymAlias('cafe qui nhon 2')).toBe('cafe quy nhon 2');
    expect(applyToponymAlias('duong ve qui nhon')).toBe('duong ve quy nhon');
  });

  it('không thay khi biến thể chỉ là một phần của từ khác', () => {
    expect(applyToponymAlias('faifoo')).toBe('faifoo');
    expect(applyToponymAlias('xfaifo')).toBe('xfaifo');
  });

  it('biến thể dài được ưu tiên trước biến thể ngắn', () => {
    expect(applyToponymAlias('ban me thuot')).toBe('buon ma thuot');
    expect(applyToponymAlias('buon me thuot')).toBe('buon ma thuot');
  });

  it('chuỗi không chứa biến thể nào thì trả nguyên', () => {
    expect(applyToponymAlias('nguyen hue')).toBe('nguyen hue');
    expect(applyToponymAlias('')).toBe('');
  });

  it('idempotent: áp lần hai không đổi thêm', () => {
    const once = applyToponymAlias('tan son nhut');
    expect(applyToponymAlias(once)).toBe(once);
  });
});

// Từ điển chỉ cần chứa những biến thể mà `viKey` KHÔNG gộp được — phần còn lại đã có bậc 3 lo.
// Ngoại lệ duy nhất là `qui nhon`: viKey gộp được, nhưng nó là ca trong tiêu chí nghiệm thu 11.6
// nên cần khớp ngay ở bậc 1, và nó có nguồn OSM chắc chắn.
describe('từ điển không lặp việc của viKey', () => {
  const VIKEY_OVERLAP_ALLOWED = new Set(['qui nhon', 'daklak']);
  for (const [canonical, { variants }] of entries) {
    for (const v of variants) {
      if (VIKEY_OVERLAP_ALLOWED.has(v)) continue;
      it(`${v} → ${canonical}: viKey không gộp được nên từ điển là cần thiết`, () => {
        expect(viKey(v)).not.toBe(viKey(canonical));
      });
    }
  }
});
