// Lọc POI theo profile nguồn khi export tile (spec 07/09 mục 4–5). Hằng lấy từ @mapslibvn/core để
// pipeline và API không lệch nhau.
import { POI_SOURCE_PROFILES, poiSourceClause } from '@mapslibvn/core';
import { TILE_EXCLUDED_CODES, TILE_EXCLUDED_GROUPS } from './osm-extended.mjs';

export { POI_SOURCE_PROFILES };

/** @param {string} profile @returns {readonly ('osm' | 'fsq')[]} */
export function sourcesForProfile(profile) {
  const sources = /** @type {Record<string, readonly ('osm' | 'fsq')[]>} */ (POI_SOURCE_PROFILES)[
    profile
  ];
  if (!sources) {
    throw new Error(
      `profile nguồn không hợp lệ: ${profile} (có: ${Object.keys(POI_SOURCE_PROFILES).join(', ')})`,
    );
  }
  return sources;
}

/** WHERE cho bảng `poi p`: active + đúng nguồn, luôn giữ POI người dùng. @param {string} profile */
export function activePoiWhereSql(profile) {
  const list = sourcesForProfile(profile)
    .map((source) => `'${source}'`)
    .join(',');
  return `p.status = 'active' AND ${poiSourceClause(`ARRAY[${list}]::text[]`)}`;
}

/**
 * POI được vẽ lên tiles (bảng `poi p` JOIN `category c`). Nhóm `place` và hồ/sông/đảo/nút giao chỉ
 * để tìm kiếm: bản đồ nền đã có nhãn nơi chốn và mặt nước, vẽ thêm là nhãn hiện hai lần.
 */
export function tileVisibleSql() {
  const list = (/** @type {string[]} */ values) => values.map((v) => `'${v}'`).join(',');
  return `c.group_code NOT IN (${list(TILE_EXCLUDED_GROUPS)}) AND p.category NOT IN (${list(TILE_EXCLUDED_CODES)})`;
}

/** Tiền tố tên release: `all` giữ `poi-YYYYMMDD` để archive cũ không đổi tên. @param {string} profile */
export function poiReleasePrefix(profile) {
  return profile === 'all' ? 'poi' : `poi-${profile}`;
}
