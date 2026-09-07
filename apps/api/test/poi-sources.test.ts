import { poiSourceClause } from '@mapslibvn/core';
import { describe, expect, it } from 'vitest';
import { poiSourceFilter } from '../src/poi-sources';
import { fakeSql } from './helpers/fake-sql';

/** Biểu thức mảng của `textArray` (xem geocode.ts): đi qua JSON để `postgres/cf` không nối chuỗi. */
const ARRAY_EXPR = 'ARRAY(SELECT json_array_elements_text($1::text::json))';

describe('poiSourceFilter', () => {
  it('sinh đúng mệnh đề dùng chung của core, mảng nguồn đi qua textArray', async () => {
    const { sql, calls } = fakeSql([]);
    await sql`SELECT 1 FROM poi p WHERE p.status = 'active' AND ${poiSourceFilter(sql, ['osm'])}`;
    // fakeSql ghi cả fragment lồng vào `calls`, nên lấy câu SELECT ngoài cùng.
    const query = calls.find((call) => call.text.startsWith('SELECT 1'));
    expect(query?.text).toBe(
      `SELECT 1 FROM poi p WHERE p.status = 'active' AND ${poiSourceClause(ARRAY_EXPR)}`,
    );
    // Tham số là chuỗi JSON, KHÔNG phải mảng JS — đó là điểm khiến bản Workers chạy đúng.
    expect(query?.params).toEqual(['["osm"]']);
  });
});
