import { describe, expect, it } from 'vitest';
import {
  type CandidateQueryInput,
  collectCandidates,
  poiCandidates,
  streetCandidates,
} from '../src/autocomplete-sql';
import { fakeSql } from './helpers/fake-sql';

/** 16 ký tự — dài hơn SIMILARITY_MAX_QUERY_LENGTH nên KHÔNG có nhánh `%`. */
const input: CandidateQueryInput = {
  queryNorm: 'coffee highlands',
  queryCore: 'coffee highlands',
  prefixPattern: 'coffee highlands%',
  near: null,
  parsed: { alleyChain: [], confidence: 0 },
  sources: ['osm', 'overture', 'fsq'],
  queryAlias: 'coffee highlands',
  tsQuery: null,
  queryKey: '',
};

/** 7 ký tự — đủ ngắn để có thêm nhánh `%`. */
const shortInput: CandidateQueryInput = {
  ...input,
  queryNorm: 'higland',
  queryCore: 'higland',
  // Phải ghi đè cùng queryNorm: từ điển địa danh không đổi 'higland', nên queryAlias === queryNorm
  // và nhánh alias KHÔNG được bật — nếu quên, mọi phép đếm nhánh `<% name_norm` lệch 1.
  queryAlias: 'higland',
  prefixPattern: 'higland%',
};

describe('autocomplete-sql — bậc 1 dùng word_similarity (spec 05/09 mục 5.3)', () => {
  // Giữ CẢ HAI toán tử: `<%` bắt được cụm nằm giữa tên dài và đảo từ; `%` (ngưỡng 0,3) vẫn cần
  // cho lỗi gõ trên TỪ NGẮN, nơi word_similarity tụt dưới mọi ngưỡng hợp lý — đo 05/09 trên
  // production: higland↔highlands 0,455 và cirlce k↔circle k 0,385, trượt ở cả 0,5 lẫn 0,6.
  it('poi truy vấn NGẮN: đủ ba nhánh <% , % và LIKE tiền tố', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, shortInput);
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    // Tham số đầu ($1) nằm trong word_similarity() của SELECT; WHERE dùng $n sau đó.
    expect(query?.text).toMatch(/\$\d+ <% name_norm/);
    expect(query?.text).toMatch(/name_norm % \$\d+/);
    expect(query?.text).toMatch(/name_norm LIKE \$\d+/);
    expect(query?.text).toContain('word_similarity(');
    expect(query?.text).toContain('similarity(name_norm,');
    expect(query?.text).toContain('ORDER BY sim DESC, pop DESC');
    expect(query?.params).toEqual(expect.arrayContaining(['higland', 'higland%']));
  });

  // Chi phí nhánh `%` tăng theo số trigram: đo production 05/09 cho 'phuc long coffee' (16 ký tự)
  // là 1355 ms so với 196 ms khi không có nó. Truy vấn dài đã được `<%` phục vụ tốt.
  it('poi truy vấn DÀI: bỏ nhánh % để không trả giá độ trễ', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, input); // 16 ký tự
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toMatch(/\$\d+ <% name_norm/);
    expect(query?.text).not.toMatch(/name_norm % \$\d+/);
    expect(query?.text).toMatch(/name_norm LIKE \$\d+/);
  });

  it('poi: nameCore trùng normalizeVi thì KHÔNG sinh nhánh core thừa', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, shortInput); // queryCore === queryNorm
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text.match(/<% name_norm/g)).toHaveLength(1);
    expect(query?.text.match(/name_norm % \$\d+/g)).toHaveLength(1);
  });

  it('poi: nameCore khác normalizeVi thì thêm nhánh cho core', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, {
      ...input,
      queryNorm: 'ca phe cong',
      queryCore: 'cong',
      queryAlias: 'ca phe cong',
      prefixPattern: 'ca phe cong%',
    });
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text.match(/<% name_norm/g)).toHaveLength(2);
    expect(query?.text.match(/name_norm % \$\d+/g)).toHaveLength(2);
    expect(query?.params).toEqual(expect.arrayContaining(['ca phe cong', 'cong']));
  });

  it('poi: lọc theo sources với alias p, giữ POI người dùng', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, { ...shortInput, sources: ['osm', 'fsq'] });
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toContain('FROM poi p');
    expect(query?.text).toMatch(
      /p\.primary_source = ANY\(ARRAY\(SELECT json_array_elements_text\(\$\d+::text::json\)\)\) OR p\.created_by = 'user'/,
    );
    expect(query?.params).toEqual(expect.arrayContaining(['["osm","fsq"]']));
  });

  it('street: truy vấn ngắn có nhánh %, truy vấn dài thì không', async () => {
    const { sql: sqlShort, calls: callsShort } = fakeSql([]);
    await streetCandidates(sqlShort, shortInput);
    const short = callsShort.filter((call) => call.text.startsWith('SELECT'))[0];
    expect(short?.text).toMatch(/\$\d+ <% name_norm/);
    expect(short?.text).toMatch(/name_norm % \$\d+/);
    expect(short?.text).toMatch(/name_norm LIKE \$\d+/);

    const { sql: sqlLong, calls: callsLong } = fakeSql([]);
    await streetCandidates(sqlLong, input);
    const long = callsLong.filter((call) => call.text.startsWith('SELECT'))[0];
    expect(long?.text).not.toMatch(/name_norm % \$\d+/);
  });

  it('collectCandidates: chạy song song các loại được chọn, bỏ address khi không có số nhà', async () => {
    // Mỗi truy vấn phải trả dòng KHÁC nhau: collectCandidates khử trùng theo (type, id) và lùi về
    // (tên, phụ đề) cho dòng không id, nên hai dòng giả giống hệt sẽ bị gộp và test đo sai thứ.
    const { sql, calls } = fakeSql((q) => [
      { type: q.text.includes('FROM street') ? 'street' : 'poi', name: 'x' },
    ]);
    const result = await collectCandidates(sql, input, new Set(['poi', 'street', 'address']));
    const selects = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(selects).toHaveLength(2); // poi + street; address bị bỏ vì parsed không có housenumber
    expect(result).toHaveLength(2); // mỗi truy vấn trả 1 dòng giả
  });

  it('collectCandidates: có số nhà + đường thì thêm truy vấn address', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(
      sql,
      {
        ...input,
        parsed: {
          alleyChain: [],
          confidence: 0.6,
          housenumber: '88',
          street: 'Nguyễn Lâm',
          streetNorm: 'nguyen lam',
        },
      },
      new Set(['address']),
    );
    const selects = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(selects).toHaveLength(1);
    expect(selects[0]?.text).toContain('FROM address_anchor');
    expect(selects[0]?.text).toMatch(/\$\d+ <% street_norm/);
    expect(selects[0]?.text).toMatch(/street_norm % \$\d+/);
  });

  it('collectCandidates: default có area; explicit poi,street không query area', async () => {
    const withArea = fakeSql([]);
    await collectCandidates(withArea.sql, input, new Set(['poi', 'street', 'address', 'area']));
    expect(withArea.calls.some((call) => call.text.includes('FROM admin_area a'))).toBe(true);

    const oldTypes = fakeSql([]);
    await collectCandidates(oldTypes.sql, input, new Set(['poi', 'street']));
    expect(oldTypes.calls.some((call) => call.text.includes('FROM admin_area a'))).toBe(false);
  });
});

describe('autocomplete-sql — biến thể địa danh và tên thay thế OSM (spec 6.1, 6.3)', () => {
  it('bậc 1 POI: có nhánh name_alt_norm và matched_alt lấy tên gốc thẳng hàng', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, {
      ...input,
      queryNorm: 'cong ly',
      queryCore: 'cong ly',
      queryAlias: 'cong ly',
      prefixPattern: 'cong ly%',
    });
    const q = calls.filter((call) => call.text.startsWith('SELECT'))[0]?.text ?? '';
    expect(q).toMatch(/<% name_alt_norm/);
    expect(q).toMatch(/unnest\(name_alt, string_to_array\(name_alt_norm, ' \| '\)\)/);
    expect(q).toMatch(/AS matched_alt/);
  });

  it('bậc 1 POI: queryAlias khác queryNorm thì thêm nhánh qAlias <% name_norm; bằng thì không', async () => {
    const a = fakeSql([]);
    await poiCandidates(a.sql, {
      ...input,
      queryNorm: 'qui nhon',
      queryCore: 'qui nhon',
      queryAlias: 'quy nhon',
      prefixPattern: 'qui nhon%',
    });
    const b = fakeSql([]);
    await poiCandidates(b.sql, {
      ...input,
      queryNorm: 'quy nhon',
      queryCore: 'quy nhon',
      queryAlias: 'quy nhon',
      prefixPattern: 'quy nhon%',
    });
    // Đếm NHÁNH, không đếm tham số: khi queryNorm chính là 'quy nhon' thì chuỗi đó bị bind ở mọi
    // nhánh (word_similarity, similarity, starts_with, matched_alt…), nên phép đếm tham số đo sai thứ.
    const branches = (calls: typeof a.calls) =>
      calls.filter((c) => c.text.startsWith('SELECT'))[0]?.text.match(/<% name_norm/g)?.length ?? 0;
    expect(branches(a.calls)).toBe(branches(b.calls) + 1);
    // Và dạng chuẩn phải thật sự được bind ở ca a (nếu không thì nhánh chỉ là chữ, không có dữ liệu).
    const paramsA =
      a.calls.filter((c) => c.text.startsWith('SELECT'))[0]?.params.filter((p) => p === 'quy nhon')
        .length ?? 0;
    expect(paramsA).toBe(1);
  });

  it('bậc 1 street: cũng có name_alt_norm và matched_alt', async () => {
    const { sql, calls } = fakeSql([]);
    await streetCandidates(sql, {
      ...input,
      queryNorm: 'cong ly',
      queryCore: 'cong ly',
      queryAlias: 'cong ly',
      prefixPattern: 'cong ly%',
    });
    const q = calls.filter((call) => call.text.startsWith('SELECT'))[0]?.text ?? '';
    expect(q).toMatch(/<% name_alt_norm/);
    expect(q).toMatch(/AS matched_alt/);
  });
});

const poiRow = (id: string, sim: number) => ({
  type: 'poi',
  id,
  name: `p${id}`,
  secondary: null,
  lat: 0,
  lng: 0,
  precision: null,
  sim,
  prefix: false,
  pop: 0,
  d: null,
});

describe('collectCandidates — bậc 2/3 luôn chạy song song (spec 5.4–5.5, sửa 08/09)', () => {
  it('bậc 1 đã đủ limit thì bậc 2/3 VẪN chạy — điều kiện cũ làm chúng chết trên production', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => poiRow(String(i), 0.9));
    const { sql, calls } = fakeSql(rows);
    await collectCandidates(
      sql,
      { ...input, tsQuery: 'a:* & b:*', queryKey: 'ab' },
      new Set(['poi']),
    );
    expect(calls.filter((c) => c.text.includes('name_tsv @@'))).toHaveLength(1);
    expect(calls.filter((c) => c.text.includes('<% name_key'))).toHaveLength(1);
  });

  it('mọi bậc phát truy vấn TRƯỚC khi chờ, tức chạy song song chứ không nối đuôi', async () => {
    let resolveStage1 = (_: unknown[]) => {};
    const pending = new Promise<unknown[]>((r) => {
      resolveStage1 = r;
    });
    const { sql, calls } = fakeSql((q) =>
      q.text.includes('FROM poi p') && !q.text.includes('name_tsv') && !q.text.includes('name_key')
        ? pending
        : [],
    );
    const promise = collectCandidates(
      sql,
      { ...input, tsQuery: 'a:* & b:*', queryKey: 'ab' },
      new Set(['poi']),
    );
    // Bậc 1 còn treo, nhưng bậc 2 và 3 phải đã được phát đi rồi.
    expect(calls.some((c) => c.text.includes('name_tsv @@'))).toBe(true);
    expect(calls.some((c) => c.text.includes('<% name_key'))).toBe(true);
    resolveStage1([]);
    await promise;
  });

  it('chạy bậc 2 (tsvector) và bậc 3 (name_key), gắn stage và dedup theo id', async () => {
    // Phân biệt theo NỘI DUNG truy vấn, không theo thứ tự gọi: fakeSql gọi hàm rows cho mọi
    // fragment lồng nhau (matchedAlt, aliasBranch…), nên đếm lượt gọi là đo sai thứ.
    const { sql, calls } = fakeSql((q) =>
      q.text.includes('name_tsv @@') ? [poiRow('1', 0.5), poiRow('2', 0.5)] : [poiRow('1', 0.9)],
    );
    const rows = await collectCandidates(
      sql,
      { ...input, tsQuery: 'a:* & b:*', queryKey: 'ab' },
      new Set(['poi']),
    );
    expect(calls.some((c) => c.text.includes("to_tsquery('simple'"))).toBe(true);
    expect(calls.some((c) => c.text.includes('<% name_key'))).toBe(true);
    // id 1 giữ dòng của bậc 1, không bị bậc 2 chèn lại.
    expect(rows.map((r) => `${r.id}:${r.stage}`)).toEqual(['1:1', '2:2']);
  });

  it('bậc 1 thắng dedup: cùng id thì giữ dòng bậc 1, không để bậc 2/3 hạ bậc nó', async () => {
    const { sql } = fakeSql((q) =>
      q.text.includes('name_tsv @@') || q.text.includes('<% name_key')
        ? [poiRow('1', 0.99), poiRow('9', 0.5)]
        : [poiRow('1', 0.5)],
    );
    const rows = await collectCandidates(
      sql,
      { ...input, tsQuery: 'a:* & b:*', queryKey: 'ab' },
      new Set(['poi']),
    );
    const one = rows.find((r) => r.id === '1');
    expect(one?.stage).toBe(1);
    expect(one?.sim).toBe(0.5);
    // id 9 xuất hiện ở cả bậc 2 và bậc 3 → chỉ giữ một lần, gắn bậc SỚM hơn.
    expect(rows.filter((r) => r.id === '9')).toHaveLength(1);
    expect(rows.find((r) => r.id === '9')?.stage).toBe(2);
  });

  it('tsQuery null và queryKey rỗng → chỉ bậc 1, không truy vấn thêm', async () => {
    const { sql, calls } = fakeSql([poiRow('1', 0.9)]);
    await collectCandidates(sql, { ...input, tsQuery: null, queryKey: '' }, new Set(['poi']));
    expect(calls.filter((c) => c.text.startsWith('SELECT'))).toHaveLength(1);
  });
});
