import { describe, expect, it } from 'vitest';
import {
  type CandidateQueryInput,
  collectCandidates,
  FAST_CANDIDATE_POOL,
  poiCandidates,
  poiFastCandidates,
  poiKeyCandidates,
  poiTokenCandidates,
  streetCandidates,
  streetFastCandidates,
} from '../src/autocomplete-sql';
import { COEFF, PREFIX_BONUS, PROX_SCALE_M } from '../src/ranking';
import { fakeSql } from './helpers/fake-sql';

/** 16 ký tự — dài hơn SIMILARITY_MAX_QUERY_LENGTH nên KHÔNG có nhánh `%`. */
const input: CandidateQueryInput = {
  queryNorm: 'coffee highlands',
  queryCore: 'coffee highlands',
  prefixPattern: 'coffee highlands%',
  near: null,
  parsed: { alleyChain: [], confidence: 0 },
  sources: ['osm', 'fsq'],
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
    // Và dạng chuẩn phải thật sự được bind ở ca a: 3 lần — trong `sim`, trong WHERE, và trong
    // `prefix`. Ca b không bind lần nào vì chuỗi trùng queryNorm.
    const paramsOf = (calls: typeof a.calls) =>
      calls.filter((c) => c.text.startsWith('SELECT'))[0]?.params.filter((p) => p === 'quy nhon')
        .length ?? 0;
    expect(paramsOf(a.calls)).toBe(3);
  });

  // Đây là thứ chặn `qui nhon` và `tan son nhut` khỏi top 3: dòng khớp qua nhánh alias bị chấm
  // điểm bằng CHUỖI GỐC. Đo trên production: 'Quy Nhơn' cho sim 0,636 theo 'qui nhon' nhưng 1,000
  // theo 'quy nhon'; vì ORDER BY dùng chính sim đó nên chúng còn bị LIMIT 20 cắt trước khi xếp hạng.
  it('bậc 1 POI: sim và prefix tính CẢ theo dạng chuẩn khi queryAlias khác queryNorm', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, {
      ...input,
      queryNorm: 'qui nhon',
      queryCore: 'qui nhon',
      queryAlias: 'quy nhon',
      prefixPattern: 'qui nhon%',
    });
    const q = calls.filter((c) => c.text.startsWith('SELECT'))[0];
    // Đếm vế, không đọc số hiệu $n: fakeSql không đánh lại số cho fragment lồng nhau, nên số hiệu
    // trong bản giả không phản ánh SQL thật. Ba vế word_similarity(_, name_norm) = queryNorm,
    // queryCore, và dạng chuẩn.
    expect(q?.text.match(/word_similarity\(\$\d+, name_norm\)/g)).toHaveLength(3);
    expect(q?.text).toMatch(/starts_with\(name_norm, \$\d+\) OR starts_with\(name_norm, \$\d+\)/);
    expect(q?.params).toContain('quy nhon');
  });

  it('bậc 1 POI: queryAlias bằng queryNorm thì KHÔNG sinh biểu thức thừa', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, {
      ...input,
      queryNorm: 'quy nhon',
      queryCore: 'quy nhon',
      queryAlias: 'quy nhon',
      prefixPattern: 'quy nhon%',
    });
    const q = calls.filter((c) => c.text.startsWith('SELECT'))[0];
    expect(q?.text.match(/word_similarity\(\$\d+, name_norm\)/g)).toHaveLength(2);
    expect(q?.text).not.toMatch(/starts_with\(name_norm, \$\d+\) OR starts_with/);
  });

  it('bậc 1 street: sim cũng tính theo dạng chuẩn', async () => {
    const { sql, calls } = fakeSql([]);
    await streetCandidates(sql, {
      ...input,
      queryNorm: 'qui nhon',
      queryCore: 'qui nhon',
      queryAlias: 'quy nhon',
      prefixPattern: 'qui nhon%',
    });
    const q = calls.filter((c) => c.text.startsWith('SELECT'))[0];
    // street có 2 vế word_similarity(_, name_norm) khi không alias (queryNorm, và vế alt dùng cột
    // khác nên không tính), thành 2 khi có alias — đếm vế alias bằng cách so với ca không alias.
    expect(q?.text.match(/word_similarity\(\$\d+, name_norm\)/g)).toHaveLength(2);
    expect(q?.params).toContain('quy nhon');
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

describe('autocomplete-sql — secondary dùng hành chính hiện hành suy từ toạ độ (13/09/2026)', () => {
  const SECONDARY =
    "concat_ws(', ', street, coalesce(admin_ward, ward), coalesce(admin_province, province)) AS secondary";
  it('cả ba bậc POI dùng chung một biểu thức secondary, không còn đọc thẳng cột nguồn', async () => {
    for (const fn of [poiCandidates, poiTokenCandidates, poiKeyCandidates]) {
      const { sql, calls } = fakeSql([]);
      await fn(sql, { ...input, tsQuery: 'coffee & highlands', queryKey: 'kofi hailan' });
      const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
      expect(query?.text).toContain(SECONDARY);
      expect(query?.text).not.toContain("concat_ws(', ', street, ward, province)");
    }
  });
});

const fastInput: CandidateQueryInput = {
  queryNorm: 'ben thanh',
  queryCore: 'ben thanh',
  prefixPattern: 'ben thanh%',
  near: { lat: 10.776, lng: 106.7 },
  parsed: { alleyChain: [], confidence: 0 },
  sources: ['osm', 'fsq'],
  queryAlias: 'ben thanh',
  tsQuery: 'ben:* & thanh:*',
  queryKey: 'benthan',
};

describe('poiFastCandidates — bậc nhanh', () => {
  /** `poiSourceFilter` dựng một fragment con trước, nên `calls[0]` KHÔNG phải câu chính. */
  const cauChinh = (calls: { text: string; params: unknown[] }[]) =>
    calls.find((call) => call.text.startsWith('WITH'));

  /**
   * Mấu chốt của cả bậc nhanh: CẮT trước, tính `sim` sau. Nếu `sim` lọt vào ORDER BY của bước quét
   * thì Postgres tính 4 hàm trigram cho mọi dòng khớp (18.269–29.107 dòng đo trên production) và
   * bậc nhanh không còn nhanh. Test này khoá đúng thứ tự đó.
   */
  it('cắt (tên bắt đầu bằng truy vấn trước, rồi popularity) TRƯỚC rồi mới tính sim', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const call = cauChinh(calls);
    const text = call?.text ?? '';
    const viTriCat = text.search(
      /ORDER BY starts_with\(name_norm, \$\d+\) DESC, coalesce\(popularity, 0\) DESC LIMIT \$/,
    );
    expect(viTriCat).toBeGreaterThan(-1);
    expect(text.indexOf('word_similarity')).toBeGreaterThan(viTriCat);
    // starts_with là so chuỗi, không phải hàm trigram: bể vẫn cắt rẻ như trước.
    expect(text.slice(0, viTriCat)).not.toContain('similarity(');
    // starts_with trong bể nhận ĐÚNG queryNorm (lấy chỉ số tham số, không chỉ "có trong params").
    const n = Number(/starts_with\(name_norm, \$(\d+)\) DESC, coalesce/.exec(text)?.[1]);
    expect(call?.params[n - 1]).toBe(fastInput.queryNorm);
  });

  /**
   * Cắt 20 dòng cuối phải theo đúng các vế của rankScore (sim + thưởng tiền tố + gần): chỉ theo
   * `prefix` thì POI gần tên "Chợ + truy vấn" bị các tên bắt đầu bằng truy vấn ở xa đẩy ra; chỉ theo
   * `pop` thì POI trùng tên một nguồn bị đẩy ra. `pop` chỉ còn để phá hoà.
   */
  it('cắt 20 dòng cuối theo sim + thưởng tiền tố + gần, pop chỉ phá hoà', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const text = cauChinh(calls)?.text ?? '';
    const cuoi = text.slice(text.lastIndexOf('ORDER BY'));
    expect(cuoi).toMatch(/CASE WHEN prefix THEN/);
    expect(cuoi).toMatch(/exp\(-d \/ /);
    expect(cuoi).toMatch(/DESC, pop DESC\s+LIMIT 20/);
    const params = cauChinh(calls)?.params ?? [];
    for (const value of [COEFF.sim, COEFF.prox, PREFIX_BONUS, PROX_SCALE_M])
      expect(params).toContain(value);
  });

  it('lọc bằng name_tsv, WHERE không có toán tử trigram lẫn LIKE', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const text = cauChinh(calls)?.text ?? '';
    expect(text).toContain("name_tsv @@ to_tsquery('simple', $");
    const where = text.slice(text.indexOf('WHERE'), text.indexOf('ORDER BY'));
    expect(where).not.toContain('<%');
    expect(where).not.toContain('LIKE');
  });

  it('giữ nguyên bộ lọc trạng thái và nguồn như bậc 1', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const text = cauChinh(calls)?.text ?? '';
    expect(text).toContain("status = 'active'");
    expect(text).toContain('p.primary_source = ANY(');
    expect(text).toContain("p.created_by = 'user'");
  });

  it('gửi tsQuery và kích thước bể ứng viên làm tham số', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    expect(cauChinh(calls)?.params).toContain('ben:* & thanh:*');
    expect(cauChinh(calls)?.params).toContain(FAST_CANDIDATE_POOL);
  });

  /**
   * Bậc 1 chấm điểm theo CẢ queryCore (`word_similarity(queryCore, name_norm)`). Thiếu vế đó thì
   * `bhx` tìm ra "Bách Hoá Xanh" nhưng chấm điểm như thể không khớp, rồi rơi ngoài top 3.
   */
  it('sim gồm cả queryCore khi nó khác queryNorm', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(
      sql,
      { ...fastInput, queryNorm: 'bhx', queryCore: 'bach hoa xanh' },
      'x:*',
    );
    const params = cauChinh(calls)?.params ?? [];
    expect(params).toContain('bach hoa xanh');
    expect(params.filter((value) => value === 'bhx').length).toBeGreaterThan(0);
  });

  it('queryCore trùng queryNorm thì không thêm vế sim thừa', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const text = cauChinh(calls)?.text ?? '';
    expect((text.match(/word_similarity\(/g) ?? []).length).toBe(2);
  });

  it('không có near thì d là NULL, không gọi ST_DistanceSphere', async () => {
    const { sql, calls } = fakeSql([]);
    await poiFastCandidates(sql, { ...fastInput, near: null }, 'ben:*');
    expect(cauChinh(calls)?.text).toContain('NULL::float8 AS d');
    expect(cauChinh(calls)?.text).not.toContain('ST_DistanceSphere');
  });
});

describe('collectCandidates — cổng bậc nhanh', () => {
  const fastRow = (i: number) => ({
    type: 'poi',
    id: `p${i}`,
    name: `POI ${i}`,
    secondary: '',
    lat: 10,
    lng: 106,
    precision: null,
    sim: 0.9,
    prefix: true,
    pop: 1,
    d: null,
  });
  /** fakeSql trả cùng một mảng cho MỌI truy vấn, nên phải phân biệt theo nội dung câu. */
  const chiBacNhanh = (soDong: number) => (query: { text: string }) =>
    query.text.startsWith('WITH') ? Array.from({ length: soDong }, (_, i) => fastRow(i)) : [];
  const laTrigram = (call: { text: string }) => call.text.includes('<% name_norm');

  it('bậc nhanh đủ limit thì KHÔNG chạy nhánh trigram nào', async () => {
    const { sql, calls } = fakeSql(chiBacNhanh(10));
    const rows = await collectCandidates(sql, input, new Set(['poi']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(rows).toHaveLength(10);
    expect(calls.filter(laTrigram)).toHaveLength(0);
  });

  it('bậc nhanh thiếu limit thì chạy tiếp đường cũ', async () => {
    const { sql, calls } = fakeSql(chiBacNhanh(1));
    await collectCandidates(sql, input, new Set(['poi']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(calls.filter(laTrigram).length).toBeGreaterThan(0);
  });

  it('không truyền cổng thì hành vi y như trước', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, input, new Set(['poi']));
    expect(calls.filter((call) => call.text.startsWith('WITH'))).toHaveLength(0);
    expect(calls.filter(laTrigram).length).toBeGreaterThan(0);
  });

  it('tsQuery null thì bỏ qua bậc nhanh', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, input, new Set(['poi']), { tsQuery: null, limit: 10 });
    expect(calls.filter((call) => call.text.startsWith('WITH'))).toHaveLength(0);
  });

  it('dòng bậc nhanh mang stage 1 nên không bị STAGE_PENALTY', async () => {
    const { sql } = fakeSql(chiBacNhanh(10));
    const rows = await collectCandidates(sql, input, new Set(['poi']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(rows.every((row) => row.stage === 1)).toBe(true);
  });

  /**
   * Bậc nhanh CHỈ thay nhánh POI. Trả sớm chỉ với dòng POI là làm biến mất street/area khỏi kết
   * quả — `types=area` sẽ trả rỗng. Lỗi này bắt được lúc soát plan trước khi thực hiện.
   */
  it('đi đường nhanh vẫn chạy street và area', async () => {
    const { sql, calls } = fakeSql(chiBacNhanh(10));
    await collectCandidates(sql, input, new Set(['poi', 'street', 'area']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(calls.filter((call) => call.text.includes("'street' AS type"))).toHaveLength(1);
    expect(calls.filter((call) => call.text.includes('admin_alias')).length).toBeGreaterThan(0);
  });

  it('đi đường nhanh thì KHÔNG chạy bậc 2 và bậc 3', async () => {
    const { sql, calls } = fakeSql(chiBacNhanh(10));
    await collectCandidates(
      sql,
      { ...input, tsQuery: 'coffee:* & highlands:*', queryKey: 'coffeehighland' },
      new Set(['poi', 'street']),
      { tsQuery: 'coffee:* & highlands:*', limit: 10 },
    );
    // Bậc 3 là nhánh duy nhất đụng `name_key`; bậc 2 là nhánh duy nhất đụng `name_tsv @@` mà
    // KHÔNG nằm trong CTE bậc nhanh.
    expect(calls.filter((call) => call.text.includes('name_key'))).toHaveLength(0);
    const bac2 = calls.filter(
      (call) => call.text.includes('name_tsv @@') && !call.text.startsWith('WITH'),
    );
    expect(bac2).toHaveLength(0);
  });
});

describe('streetFastCandidates — bậc nhanh cho street', () => {
  const cauChinh = (calls: { text: string; params: unknown[] }[]) =>
    calls.find((call) => call.text.startsWith('WITH'));

  /**
   * `street` KHÔNG có `popularity`, nên tiêu chí cắt là KHOẢNG CÁCH — người gõ tên đường gần như
   * luôn muốn con đường gần mình. Dùng toán tử KNN `<->` chứ không `ST_DistanceSphere`: rẻ hơn hẳn
   * và đi được qua chỉ số GiST `street_geom_idx`.
   */
  it('cắt 200 dòng gần nhất bằng `<->` TRƯỚC rồi mới tính sim', async () => {
    const { sql, calls } = fakeSql([]);
    await streetFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const text = cauChinh(calls)?.text ?? '';
    const viTriCat = text.indexOf('ORDER BY geom <->');
    expect(viTriCat).toBeGreaterThan(-1);
    expect(text.indexOf('word_similarity')).toBeGreaterThan(viTriCat);
    expect(cauChinh(calls)?.params).toContain(FAST_CANDIDATE_POOL);
  });

  it('lọc bằng name_tsv, WHERE không có toán tử trigram lẫn LIKE', async () => {
    const { sql, calls } = fakeSql([]);
    await streetFastCandidates(sql, fastInput, 'ben:* & thanh:*');
    const text = cauChinh(calls)?.text ?? '';
    expect(text).toContain("name_tsv @@ to_tsquery('simple', $");
    const where = text.slice(text.indexOf('WHERE'), text.indexOf('ORDER BY'));
    expect(where).not.toContain('<%');
    expect(where).not.toContain('LIKE');
  });
});

describe('collectCandidates — cổng bậc nhanh cho street', () => {
  const streetRow = {
    type: 'street',
    id: null,
    name: 'Đường X',
    secondary: '',
    lat: 10,
    lng: 106,
    precision: null,
    sim: 0.9,
    prefix: true,
    pop: 0,
    d: null,
  };
  const laStreetTrigram = (call: { text: string }) =>
    call.text.includes("'street' AS type") && !call.text.startsWith('WITH');

  it('street nhanh có kết quả thì KHÔNG chạy street trigram', async () => {
    const { sql, calls } = fakeSql((query) =>
      query.text.startsWith('WITH') && query.text.includes("'street' AS type") ? [streetRow] : [],
    );
    await collectCandidates(
      sql,
      { ...input, near: { lat: 10.776, lng: 106.7 } },
      new Set(['street']),
      {
        tsQuery: 'coffee:* & highlands:*',
        limit: 10,
      },
    );
    expect(calls.filter(laStreetTrigram)).toHaveLength(0);
  });

  /**
   * Đo production 18/09: `cafe` cho street_nhanh 0 dòng (tên đường không chứa từ "cafe") trong khi
   * nhánh trigram cho 8.914 dòng. Rỗng thì PHẢI lui về trigram, nếu không mất hẳn kết quả street
   * cho mọi truy vấn không trùng từ nào trong tên đường.
   */
  it('street nhanh rỗng thì lui về street trigram', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(
      sql,
      { ...input, near: { lat: 10.776, lng: 106.7 } },
      new Set(['street']),
      {
        tsQuery: 'coffee:* & highlands:*',
        limit: 10,
      },
    );
    expect(calls.filter(laStreetTrigram)).toHaveLength(1);
  });

  it('không có near thì không dùng bậc nhanh street (không có tiêu chí cắt)', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, { ...input, near: null }, new Set(['street']), {
      tsQuery: 'coffee:* & highlands:*',
      limit: 10,
    });
    expect(calls.filter((call) => call.text.startsWith('WITH'))).toHaveLength(0);
    expect(calls.filter(laStreetTrigram)).toHaveLength(1);
  });
});

/**
 * Đo production 18/09 (`--rank` + explain): tổng chi phí hai nhánh chạy RIÊNG luôn nhỏ hơn một
 * truy vấn `OR` gộp — `phuc lonh` 128+704=832 ms so với 1.561 ms, `cho rya` 17+215=232 so với 394.
 * `OR` buộc một Bitmap Heap Scan quét hợp các bitmap rồi recheck TOÀN BỘ biểu thức trên từng dòng;
 * tách ra thì mỗi truy vấn chỉ recheck điều kiện của nó và có LIMIT riêng.
 *
 * Tách chứ KHÔNG bỏ: `--rank` chứng minh bỏ nhánh `%` làm mất hẳn `cirlce k` và `winmrt`.
 */
describe('poiCandidates — tách nhánh % thành truy vấn riêng', () => {
  const cauChinh = (calls: { text: string }[]) =>
    calls.filter((call) => call.text.startsWith('SELECT'))[0];

  it("'no-percent' bỏ mọi toán tử % nhưng giữ <%, alt và LIKE", async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, shortInput, 'no-percent');
    const text = cauChinh(calls)?.text ?? '';
    const where = text.slice(text.indexOf('WHERE'));
    expect(where).not.toContain('name_norm % ');
    expect(where).toMatch(/\$\d+ <% name_norm/);
    expect(where).toContain('<% name_alt_norm');
    expect(where).toContain('name_norm LIKE');
  });

  it("'only-percent' CHỈ giữ toán tử %", async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, shortInput, 'only-percent');
    const text = cauChinh(calls)?.text ?? '';
    const where = text.slice(text.indexOf('WHERE'));
    expect(where).toContain('name_norm % ');
    expect(where).not.toMatch(/\$\d+ <% name_norm/);
    expect(where).not.toContain('<% name_alt_norm');
    expect(where).not.toContain('name_norm LIKE');
  });

  it('hai nhánh cộng lại phủ đúng bằng bản đầy đủ', async () => {
    const dieuKien = async (che_do?: 'no-percent' | 'only-percent') => {
      const { sql, calls } = fakeSql([]);
      await poiCandidates(sql, shortInput, che_do);
      const text = cauChinh(calls)?.text ?? '';
      const where = text.slice(text.indexOf('AND ('));
      return (where.match(/<%|% \$|LIKE/g) ?? []).sort().join(',');
    };
    const day_du = await dieuKien();
    const khong = await dieuKien('no-percent');
    const chi = await dieuKien('only-percent');
    expect([...khong.split(','), ...chi.split(',')].filter(Boolean).sort().join(',')).toBe(day_du);
  });

  it('mọi chế độ vẫn chấm điểm y hệt nhau — dòng trùng phải có cùng sim để dedup đúng', async () => {
    const simCua = async (che_do?: 'no-percent' | 'only-percent') => {
      const { sql, calls } = fakeSql([]);
      await poiCandidates(sql, shortInput, che_do);
      const text = cauChinh(calls)?.text ?? '';
      return text.slice(text.indexOf('greatest('), text.indexOf(') AS sim'));
    };
    expect(await simCua('no-percent')).toBe(await simCua());
    expect(await simCua('only-percent')).toBe(await simCua());
  });
});

describe('collectCandidates — đường dự phòng chạy hai nhánh song song', () => {
  it('truy vấn ngắn: phát HAI truy vấn poi, một không-%, một chỉ-%', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, shortInput, new Set(['poi']));
    const poi = calls.filter((call) => call.text.startsWith("SELECT 'poi'"));
    expect(poi).toHaveLength(2);
    expect(poi.filter((call) => call.text.includes('name_norm % '))).toHaveLength(1);
  });

  it('truy vấn DÀI (>12 ký tự) vẫn chỉ một truy vấn — nhánh % vốn không tồn tại ở đó', async () => {
    const { sql, calls } = fakeSql([]);
    await collectCandidates(sql, input, new Set(['poi']));
    expect(calls.filter((call) => call.text.startsWith("SELECT 'poi'"))).toHaveLength(1);
  });
});
