import { describe, expect, it } from 'vitest';
import { areaCandidates } from '../src/area-candidates';
import type { CandidateQueryInput } from '../src/autocomplete-sql';
import { fakeSql } from './helpers/fake-sql';

const input: CandidateQueryInput = {
  queryNorm: 'quan 10',
  queryCore: '10',
  prefixPattern: 'quan 10%',
  near: null,
  parsed: { alleyChain: [], confidence: 0.2, district: '10' },
};

const areaQueries = (calls: { text: string }[]) =>
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
