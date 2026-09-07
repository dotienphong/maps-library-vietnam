import { poiSourceClause } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { poiSourceFilter } from '../src/poi-sources';
import { fakeSql } from './helpers/fake-sql';

describe('poiSourceFilter', () => {
  it('sinh đúng mệnh đề dùng chung của core với tham số text[]', async () => {
    const { sql, calls } = fakeSql([]);
    await sql`SELECT 1 FROM poi p WHERE p.status = 'active' AND ${poiSourceFilter(sql, ['osm'])}`;
    // fakeSql ghi cả fragment lồng vào `calls`, nên lấy câu SELECT ngoài cùng.
    const query = calls.find((call) => call.text.startsWith('SELECT'));
    expect(query?.text).toBe(
      `SELECT 1 FROM poi p WHERE p.status = 'active' AND ${poiSourceClause('$1::text[]')}`,
    );
    expect(query?.params).toEqual([['osm']]);
  });
});
