import { describe, expect, it } from 'vitest';
import {
  areaCaseFor,
  buildCases,
  median,
  parseArgs,
  rankOf,
  timesOf,
  widestNode,
} from './explain-autocomplete.mjs';

describe('buildCases', () => {
  it('dựng đủ biến thể poi, bậc phụ và hai loại chạy song song', () => {
    const [truong_hop] = buildCases(['cafe']);
    expect(Object.keys(truong_hop?.sql ?? {})).toEqual([
      'full',
      'no_matched_alt',
      'no_distance',
      'no_like',
      'no_percent',
      'chi_wordsim',
      'chi_percent',
      'chi_like',
      // 'cafe' chỉ một token nên không có bậc 2; bậc 3 luôn có vì viKey không rỗng.
      'bac3_name_key',
      'street',
      'street_no_geom',
      'street_no_matched_alt',
      'street_no_sim',
      'street_nhanh',
      'area_prefix',
      'area_prefix_no_sim',
      'area_prefix_no_geom',
      'area_fuzzy',
      'nhanh_like',
      'nhanh_tsv',
    ]);
  });

  /**
   * Bậc nhanh phải cắt 200 dòng theo popularity TRƯỚC rồi mới tính sim — nếu `sim` còn nằm trong
   * ORDER BY của bước quét thì nó vẫn tính trigram cho mọi dòng khớp và chẳng nhanh hơn gì.
   */
  it('bậc nhanh cắt 200 theo popularity rồi mới tính sim', () => {
    const sql = buildCases(['cafe'])[0]?.sql ?? {};
    for (const bien_the of ['nhanh_like', 'nhanh_tsv']) {
      const text = sql[bien_the] ?? '';
      expect(text).toContain('ORDER BY coalesce(popularity, 0) DESC\n      LIMIT 200');
      const viTriCat = text.indexOf('LIMIT 200');
      expect(text.indexOf('word_similarity')).toBeGreaterThan(viTriCat);
    }
  });

  /** `tsQueryFor` của stages.ts bỏ truy vấn một token; bậc nhanh thì phải phục vụ được `cafe`. */
  it('nhanh_tsv nhận cả truy vấn một token', () => {
    expect(buildCases(['cafe'])[0]?.sql.nhanh_tsv).toContain("to_tsquery('simple', 'cafe:*')");
    expect(buildCases(['ben thanh'])[0]?.sql.nhanh_tsv).toContain(
      "to_tsquery('simple', 'ben:* & thanh:*')",
    );
  });

  /** Nhánh area đổi hình dạng khi có phần hành chính, nên phải chặn như chặn nameCore. */
  it('từ chối truy vấn có phần hành chính hoặc số nhà', () => {
    expect(() => buildCases(['quan 1'])).toThrow(/không rút gọn được|phần hành chính/);
    expect(() => buildCases(['12 nguyen hue'])).toThrow(/phần hành chính|không rút gọn được/);
  });

  it('biến thể area bỏ đúng thành phần cần bỏ', () => {
    const sql = buildCases(['cafe'])[0]?.sql ?? {};
    expect(sql.area_prefix).toContain('word_similarity(');
    expect(sql.area_prefix_no_sim).not.toContain('word_similarity(');
    expect(sql.area_prefix).toContain('ST_PointOnSurface');
    expect(sql.area_prefix_no_geom).not.toContain('ST_PointOnSurface');
    expect(sql.area_prefix_no_geom).not.toContain('ST_XMin');
    // Bỏ hình học KHÔNG được bỏ luôn sim, nếu không hai biến thể đo cùng một thứ.
    expect(sql.area_prefix_no_geom).toContain('word_similarity(');
  });

  it('area_prefix chỉ dùng LIKE, area_fuzzy thêm <% và khoá ngữ âm', () => {
    const sql = buildCases(['cafe'])[0]?.sql ?? {};
    expect(sql.area_prefix).toContain("a.name_norm LIKE 'cafe%'");
    expect(sql.area_prefix).not.toContain('<%');
    expect(sql.area_fuzzy).toContain("'cafe' <% a.name_norm");
    expect(sql.area_fuzzy).toContain('<% a.name_key');
  });

  it('biến thể chỉ-một-nhánh giữ đúng một điều kiện', () => {
    const sql = buildCases(['cafe'])[0]?.sql ?? {};
    expect(sql.chi_percent).toContain("AND (name_norm % 'cafe')");
    expect(sql.chi_percent).not.toContain("'cafe' <% name_norm");
    expect(sql.chi_like).toContain("AND (name_norm LIKE 'cafe%')");
    // `<%` còn trong subquery matched_alt của phần SELECT là ĐÚNG; chỉ mệnh đề WHERE được thu lại.
    expect(sql.chi_like).not.toContain("'cafe' <% name_norm");
    expect(sql.chi_like).not.toContain("'cafe' <% name_alt_norm");
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

  /** Mặc định phải là ngưỡng production ĐANG chạy (0,6), không phải giá trị migration đặt (0,5). */
  it('mặc định repeat=3, threshold=0.6, sweep tắt', () => {
    expect(parseArgs([])).toMatchObject({ repeat: 3, threshold: 0.6, sweep: false });
  });

  it('gom nhiều --q và nhận --plan/--sweep/--repeat/--threshold', () => {
    const args = parseArgs([
      '--q',
      'cafe',
      '--plan',
      '--q',
      'ben thanh',
      '--repeat',
      '5',
      '--threshold',
      '0.5',
      '--sweep',
    ]);
    expect(args.queries).toEqual(['cafe', 'ben thanh']);
    expect(args).toMatchObject({ plan: true, repeat: 5, threshold: 0.5, sweep: true });
  });

  it('cờ thiếu giá trị hoặc giá trị vô lý thì ném', () => {
    expect(() => parseArgs(['--q'])).toThrow(/--q thiếu giá trị/);
    expect(() => parseArgs(['--repeat'])).toThrow(/--repeat thiếu giá trị/);
    expect(() => parseArgs(['--repeat', '0'])).toThrow(/--repeat phải ≥ 1/);
    expect(() => parseArgs(['--threshold', '1.5'])).toThrow(/--threshold phải trong/);
  });
});

describe('widestNode', () => {
  /**
   * `LIMIT 20` làm nút gốc luôn 20 dòng; con số cần biết là chỗ rộng nhất, vì `sim` nằm trong
   * ORDER BY nên 4 hàm trigram chạy cho mọi dòng tới được nút đó.
   */
  it('tìm nút nhiều dòng nhất, không phải nút gốc', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Limit',
          'Actual Rows': 20,
          Plans: [
            {
              'Node Type': 'Sort',
              'Actual Rows': 48_000,
              Plans: [{ 'Node Type': 'Bitmap Heap Scan', 'Actual Rows': 51_200 }],
            },
          ],
        },
      },
    ];
    expect(widestNode(plan)).toEqual({ node: 'Bitmap Heap Scan', rows: 51_200 });
  });

  it('nhân với Actual Loops: subquery tương quan chạy lại mỗi dòng', () => {
    const plan = [
      {
        Plan: {
          'Node Type': 'Limit',
          'Actual Rows': 3,
          'Actual Loops': 1,
          Plans: [{ 'Node Type': 'Index Scan', 'Actual Rows': 2, 'Actual Loops': 900 }],
        },
      },
    ];
    expect(widestNode(plan)).toEqual({ node: 'Index Scan', rows: 1_800 });
  });

  it('kế hoạch rỗng không làm ném', () => {
    expect(widestNode(undefined)).toEqual({ node: '-', rows: 0 });
  });
});

describe('median', () => {
  it('lẻ lấy giữa, chẵn lấy trung bình hai giữa, rỗng trả 0', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('không bị một lần chạy lệch kéo đi như trung bình', () => {
    expect(median([100, 105, 110, 108, 9000])).toBe(108);
  });
});

describe('timesOf', () => {
  it('đọc Execution/Planning Time từ EXPLAIN FORMAT JSON', () => {
    expect(
      timesOf([{ 'Execution Time': 1234.5, 'Planning Time': 2.5, Plan: { 'Actual Rows': 20 } }]),
    ).toEqual({ exec: 1234.5, plan: 2.5, rows: 20 });
  });
});

describe('rankOf', () => {
  const rows = [{ name: 'Phở Hoà' }, { name: 'Highlands Coffee Nguyễn Huệ' }, { name: 'X' }];

  it('trả hạng 1-based của đích, so sau khi bỏ dấu và lowercase', () => {
    expect(rankOf(rows, ['highlands'])).toBe(2);
    expect(rankOf([{ name: 'Bệnh viện Chợ Rẫy' }], ['cho ray'])).toBe(1);
  });

  it('không có mặt thì trả 0 — đó mới là bằng chứng "bỏ nhánh này là MẤT kết quả"', () => {
    expect(rankOf(rows, ['circle k'])).toBe(0);
    expect(rankOf([], ['highlands'])).toBe(0);
  });

  it('nhiều cách viết được chấp nhận: trúng cái nào cũng tính', () => {
    expect(rankOf([{ name: 'Bơ Booth Đắc Lắc' }], ['dak lak', 'dac lac'])).toBe(1);
  });

  it('không có đích thì không chấm (trả 0), tránh báo trúng giả', () => {
    expect(rankOf(rows, [])).toBe(0);
  });
});

describe('areaCaseFor', () => {
  it('quận → khoá cấp 6, currentKey lấy theo tên đơn vị chứ không theo cả chuỗi', () => {
    expect(areaCaseFor('Quận 10')).toMatchObject({ q: 'quan 10', currentKey: '10', aliasLevel: 6 });
  });

  it('phường → khoá cấp 8', () => {
    expect(areaCaseFor('Phường Bàn Cờ')).toMatchObject({ currentKey: 'ban co', aliasLevel: 8 });
  });

  /**
   * Tỉnh SUY RA từ alias thì BỎ khoá cấp: `Bình Dương` được canonicalize thành TP Hồ Chí Minh,
   * mà alias `thu dau mot` chỉ tồn tại ở level 6 — giữ khoá cấp 4 là không bao giờ khớp.
   */
  it('tỉnh cũ suy từ alias → aliasLevel null, currentKey là nameCore', () => {
    expect(areaCaseFor('Bình Dương')).toMatchObject({ currentKey: 'binh duong', aliasLevel: null });
    expect(areaCaseFor('Thủ Dầu Một')).toMatchObject({ aliasLevel: null });
  });

  it('truy vấn thường → không khoá cấp', () => {
    expect(areaCaseFor('qu')).toMatchObject({ q: 'qu', currentKey: 'qu', aliasLevel: null });
  });
});

describe('rankOf kèm dòng phụ', () => {
  const rows = [{ name: 'Phường Bình Dương', secondary: 'Thành phố Hồ Chí Minh' }];

  it('nhánh area so cả secondary — 9 ca tỉnh cũ có đích nằm ở dòng phụ', () => {
    expect(rankOf(rows, ['ho chi minh'], true)).toBe(1);
  });

  it('mặc định KHÔNG so secondary, giữ nguyên hành vi cho nhánh poi', () => {
    expect(rankOf(rows, ['ho chi minh'])).toBe(0);
  });
});
