import { describe, expect, it } from 'vitest';
import {
  type CandidateQueryInput,
  collectCandidates,
  poiCandidates,
  streetCandidates,
} from '../src/autocomplete-sql';
import { fakeSql } from './helpers/fake-sql';

const input: CandidateQueryInput = {
  queryNorm: 'coffee highlands',
  queryCore: 'coffee highlands',
  prefixPattern: 'coffee highlands%',
  near: null,
  parsed: { alleyChain: [], confidence: 0 },
};

describe('autocomplete-sql — bậc 1 dùng word_similarity (spec 05/09 mục 5.3)', () => {
  // Giữ CẢ HAI toán tử: `<%` bắt được cụm nằm giữa tên dài và đảo từ; `%` (ngưỡng 0,3) vẫn cần
  // cho lỗi gõ trên TỪ NGẮN, nơi word_similarity tụt dưới mọi ngưỡng hợp lý — đo 05/09 trên
  // production: higland↔highlands 0,455 và cirlce k↔circle k 0,385, trượt ở cả 0,5 lẫn 0,6.
  it('poi: đủ ba nhánh <% , % và LIKE tiền tố', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, input);
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    // Tham số đầu ($1) nằm trong word_similarity() của SELECT; WHERE dùng $n sau đó.
    expect(query?.text).toMatch(/\$\d+ <% name_norm/);
    expect(query?.text).toMatch(/name_norm % \$\d+/);
    expect(query?.text).toMatch(/name_norm LIKE \$\d+/);
    expect(query?.text).toContain('word_similarity(');
    expect(query?.text).toContain('similarity(name_norm,');
    expect(query?.text).toContain('ORDER BY sim DESC, pop DESC');
    expect(query?.params).toEqual(
      expect.arrayContaining(['coffee highlands', 'coffee highlands%']),
    );
  });

  it('poi: nameCore trùng normalizeVi thì KHÔNG sinh nhánh core thừa', async () => {
    const { sql, calls } = fakeSql([]);
    await poiCandidates(sql, input); // queryCore === queryNorm
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text.match(/<% name_norm/g)).toHaveLength(1);
    expect(query?.text.match(/name_norm % \$\d+/g)).toHaveLength(1);
  });

  it('poi: nameCore khác normalizeVi thì thêm cả hai nhánh cho core', async () => {
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

  it('street: đủ ba nhánh <% , % và LIKE', async () => {
    const { sql, calls } = fakeSql([]);
    await streetCandidates(sql, input);
    const [query] = calls.filter((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toMatch(/\$\d+ <% name_norm/);
    expect(query?.text).toMatch(/name_norm % \$\d+/);
    expect(query?.text).toMatch(/name_norm LIKE \$\d+/);
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
