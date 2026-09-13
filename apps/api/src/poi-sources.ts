import type { PoiSource } from '@mapslibvn/core';
import type { getSql } from './db';
import { textArray } from './geocode';

type Sql = ReturnType<typeof getSql>;

/**
 * Fragment lọc theo nguồn cho mọi truy vấn đọc `poi` (alias bắt buộc là `p`). Hình dạng mệnh đề
 * lấy từ `poiSourceClause` của core — test `poi-sources.test.ts` khoá điều đó để pipeline và API
 * không lệch nhau. POI người dùng (`created_by='user'`, primary_source NULL) luôn được giữ.
 *
 * Mảng nguồn đi qua `textArray`: bind mảng JS rồi cast `::text[]` thì `postgres/cf` trong Workers
 * nối thành "osm,fsq" và Postgres ném `malformed array literal` — lỗi này chỉ hiện ở
 * `test:api-db` và trên production, không hiện ở unit test không DB.
 */
export function poiSourceFilter(sql: Sql, sources: readonly PoiSource[]) {
  return sql`(p.primary_source = ANY(${textArray(sql, [...sources])}) OR p.created_by = 'user')`;
}
