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
};

/** 7 ký tự — đủ ngắn để có thêm nhánh `%`. */
const shortInput: CandidateQueryInput = {
  ...input,
  queryNorm: 'higland',
  queryCore: 'higland',
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
      prefixPattern: 'ca phe cong%',
    });
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text.match(/<% name_norm/g)).toHaveLength(2);
    expect(query?.text.match(/name_norm % \$\d+/g)).toHaveLength(2);
    expect(query?.params).toEqual(expect.arrayContaining(['ca phe cong', 'cong']));
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
    const rows = [{ type: 'poi', name: 'x' }];
    const { sql, calls } = fakeSql(rows);
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
});
