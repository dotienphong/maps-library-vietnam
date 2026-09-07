import { describe, expect, it } from 'vitest';
import { areaCandidates } from '../src/area-candidates';
import type { CandidateQueryInput } from '../src/autocomplete-sql';
import { type RecordedQuery, fakeSql } from './helpers/fake-sql';

const input: CandidateQueryInput = {
  queryNorm: 'quan 10',
  queryCore: '10',
  prefixPattern: 'quan 10%',
  near: null,
  sources: ['osm', 'overture', 'fsq'],
  parsed: { alleyChain: [], confidence: 0.2, district: '10' },
  queryAlias: 'quan 10',
  tsQuery: null,
  queryKey: 'quan10',
};

const areaQueries = (calls: RecordedQuery[]) =>
  calls.filter((call) => call.text.includes('current_hits AS'));

describe('areaCandidates', () => {
  it('tách current và alias thành hai nhánh indexed, UNION ALL rồi mới group/dedup/limit', async () => {
    const { sql, calls } = fakeSql([]);
    await areaCandidates(sql, input);
    const query = calls.find((call) => call.text.includes('current_hits AS'));
    expect(query?.text).toContain('current_hits AS');
    expect(query?.text).toContain('alias_edges AS');
    expect(query?.text).toContain('UNION ALL');
    expect(query?.text).toContain('GROUP BY');
    expect(query?.text).toContain('row_number() OVER');
    expect(query?.text).toMatch(/LIMIT \$\d+$/);
    expect(query?.text).toMatch(/a\.name_norm LIKE \$\d+/);
    expect(query?.text).toMatch(/aa\.alias_norm LIKE \$\d+/);
  });

  // Nghiệm thu 9.4 (07/09/2026) trên production: `Phường Bàn Cờ` KHÔNG trả về Phường Bàn Cờ
  // (top là Phường Cầu Ông Lãnh), còn `Bàn Cờ` thì trả đúng hạng 1 score 0,801. Gốc rễ:
  // `NAME_FILLERS` có 'quan' nhưng KHÔNG có 'phuong'/'xa'/'thi tran', nên
  // nameCore('Phường Bàn Cờ') = 'phuong ban co' và `admin_area.name_norm LIKE 'phuong ban co%'`
  // không khớp gì vì name_norm lưu 'ban co'. Bậc 2 fuzzy cũng không cứu được tên phường ngắn:
  // word_similarity('phuong ban co','ban co') bị pha loãng dưới ngưỡng 0,5.
  // `parseAddress` đã tách sẵn tên đúng (`ward: 'Bàn Cờ'`), nên nhánh current phải dùng nó.
  it('nhánh current khớp theo tên đơn vị đã tách của parseAddress, không theo queryCore còn tiền tố', async () => {
    const { sql, calls } = fakeSql([]);
    await areaCandidates(sql, {
      ...input,
      queryNorm: 'phuong ban co',
      queryCore: 'phuong ban co',
      prefixPattern: 'phuong ban co%',
      parsed: { alleyChain: [], confidence: 0.2, ward: 'Bàn Cờ' },
    });
    const query = areaQueries(calls)[0];
    // Hai nhánh dùng hai khoá KHÁC nhau: current khớp `admin_area.name_norm` (không có tiền tố)
    // nên phải là 'ban co%'; alias khớp `admin_alias.alias_norm` (CÓ tiền tố) nên giữ nguyên
    // 'phuong ban co%'. Trước bản sửa, cả hai đều là 'phuong ban co%' và nhánh current trắng tay.
    expect(query?.params).toContain('ban co%');
    expect(query?.params).toContain('phuong ban co%');
    // Điểm và cờ prefix của nhánh current cũng phải tính trên khoá đã bỏ tiền tố.
    expect(query?.params.filter((value) => value === 'ban co')).not.toHaveLength(0);
  });

  it('truy vấn POI không có đơn vị hành chính thì vẫn dùng queryCore như trước', async () => {
    const { sql, calls } = fakeSql([]);
    await areaCandidates(sql, {
      ...input,
      queryNorm: 'highlands',
      queryCore: 'highlands',
      prefixPattern: 'highlands%',
      parsed: { alleyChain: [], confidence: 0.2 },
    });
    expect(areaQueries(calls)[0]?.params).toContain('highlands%');
  });

  // Cổng 6.5 đo trên 36.456 alias toàn quốc: gộp `<%` vào bậc 1 làm `quan 10` khớp 11.072 dòng
  // (61 ms) và `tan thanh` khớp 6.383 dòng (70 ms), vì word_similarity bắt mọi alias chứa từ
  // hành chính phổ biến. Prefix cho đúng 18 và 10 dòng (0,09 và 0,06 ms).
  it('bậc 1 chỉ dùng tiền tố, không dùng <%', async () => {
    const { sql, calls } = fakeSql([{ type: 'area' }]);
    await areaCandidates(sql, input);
    const queries = areaQueries(calls);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).not.toContain('<%');
    expect(queries[0]?.text).toMatch(/a\.name_norm LIKE \$\d+/);
    expect(queries[0]?.text).toMatch(/aa\.alias_norm LIKE \$\d+/);
  });

  it('bậc 1 có kết quả thì không chạy bậc 2', async () => {
    const { sql, calls } = fakeSql([{ type: 'area' }, { type: 'area' }]);
    await areaCandidates(sql, input);
    expect(areaQueries(calls)).toHaveLength(1);
  });

  // Smoke 9.4 trên production: "Thủ Dầu Một" là thành phố cấp huyện cũ, nhưng nó nằm trong alias
  // tỉnh của provinces.json nên parseAddress canonicalize thành "Thành phố Hồ Chí Minh" và
  // aliasLevel thành 4 — trong khi alias `thu dau mot` chỉ tồn tại ở level 6, nên không ra gì.
  // Khi tỉnh được suy ra từ alias thì không khoá cấp nữa.
  it('tỉnh suy từ alias thì không khoá cấp alias', async () => {
    const { sql, calls } = fakeSql([{ type: 'area' }]);
    await areaCandidates(sql, {
      queryNorm: 'thu dau mot',
      queryAlias: 'thu dau mot',
      tsQuery: null,
      queryKey: '',
      queryCore: 'thu dau mot',
      prefixPattern: 'thu dau mot%',
      near: null,
      sources: ['osm', 'overture', 'fsq'],
      parsed: {
        alleyChain: [],
        confidence: 0.2,
        province: 'Thành phố Hồ Chí Minh',
        adminOriginal: { province: 'Thủ Dầu Một' },
      },
    });
    const [query] = areaQueries(calls);
    expect(query?.text).not.toMatch(/aa\.level=\$\d+/);
    expect(query?.text).not.toMatch(/a\.level=\$\d+/);
  });

  it('tỉnh gõ đúng tên canonical thì vẫn khoá cấp 4', async () => {
    const { sql, calls } = fakeSql([{ type: 'area' }]);
    await areaCandidates(sql, {
      queryNorm: 'thanh pho ho chi minh',
      queryAlias: 'thanh pho ho chi minh',
      tsQuery: null,
      queryKey: '',
      queryCore: 'ho chi minh',
      prefixPattern: 'thanh pho ho chi minh%',
      near: null,
      sources: ['osm', 'overture', 'fsq'],
      parsed: {
        alleyChain: [],
        confidence: 0.2,
        province: 'Thành phố Hồ Chí Minh',
        adminOriginal: { province: 'Thành phố Hồ Chí Minh' },
      },
    });
    const [query] = areaQueries(calls);
    expect(query?.text).toMatch(/aa\.level=\$\d+/);
  });

  // `<%` vẫn phải giữ vì nó là thứ duy nhất cứu được lỗi gõ: đo trên DB toàn quốc,
  // `quna 10` cho 0 hit tiền tố nhưng 12 hit fuzzy.
  it('bậc 1 rỗng thì leo lên bậc 2 có <% và trả kết quả bậc 2', async () => {
    const rescued = { type: 'area', name: 'Quận 10' };
    const { sql, calls } = fakeSql((query) => (query.text.includes('<%') ? [rescued] : []));
    await expect(areaCandidates(sql, input)).resolves.toEqual([rescued]);
    const queries = areaQueries(calls);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.text).toMatch(/\$\d+ <% a\.name_norm/);
    expect(queries[1]?.text).toMatch(/\$\d+ <% aa\.alias_norm/);
    expect(queries[1]?.text).toMatch(/a\.name_norm LIKE \$\d+/);
    expect(queries[1]?.text).toMatch(/aa\.alias_norm LIKE \$\d+/);
  });

  it('giữ một quận cũ, tối đa ba tên đích và bbox', async () => {
    const row = {
      type: 'area',
      id: null,
      name: 'Quận 10',
      secondary: 'Diên Hồng, Hòa Hưng, Vườn Lài, …',
      lat: 10.77,
      lng: 106.67,
      precision: 'district',
      sim: 1,
      prefix: true,
      pop: 0,
      d: null,
      bbox: [106.65, 10.75, 106.68, 10.79],
    } as const;
    const { sql } = fakeSql([row]);
    await expect(areaCandidates(sql, input)).resolves.toEqual([row]);
    expect(row.secondary.split(', ')).toHaveLength(4);
  });
});

describe('bậc 3 khoá ngữ âm trong nhánh vùng (spec 6.2)', () => {
  // areaCandidates chạy bậc 1 (tiền tố) trước; fakeSql([]) làm nó rỗng nên bậc 2 fuzzy mới chạy.
  // Nhánh khoá chỉ có ở truy vấn fuzzy, tức truy vấn THỨ HAI.
  const fuzzyQuery = (calls: RecordedQuery[]) => areaQueries(calls)[1];

  it('fuzzy có queryKey → thêm nhánh name_key và alias_key', async () => {
    const { sql, calls } = fakeSql([]);
    await areaCandidates(sql, { ...input, queryNorm: 'quna 10', queryKey: 'quan10' });
    expect(areaQueries(calls)).toHaveLength(2);
    expect(fuzzyQuery(calls)?.text).toMatch(/<% a\.name_key/);
    expect(fuzzyQuery(calls)?.text).toMatch(/<% aa\.alias_key/);
    // Bậc 1 tiền tố KHÔNG được có nhánh khoá — đó là chỗ đã phải bỏ `<%` vì kém chọn lọc.
    expect(areaQueries(calls)[0]?.text).not.toMatch(/name_key/);
  });

  it('queryKey rỗng → KHÔNG có nhánh khoá (chuỗi rỗng <% khớp mọi dòng)', async () => {
    const { sql, calls } = fakeSql([]);
    await areaCandidates(sql, { ...input, queryNorm: 'quna 10', queryKey: '' });
    expect(fuzzyQuery(calls)?.text).not.toMatch(/name_key/);
    expect(fuzzyQuery(calls)?.text).not.toMatch(/alias_key/);
  });
});
