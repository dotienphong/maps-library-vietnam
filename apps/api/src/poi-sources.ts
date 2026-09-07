import type { PoiSource } from '@mapslibvn/core';
import type { getSql } from './db';

type Sql = ReturnType<typeof getSql>;

/**
 * Fragment lọc theo nguồn cho mọi truy vấn đọc `poi` (alias bắt buộc là `p`). Văn bản phải khớp
 * `poiSourceClause('$n::text[]')` của core — test `poi-sources.test.ts` khoá điều đó để pipeline và
 * API không lệch nhau. POI người dùng (`created_by='user'`, primary_source NULL) luôn được giữ.
 */
export function poiSourceFilter(sql: Sql, sources: readonly PoiSource[]) {
  return sql`(p.primary_source = ANY(${[...sources]}::text[]) OR p.created_by = 'user')`;
}
