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
    expect(query?.text).toMatch(/\$\d+ <% a\.name_norm/);
    expect(query?.text).toMatch(/\$\d+ <% aa\.alias_norm/);
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
