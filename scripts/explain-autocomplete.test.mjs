import { describe, expect, it } from 'vitest';
import { buildCases, parseArgs, timesOf } from './explain-autocomplete.mjs';

describe('buildCases', () => {
  it('dựng đủ sáu biến thể bậc 1 cho mỗi truy vấn', () => {
    const [truong_hop] = buildCases(['cafe']);
    expect(Object.keys(truong_hop?.sql ?? {})).toEqual([
      'full',
      'no_matched_alt',
      'no_distance',
      'no_like',
      'no_percent',
      'chi_wordsim',
      // 'cafe' chỉ một token nên không có bậc 2; bậc 3 luôn có vì viKey không rỗng.
      'bac3_name_key',
    ]);
  });

  /**
   * Giá trị của script nằm ở chỗ câu nó đo GIỐNG câu production. Một truy vấn có nameCore hoặc
   * biến thể địa danh khác queryNorm sẽ làm builder thật sinh thêm nhánh mà bản dựng ở đây không
   * có — đo nó ra số đẹp rồi kết luận thì sai. Thà ném.
   */
  it('từ chối truy vấn không rút gọn được về dạng đã biết', () => {
    // nameCore bỏ tiền tố đệm nên "phuc long coffee" → core "phuc long" ≠ norm.
    expect(() => buildCases(['phuc long coffee'])).toThrow(/không rút gọn được/);
  });

  it('truy vấn ≤ 12 ký tự có nhánh `%`, dài hơn thì không', () => {
    const [ngan] = buildCases(['cafe']);
    const [dai] = buildCases(['truong tieu hoc hoa binh']);
    expect(ngan?.sql.full).toContain("name_norm % 'cafe'");
    expect(dai?.sql.full).not.toContain('name_norm %');
  });

  it('bậc 2 chỉ có khi ≥ 2 token; bậc 3 luôn có', () => {
    expect(Object.keys(buildCases(['cafe'])[0]?.sql ?? {})).not.toContain('bac2_tsvector');
    const nhieu_token = Object.keys(buildCases(['ben thanh'])[0]?.sql ?? {});
    expect(nhieu_token).toContain('bac2_tsvector');
    expect(nhieu_token).toContain('bac3_name_key');
  });

  it('biến thể bỏ đúng thành phần cần bỏ', () => {
    const sql = buildCases(['cafe'])[0]?.sql ?? {};
    expect(sql.full).toContain('ST_DistanceSphere');
    expect(sql.no_distance).not.toContain('ST_DistanceSphere');
    expect(sql.full).toContain('unnest(name_alt');
    expect(sql.no_matched_alt).not.toContain('unnest(name_alt');
    expect(sql.full).toContain('LIKE');
    expect(sql.no_like).not.toContain('LIKE');
    expect(sql.no_percent).not.toContain('name_norm %');
    // Chỉ còn đúng một điều kiện KHỚP; phần SELECT giữ nguyên để cột trả về không đổi.
    expect(sql.chi_wordsim).toContain("AND ('cafe' <% name_norm)");
    expect(sql.chi_wordsim).not.toContain("'cafe' <% name_alt_norm");
    expect(sql.chi_wordsim).toContain("word_similarity('cafe', coalesce(name_alt_norm, ''))");
  });

  it('escape dấu nháy đơn trong truy vấn', () => {
    const sql = buildCases(["o'brien"])[0]?.sql ?? {};
    expect(sql.full).toContain("''");
  });
});

describe('parseArgs', () => {
  it('không có --q thì dùng bộ mặc định', () => {
    expect(parseArgs([]).queries).toEqual(['qu', 'cafe', 'ben thanh', 'truong tieu hoc']);
    expect(parseArgs([]).plan).toBe(false);
  });

  it('gom nhiều --q và nhận --plan', () => {
    const { queries, plan } = parseArgs(['--q', 'cafe', '--plan', '--q', 'ben thanh']);
    expect(queries).toEqual(['cafe', 'ben thanh']);
    expect(plan).toBe(true);
  });

  it('--q thiếu giá trị thì ném', () => {
    expect(() => parseArgs(['--q'])).toThrow(/--q thiếu giá trị/);
  });
});

describe('timesOf', () => {
  it('đọc Execution/Planning Time từ EXPLAIN FORMAT JSON', () => {
    expect(
      timesOf([{ 'Execution Time': 1234.5, 'Planning Time': 2.5, Plan: { 'Actual Rows': 20 } }]),
    ).toEqual({ exec: 1234.5, plan: 2.5, rows: 20 });
  });
});
